/** U02 runtime prerequisites against the installed native runner; no model or business service. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { collectResults, preflightEnvironment } from "pi-ui-testing";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";

test(
	"U02: each new native run checks current site, identity and initial state before the formal CLI",
	{ timeout: 90000 },
	async (t) => {
		const d = await ready(t),
			{ f } = d;
		let children = [],
			calibrated = false;
		const observer = ({ process: child }) => children.push(child);
		subscribe("child_process", observer);
		try {
			await promisify(execFile)(process.execPath, ["-e", ""]);
			calibrated = children.some((child) => child.spawnargs?.includes("-e"));
		} finally {
			unsubscribe("child_process", observer);
		}
		assert.equal(calibrated, true, "The observer must see the arguments of an actual child process");
		const formalProcesses = () =>
			children.filter((child) => child.spawnargs?.includes("test") && child.spawnargs?.includes("--config")).length;
		const read = async (execution, suffix) => {
			const ref = execution.run.data.output_refs.find((ref) => ref.path.endsWith(suffix));
			assert.ok(ref, `Missing native evidence: ${suffix}`);
			return JSON.parse(await readFile(join(f.root, ref.path), "utf8"));
		};
		const receipts = [];
		const run = async (id) => {
			children = [];
			subscribe("child_process", observer);
			try {
				return await d.service.start({ ...d.request, request_id: id });
			} finally {
				unsubscribe("child_process", observer);
			}
		};
		for (const [id, values, phase] of [
			["expired-identity", { identityText: "Signed out" }, "identity"],
			["changed-data-state", { saveLabel: "Not ready" }, "initial-state"],
			["unavailable-site", { responseStatus: 503 }, "site"],
		]) {
			await t.test(id, async (subtest) => {
				subtest.after(() =>
					Object.assign(f.fixture.state, { identityText: "Names", saveLabel: "Save", responseStatus: 200 }),
				);
				Object.assign(f.fixture.state, { identityText: "Names", saveLabel: "Save", responseStatus: 200 }, values);
				const before = f.fixture.state.browserRequests;
				const execution = await run(id);
				const preflight = await read(execution, "/preflight.json"),
					summary = await read(execution, "/execution-summary.json");
				assert.equal(execution.replayed, false);
				assert.ok(f.fixture.state.browserRequests > before, "Current target state must actually be checked");
				assert.equal(preflight.status, "blocked");
				assert.equal(preflight.check, phase);
				assert.equal(summary.status, "blocked");
				assert.equal(summary.business_started, false);
				assert.equal(formalProcesses(), 0, "No formal Playwright CLI may start after failed preflight");
				assert.equal(
					execution.run.data.output_refs.some((ref) =>
						/\/(launch-intent|process-started|report)\.json$/.test(ref.path),
					),
					false,
				);
				const results = await collectResults(f.root, execution.run_ref, `${id}-results`);
				assert.equal(results.data.planned_count, 1);
				assert.equal(results.data.counts.blocked, 1);
				assert.equal(results.data.counts.failed, 0, "Initialization failure is not product failure");
				receipts.push({
					requestId: id,
					preflight,
					formalProcesses: formalProcesses(),
					businessStarted: summary.business_started,
					runRef: execution.run_ref,
				});
				// Restoring the target must not replay a request with an already recorded outcome.
				Object.assign(f.fixture.state, { identityText: "Names", saveLabel: "Save", responseStatus: 200 });
				const beforeReplay = f.fixture.state.browserRequests;
				const replay = await run(id);
				assert.equal(replay.replayed, true);
				assert.deepEqual(replay.run_ref, execution.run_ref);
				assert.equal(children.length, 0);
				assert.equal(f.fixture.state.browserRequests, beforeReplay);
			});
		}
		await t.test(
			"restored anonymous target uses a new explicit request, with current checks and real assertions",
			async () => {
				const execution = await run("restored-explicit-request");
				assert.equal(execution.replayed, false);
				assert.equal(formalProcesses(), 1);
				assert.equal((await read(execution, "/preflight.json")).status, "completed");
				const results = await collectResults(f.root, execution.run_ref, "restored-current-results");
				assert.equal(results.data.counts.passed, 1);
				assert.equal(results.data.counts.failed, 0);
				receipts.push({
					requestId: "restored-explicit-request",
					formalProcesses: formalProcesses(),
					runRef: execution.run_ref,
					statistics: results.data.counts,
				});
			},
		);
		t.diagnostic(
			JSON.stringify({
				scope: "synthetic native environment checks; controlled design reviews",
				root: f.root,
				receipts,
				actualModelCalls: 0,
				businessRequests: 0,
			}),
		);
	},
);

test(
	"U02: native private storageState is consumed only in preflight context and missing auth never reaches the target",
	{ timeout: 30000 },
	async (t) => {
		const root = await mkdtemp(join(tmpdir(), "ui-private-preflight-"));
		const workspace = join(root, "workspace"),
			privateDir = join(root, "private");
		await mkdir(workspace);
		await mkdir(privateDir, { mode: 0o700 });
		// Resolve the existing native Playwright installation without copying its runtime.
		const { symlink } = await import("node:fs/promises");
		await symlink(join(process.cwd(), "node_modules"), join(workspace, "node_modules"), "dir");
		await writeFile(join(workspace, "package.json"), '{"type":"module"}');
		const secret = "synthetic-session-u02-private",
			reference = "PI_UI_U02_SYNTHETIC_AUTH";
		assert.equal(process.env[reference], undefined, "Never overwrite an existing process auth reference");
		let requests = 0,
			authenticatedRequests = 0;
		const server = createServer((req, res) => {
			requests++;
			const authenticated = req.headers.cookie?.split("; ").includes(`qa_session=${secret}`);
			if (authenticated) authenticatedRequests++;
			res.writeHead(200, { "content-type": "text/html" });
			res.end(`<h1>${authenticated ? "Role: tester" : "Role: guest"}</h1><p id="state">Empty owned data</p>`);
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		t.after(async () => {
			delete process.env[reference];
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			await rm(root, { recursive: true, force: true });
		});
		assert.ok(server.address().port >= 8900);
		const baseUrl = `http://127.0.0.1:${server.address().port}`;
		const environment = {
			schema_version: "1.0",
			environment_id: "synthetic-auth",
			deployment_version: "fixture-u02",
			base_url: baseUrl,
			role: "tester",
			identity: { selector: "h1", text: "Role: tester" },
			initial_state: { selector: "#state", text: "Empty owned data" },
			auth: { kind: "storage-state-env", reference },
			isolation: "context",
			timeout_ms: 400,
		};
		const receipts = [];
		let result = await preflightEnvironment(workspace, environment, 5000);
		assert.deepEqual([result.status, result.check, requests], ["blocked", "auth-reference", 0]);
		receipts.push(result);
		const authPath = join(privateDir, "state.json");
		// Native storageState expects serialized browser-cookie fields, not a guessed HTTP token mapping.
		await writeFile(
			authPath,
			JSON.stringify({
				cookies: [
					{
						name: "qa_session",
						value: secret,
						domain: "127.0.0.1",
						path: "/",
						expires: -1,
						httpOnly: true,
						secure: false,
						sameSite: "Lax",
					},
				],
				origins: [],
			}),
			{ mode: 0o600 },
		);
		process.env[reference] = authPath;
		result = await preflightEnvironment(workspace, environment, 5000);
		assert.equal(result.status, "completed");
		assert.ok(authenticatedRequests > 0, "The browser must send the actual private synthetic cookie");
		receipts.push(result);
		const expiredState = JSON.parse(await readFile(authPath, "utf8"));
		expiredState.cookies[0].expires = 1;
		await writeFile(authPath, JSON.stringify(expiredState), { mode: 0o600 });
		const beforeExpired = authenticatedRequests;
		result = await preflightEnvironment(workspace, environment, 5000);
		assert.equal(result.status, "blocked");
		assert.equal(result.check, "identity", "An existing auth file does not prove a current logged-in identity");
		assert.equal(authenticatedRequests, beforeExpired);
		receipts.push(result);
		const beforeAnonymous = authenticatedRequests;
		result = await preflightEnvironment(
			workspace,
			{ ...environment, role: "guest", identity: { selector: "h1", text: "Role: guest" }, auth: { kind: "none" } },
			5000,
		);
		assert.equal(result.status, "completed", "A case expecting unauthenticated guest must not require login");
		assert.equal(
			authenticatedRequests,
			beforeAnonymous,
			"A new anonymous context must not inherit private storageState",
		);
		receipts.push(result);
		await writeFile(authPath, "invalid-storage-state", { mode: 0o600 });
		const beforeInvalid = requests;
		result = await preflightEnvironment(workspace, environment, 5000);
		assert.deepEqual([result.status, result.check, requests], ["blocked", "auth-reference", beforeInvalid]);
		receipts.push(result);
		await rm(authPath);
		const beforeMissing = requests;
		result = await preflightEnvironment(workspace, environment, 5000);
		assert.deepEqual([result.status, result.check, requests], ["blocked", "auth-reference", beforeMissing]);
		receipts.push(result);
		assert(!JSON.stringify(receipts).includes(secret));
		assert(!JSON.stringify(receipts).includes(authPath));
		assert.deepEqual(
			(await readdir(workspace)).sort(),
			["node_modules", "package.json"],
			"Preflight must not capture trace, screenshots or reports in the workspace",
		);
		t.diagnostic(
			JSON.stringify({
				scope: "native preflight only; not data-space secret bridging or formal-run capture",
				receipts,
				requests,
				authenticatedRequests,
				secretInReceipts: false,
				workspaceCaptureFiles: 0,
				actualModelCalls: 0,
				businessRequests: 0,
			}),
		);
	},
);
