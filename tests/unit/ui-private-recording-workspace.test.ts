import { afterEach, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ArtifactStore, RecordingService, authState, validateArtifact, type UiEnvironment } from "pi-ui-testing";
import { preparePrivateRecordingWorkspace } from "../../.pi/skills/ui-testing-workflow/assets/private-recording-workspace.mjs";
import { preparePrivateRecordingSession } from "../../.pi/skills/ui-testing-workflow/assets/private-recording-session.mjs";
const roots: string[] = [],
	references: string[] = [],
	prepared: Array<{ revoke(): Promise<void> }> = [];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
afterEach(async () => {
	for (const item of prepared.splice(0)) await item.revoke();
	for (const reference of references.splice(0)) delete process.env[reference];
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "recording-workspace-")));
	roots.push(root);
	const workspace = join(root, "public"),
		authority = join(root, "host"),
		parentDirectory = join(root, "parent");
	for (const path of [workspace, authority, parentDirectory, join(workspace, "tests")])
		await mkdir(path, { mode: 0o700 });
	await symlink(await realpath("node_modules"), join(workspace, "node_modules"), "dir");
	const reference = `PI_UI_DATA_SPACE_${randomUUID().replaceAll("-", "").toUpperCase()}`;
	references.push(reference);
	const parentPath = join(parentDirectory, "state.json"),
		base = "http://127.0.0.1:18983/";
	const environment: UiEnvironment = {
		schema_version: "1.0",
		environment_id: "synthetic",
		deployment_version: "fixture-v1",
		base_url: base,
		role: "fixture",
		identity: { selector: "h1", text: "fixture" },
		initial_state: { selector: "h1", text: "fixture" },
		isolation: "context",
		timeout_ms: 1000,
		auth: { kind: "storage-state-env", reference },
	};
	const state = {
		cookies: [],
		origins: [{ origin: new URL(base).origin, localStorage: [{ name: "token", value: "synthetic-" + randomUUID() }] }],
		pi_ui_private: {
			version: 1,
			reference,
			workspace,
			origin: new URL(base).origin,
			baseUrl: base,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		},
	};
	await writeFile(parentPath, JSON.stringify(state), { mode: 0o600 });
	process.env[reference] = parentPath;
	const files = {
		"package.json": '{"type":"module"}',
		"playwright.config.mjs": "export default {testDir:'./tests'};",
		"tests/seed.spec.ts": "export {};",
	};
	const inputRefs = [];
	for (const [path, code] of Object.entries(files)) {
		const bytes = Buffer.from(code);
		await writeFile(join(workspace, path), bytes);
		inputRefs.push({ path, sha256: hash(bytes) });
	}
	const input = { workspace, authority, inputRefs, environment };
	const prepare = async () => {
		const value = await preparePrivateRecordingWorkspace(input);
		prepared.push(value);
		return value;
	};
	return { root, workspace, authority, reference, parentPath, state, input, prepare };
}

it("keeps parent scope intact while a child consumes an exact, equally expiring managed state", async () => {
	const f = await fixture(),
		before = await readFile(f.parentPath),
		value = await f.prepare();
	await expect(authState(f.input.environment, value.workspace)).rejects.toThrow();
	const childPath = value.childEnv[f.reference],
		derived = JSON.parse(await readFile(childPath, "utf8"));
	expect(derived.pi_ui_private.workspace).toBe(value.workspace);
	expect(derived.pi_ui_private.expiresAt).toBe(f.state.pi_ui_private.expiresAt);
	expect(derived.origins).toEqual(f.state.origins);
	const entry = pathToFileURL(createRequire(import.meta.url).resolve("pi-ui-testing")).href;
	const code = `import {authState} from ${JSON.stringify(entry)};const p=await authState(${JSON.stringify(f.input.environment)},${JSON.stringify(value.workspace)});if(!p)throw Error('missing');console.log('scope-valid');`;
	expect(
		execFileSync(process.execPath, ["--input-type=module", "--eval", code], {
			env: { PATH: process.env.PATH, ...value.childEnv },
			encoding: "utf8",
		}).trim(),
	).toBe("scope-valid");
	expect(process.env[f.reference]).toBe(f.parentPath);
	expect(await readFile(f.parentPath)).toEqual(before);
	for (const ref of f.input.inputRefs) expect(hash(await readFile(join(value.workspace, ref.path)))).toBe(ref.sha256);
	expect((await lstat(childPath)).mode & 0o777).toBe(0o600);
	expect((await lstat(value.workspace)).mode & 0o777).toBe(0o700);
	expect(await realpath(join(value.workspace, "node_modules"))).toBe(await realpath(join(f.workspace, "node_modules")));
	const receipt = JSON.stringify(value.receipt);
	expect(receipt).not.toContain(f.state.origins[0].localStorage[0].value);
	expect(receipt).not.toContain(childPath);
	expect(value.receipt.authentication).toBe("unknown");
	await value.assertCurrent();
});
it("rejects source mutations even when both copies are changed to identical bytes", async () => {
	const f = await fixture(),
		value = await f.prepare(),
		childPath = value.childEnv[f.reference];
	for (const root of [f.workspace, value.workspace]) await writeFile(join(root, "tests/seed.spec.ts"), "changed");
	await expect(value.assertCurrent()).rejects.toThrow("阻塞");
	await expect(access(childPath)).rejects.toThrow();
});
it("revokes on parent renewal, missing reference and expiry instead of using copied old authentication", async () => {
	for (const change of ["renewed", "missing", "expired"]) {
		const f = await fixture(),
			value = await f.prepare();
		if (change === "renewed")
			await writeFile(
				f.parentPath,
				JSON.stringify({
					...f.state,
					origins: [{ ...f.state.origins[0], localStorage: [{ name: "token", value: "renewed" }] }],
				}),
			);
		if (change === "missing") delete process.env[f.reference];
		if (change === "expired")
			await writeFile(
				f.parentPath,
				JSON.stringify({ ...f.state, pi_ui_private: { ...f.state.pi_ui_private, expiresAt: "2000-01-01T00:00:00Z" } }),
			);
		await expect(value.assertCurrent()).rejects.toThrow("阻塞");
		await expect(access(value.childEnv[f.reference])).rejects.toThrow();
	}
});
it("preserves raw private evidence when derived authentication is revoked", async () => {
	const f = await fixture(),
		value = await f.prepare(),
		raw = join(value.workspace, "private-capture.txt");
	await writeFile(raw, "private raw capture", { mode: 0o600 });
	await value.revoke();
	await value.revoke();
	expect(await readFile(raw, "utf8")).toBe("private raw capture");
	await expect(access(value.childEnv[f.reference])).rejects.toThrow();
	expect(await authState(f.input.environment, f.workspace)).toBe(f.parentPath);
});
it("rejects escape, symlink, stale digest and incomplete authority permissions before returning a workspace", async () => {
	for (const mode of ["escape", "symlink", "digest", "permissions", "public-authority", "unmanaged"]) {
		const f = await fixture();
		if (mode === "escape") f.input.inputRefs[0].path = "../parent/state.json";
		if (mode === "symlink") {
			await rm(join(f.workspace, "tests/seed.spec.ts"));
			await symlink(f.parentPath, join(f.workspace, "tests/seed.spec.ts"));
		}
		if (mode === "digest") f.input.inputRefs[0].sha256 = "0".repeat(64);
		if (mode === "permissions") await chmod(f.authority, 0o755);
		if (mode === "public-authority") f.input.authority = f.workspace;
		if (mode === "unmanaged") {
			const { pi_ui_private, ...unmanaged } = f.state;
			await writeFile(f.parentPath, JSON.stringify(unmanaged));
		}
		await expect(f.prepare()).rejects.toThrow("阻塞");
	}
});
it("blocks tampered derived state and private directory permissions", async () => {
	for (const mode of ["state", "directory", "authority"]) {
		const f = await fixture(),
			value = await f.prepare();
		if (mode === "state") await writeFile(value.childEnv[f.reference], "{}");
		else await chmod(mode === "authority" ? f.authority : value.workspace, 0o755);
		await expect(value.assertCurrent()).rejects.toThrow("阻塞");
		await expect(access(value.childEnv[f.reference])).rejects.toThrow();
	}
});

it("caps a distant parent deadline without extending authentication or overflowing the revocation timer", async () => {
	const f = await fixture();
	await writeFile(
		f.parentPath,
		JSON.stringify({ ...f.state, pi_ui_private: { ...f.state.pi_ui_private, expiresAt: "2099-01-01T00:00:00Z" } }),
	);
	const started = Date.now(),
		value = await f.prepare();
	const derived = JSON.parse(await readFile(value.childEnv[f.reference], "utf8"));
	expect(Date.parse(derived.pi_ui_private.expiresAt)).toBeGreaterThan(started);
	expect(Date.parse(derived.pi_ui_private.expiresAt)).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
	expect(value.receipt.expiresAt).toBe(derived.pi_ui_private.expiresAt);
	await value.assertCurrent();
});

it("finishes a successful request before the SDK aborts its completed send signal", async () => {
	const f = await fixture(),
		value = await f.prepare(),
		controller = new AbortController();
	const operation = await value.beginOperation(controller.signal),
		target = join(f.workspace, "draft.ts");
	await operation.publish(() => writeFileSync(target, "native draft", { flag: "wx" }));
	controller.abort();
	expect(await readFile(target, "utf8")).toBe("native draft");
	await value.assertCurrent();
	await expect(operation.publish(() => writeFileSync(target, "duplicate"))).rejects.toThrow("阻塞");
});
it("rejects an already cancelled request without allowing a dispatch", async () => {
	const f = await fixture(),
		value = await f.prepare(),
		controller = new AbortController();
	controller.abort();
	await expect(value.beginOperation(controller.signal)).rejects.toThrow("阻塞");
	await expect(access(value.childEnv[f.reference])).rejects.toThrow();
});
it("keeps a native private draft but refuses public publication after cancellation or parent renewal", async () => {
	for (const reason of ["cancel", "renew", "cancel-during-check"]) {
		const f = await fixture(),
			value = await f.prepare(),
			controller = new AbortController();
		const operation = await value.beginOperation(controller.signal),
			target = join(f.workspace, "draft.ts"),
			native = join(value.workspace, "draft.ts");
		await writeFile(native, "native draft", { mode: 0o600 });
		if (reason === "cancel") controller.abort();
		if (reason === "renew") await writeFile(f.parentPath, JSON.stringify({ ...f.state, origins: [] }));
		const publication = operation.publish(() => writeFileSync(target, "native draft", { flag: "wx" }));
		if (reason === "cancel-during-check") controller.abort();
		await expect(publication).rejects.toThrow("阻塞");
		await expect(access(target)).rejects.toThrow();
		expect(await readFile(native, "utf8")).toBe("native draft");
		await expect(access(value.childEnv[f.reference])).rejects.toThrow();
	}
});
it("invalidates every pending request on close while a fresh snapshot remains independent", async () => {
	const f = await fixture(),
		old = await f.prepare(),
		next = await f.prepare();
	const first = await old.beginOperation(undefined),
		second = await old.beginOperation(undefined),
		fresh = await next.beginOperation(undefined);
	await old.revoke();
	for (const operation of [first, second]) {
		expect(() => operation.assertActive()).toThrow("阻塞");
		await expect(operation.publish(() => writeFileSync(join(f.workspace, "stale.ts"), "old"))).rejects.toThrow("阻塞");
	}
	await fresh.publish(() => writeFileSync(join(f.workspace, "fresh.ts"), "new", { flag: "wx" }));
	await expect(access(join(f.workspace, "stale.ts"))).rejects.toThrow();
	expect(await readFile(join(f.workspace, "fresh.ts"), "utf8")).toBe("new");
});

it.each([undefined, "chromium-single-page-v1"] as const)(
	"prepares host privacy and snapshot from the native session binding (%s), preserving its public receipt",
	async (capture) => {
		const f = await fixture(),
			store = new ArtifactStore(f.workspace),
			service = new RecordingService(f.workspace);
		if (capture) {
			await rm(join(f.workspace, "node_modules"));
			await mkdir(join(f.workspace, "node_modules/@playwright"), { recursive: true });
			for (const name of ["@playwright/test", "playwright", "pi-ui-testing"])
				await symlink(
					await realpath(join("tools/e2e/node_modules", name)),
					join(f.workspace, "node_modules", name),
					"dir",
				);
			await writeFile(
				join(f.workspace, "playwright.config.mjs"),
				"export default {testDir:'./tests',use:{trace:'off'},projects:[{name:'chromium'}]};",
			);
			await writeFile(
				join(f.workspace, "tests/seed.spec.ts"),
				`import {test} from 'pi-ui-testing/recording-fixtures';test.use({uiEnvironment:${JSON.stringify(f.input.environment)},uiOwner:{task_id:'binding',kind:'recording',id:'binding'},uiProjectRoot:process.cwd()});test('seed',async({page})=>{});`,
			);
			for (const ref of f.input.inputRefs) ref.sha256 = hash(await readFile(join(f.workspace, ref.path)));
		}
		const source = await store.putFile("qa/ui/scopes/binding/source.md", "Synthetic fixture heading is visible.");
		const envelope = (kind: string, data: unknown) =>
			validateArtifact({
				schema_version: "1.0",
				kind,
				id: "binding",
				created_at: new Date().toISOString(),
				data,
			});
		const scope = await store.put(
			envelope("scope", {
				project_id: "synthetic",
				environment_id: f.input.environment.environment_id,
				role: f.input.environment.role,
				goal: "Observe synthetic heading",
				base_url: f.input.environment.base_url,
				allowed_actions: ["Observe fixture only"],
				sources: [
					{ source_id: "S1", oracle_type: "declaration", ref: source, statement: "Fixture heading is visible" },
				],
				budget: { max_review_rounds: 3, max_tool_calls: 10 },
			}),
		);
		const inventory = await store.put(
			envelope("inventory", { scope_ref: scope, features: [], unexplored: ["Business behavior"] }),
		);
		const environment = await store.putFile(
			"qa/ui/scopes/binding/environment.json",
			JSON.stringify(f.input.environment),
		);
		const seed = f.input.inputRefs.find((ref) => ref.path === "tests/seed.spec.ts")!;
		const sessionRef = await service.start({
			id: "binding",
			scope_ref: scope,
			inventory_ref: inventory,
			initial_state_ref: source,
			data_rules_ref: source,
			seed_ref: seed,
			output_file: "tests/generated.spec.ts",
			backend: capture ? "mcp__ui_playwright_test__" : "mcp__fixture__",
			project: "chromium",
			max_steps: capture ? 4 : 10,
			max_duration_ms: 60000,
			max_no_progress: 3,
			test_data: [],
			private_recording: {
				environment_ref: environment,
				input_refs: f.input.inputRefs,
				...(capture ? { capture } : {}),
			},
		});
		const host = await preparePrivateRecordingSession({ workspace: f.workspace, authority: f.authority, sessionRef });
		prepared.push(host.snapshot);
		await host.snapshot.assertCurrent();
		expect(host.receipt.session_ref).toEqual(sessionRef);
		expect(host.receipt.inputs).toEqual([...f.input.inputRefs, environment, sessionRef]);
		if (capture) {
			expect(host.capture).toEqual({
				protocol: capture,
				seedRef: seed,
				project: "chromium",
				outputFile: "tests/generated.spec.ts",
				maxSteps: 4,
				maxToolCalls: 10,
				reservedToolCalls: 9,
			});
			expect(host.receipt.capture).toEqual({ protocol: capture, maxSteps: 4, maxToolCalls: 10, reservedToolCalls: 9 });
			expect(host.snapshot.childEnv.PI_UI_PRIVATE_EVIDENCE_DIR).toBe(host.privacy.directory);
			expect((await lstat(join(host.privacy.directory, "output"))).mode & 0o777).toBe(0o700);
		} else {
			expect(host.capture).toBeUndefined();
			expect(host.snapshot.childEnv.PI_UI_PRIVATE_EVIDENCE_DIR).toBeUndefined();
		}
		const serialized = JSON.stringify(host.receipt);
		expect(serialized).not.toContain(f.state.origins[0].localStorage[0].value);
		expect(serialized).not.toContain(f.parentPath);
		expect(serialized).not.toContain(host.privacy.directory);
		expect(host.privacy.text(f.state.origins[0].localStorage[0].value)).not.toContain(
			f.state.origins[0].localStorage[0].value,
		);
		await writeFile(join(f.workspace, environment.path), "changed binding");
		await expect(host.snapshot.assertCurrent()).rejects.toThrow();
		await expect(
			preparePrivateRecordingSession({ workspace: f.workspace, authority: f.authority, sessionRef }),
		).rejects.toThrow();
	},
);
