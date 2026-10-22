/** Dedicated fixture-only MCP execution, immutable approvals and one attempt per run reference. */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { API_FIXTURE_ISOLATION_POLICY, prepareApiFixtureIsolation } from "./api-testing-isolation.js";
import { McpClient } from "./mcp-bridge.js";
import { pathToFileURL } from "node:url";
import type { PluginApiScheduleHost, PluginModelComplete, PluginMcpRequest, PluginToolContext } from "./plugin-mcp.js";

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const readJson = (path: string): Record<string, any> => JSON.parse(readFileSync(path, "utf8"));

interface FixtureApproval {
	identity: PluginToolContext;
	bundleRoot: string;
	fixtureOrigin: string;
	collectionHash: string;
	runner: Buffer;
	guard: Buffer;
	timeoutMs: number;
	bundleHashes: Record<string, string>;
}

export class ApiTestingRunner {
	private workflow: Promise<any> | undefined;
	private scheduler: PluginApiScheduleHost | undefined;
	readonly attachScheduler = async (host: PluginApiScheduleHost): Promise<void> => {
		this.scheduler = host;
		await (await this.getWorkflow()).attachScheduler(host);
	};
	private workflowFingerprint: string | undefined;
	private readonly approvals = new Map<string, FixtureApproval>();
	private readonly attempted = new Set<string>();
	private readonly activeProjects = new Set<string>();

	constructor(
		private readonly outputRoot: string,
		private readonly pluginRoot: string,
	) {}

	/** Trusted host API for the P0 hand-reviewed fixture. Not exposed to model/plugin tools. */
	approveFixture(input: {
		identity: PluginToolContext;
		bundleRoot: string;
		fixtureOrigin: string;
		timeoutMs?: number;
		trustedAssetRoot?: string;
	}): string {
		const identity = Object.freeze({ ...input.identity, cwd: realpathSync(input.identity.cwd) });
		if (identity.pluginId !== "api-testing" || identity.toolName !== "api_test_execute")
			throw new Error("API testing caller is not allowed");
		const origin = new URL(input.fixtureOrigin);
		if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || Number(origin.port) < 8900)
			throw new Error("Only explicit loopback fixtures are supported; real targets remain blocked");
		const bundleRoot = realpathSync(input.bundleRoot);
		const path = relative(identity.cwd, bundleRoot);
		if (isAbsolute(path) || path.startsWith("..")) {
			const stored = input.trustedAssetRoot ? relative(realpathSync(input.trustedAssetRoot), bundleRoot) : undefined;
			if (stored === undefined || isAbsolute(stored) || stored.startsWith(".."))
				throw new Error("Fixture bundle is outside its project");
		}
		const collectionHash = this.verifyBundle(bundleRoot);
		const collection = readJson(join(bundleRoot, "collection.json"));
		const checkItems = (items: Array<Record<string, any>>): void => {
			for (const item of items) {
				if (item.item) checkItems(item.item);
				else {
					const url = typeof item.request?.url === "string" ? item.request.url : item.request?.url?.raw;
					if (typeof url !== "string" || new URL(url).origin !== origin.origin)
						throw new Error("Fixture request target is not approved");
				}
			}
		};
		if (!Array.isArray(collection.item) || !collection.item.length) throw new Error("Fixture collection is empty");
		checkItems(collection.item);
		const manifest = readJson(join(bundleRoot, "manifest.json"));
		const bundleHashes: Record<string, string> = {};
		for (const name of new Set([
			"manifest.json",
			"review.json",
			"collection.json",
			...Object.keys(manifest.files ?? {}),
		])) {
			if (!/^[a-zA-Z0-9.-]+$/.test(name) || name === "..") throw new Error("Unsafe suite filename");
			const file = realpathSync(join(bundleRoot, name));
			if (relative(bundleRoot, file) !== name) throw new Error("Suite file escapes bundle");
			bundleHashes[name] = sha256(readFileSync(file));
			if (manifest.files?.[name] && manifest.files[name] !== bundleHashes[name])
				throw new Error("Suite file hash changed");
		}
		const runRef = randomUUID();
		this.approvals.set(runRef, {
			identity,
			bundleHashes,
			bundleRoot,
			collectionHash,
			fixtureOrigin: origin.origin,
			runner: readFileSync(join(this.pluginRoot, "runner.mjs")),
			guard: readFileSync(join(this.pluginRoot, "network-guard.cjs")),
			timeoutMs: Math.min(Math.max(input.timeoutMs ?? 20000, 100), 120000),
		});
		return runRef;
	}

	private async getWorkflow(): Promise<any> {
		if (process.platform === "win32") throw new Error("Fixture workflow is not verified on Windows");
		const names = [
			"suite.mjs",
			"review.mjs",
			"workflow.mjs",
			"report.mjs",
			"assets.mjs",
			"asset-management.mjs",
			"schedules.mjs",
			"tracking.mjs",
		];
		const sources = names.map((name) => readFileSync(join(this.pluginRoot, name)));
		const executionSources = ["runner.mjs", "network-guard.cjs", "package-lock.json"].map((name) =>
			readFileSync(join(this.pluginRoot, name)),
		);
		const fingerprint = sha256(
			Buffer.concat([...sources, ...executionSources, Buffer.from(API_FIXTURE_ISOLATION_POLICY)]),
		);
		if (this.workflowFingerprint !== fingerprint) {
			if (this.workflow) await (await this.workflow).dispose();
			this.workflow = undefined;
			this.workflowFingerprint = fingerprint;
		}
		if (!this.workflow) {
			this.workflow = (async () => {
				const runtime = join(this.outputRoot, "runtime", fingerprint);
				mkdirSync(runtime, { recursive: true, mode: 0o700 });
				for (const [i, name] of names.entries()) {
					const target = join(runtime, name);
					if (existsSync(target) && sha256(readFileSync(target)) !== sha256(sources[i]))
						throw new Error("Workflow snapshot changed");
					if (!existsSync(target)) writeFileSync(target, sources[i], { mode: 0o600, flag: "wx" });
				}
				if (!existsSync(join(runtime, "node_modules")))
					symlinkSync(join(this.pluginRoot, "node_modules"), join(runtime, "node_modules"), "dir");
				const { createWorkflow } = await import(pathToFileURL(join(runtime, "workflow.mjs")).href);
				const { createAssetStore } = await import(pathToFileURL(join(runtime, "assets.mjs")).href);
				const assetRoot = resolve(this.outputRoot, "..", "assets");
				const assets = createAssetStore({
					root: assetRoot,
					policyHash: fingerprint,
					approve: (input: any) => this.approveFixture({ ...input, trustedAssetRoot: assetRoot }),
					execute: this.call,
				});
				if (this.scheduler) await assets.attachScheduler(this.scheduler);
				return createWorkflow({ approve: (input: any) => this.approveFixture(input), execute: this.call, assets });
			})();
			this.workflow.catch(() => {
				this.workflow = undefined;
			});
		}
		return this.workflow;
	}

	async dispose(): Promise<void> {
		if (this.activeProjects.size) throw new Error("Cannot close API assets while a run is active");
		if (this.workflow) await (await this.workflow).dispose();
		this.workflow = undefined;
	}

	private verifyBundle(root: string, expectedHash?: string): string {
		const collectionPath = realpathSync(join(root, "collection.json"));
		if (relative(root, collectionPath).startsWith("..")) throw new Error("Collection escapes fixture root");
		const hash = sha256(readFileSync(collectionPath));
		const manifest = readJson(join(root, "manifest.json"));
		const review = readJson(join(root, "review.json"));
		if (
			manifest.schemaVersion !== 1 ||
			manifest.collectionSha256 !== hash ||
			review.verdict !== "pass" ||
			review.artifactHash !== hash ||
			(expectedHash && hash !== expectedHash)
		)
			throw new Error("Suite is unreviewed or its hash changed");
		return hash;
	}

	readonly call = async (
		identity: PluginToolContext,
		request: PluginMcpRequest,
		signal: AbortSignal,
		complete?: PluginModelComplete,
	): Promise<unknown> => {
		signal.throwIfAborted();
		if (request.serverId === "api-testing" && request.toolName === "workflow") {
			if (identity.pluginId !== "api-testing" || identity.toolName !== "api_test_execute")
				throw new Error("Workflow caller is not allowed");
			if (JSON.stringify(request.input ?? {}).length > 128000) throw new Error("Workflow input exceeds limit");
			const workflow = await this.getWorkflow();
			return workflow.call(identity, request, signal, complete);
		}
		if (
			request.serverId !== "api-testing" ||
			request.toolName !== "runApprovedSuite" ||
			identity.pluginId !== "api-testing" ||
			identity.toolName !== "api_test_execute"
		)
			throw new Error("MCP server/tool is not allowed");
		const approval = this.approvals.get(request.runRef);
		if (!approval) throw new Error("Unknown or unapproved run reference");
		for (const key of ["cwd", "conversationId", "clientId", "pluginId", "toolName"] as const) {
			if ((key === "cwd" ? realpathSync(identity.cwd) : identity[key]) !== approval.identity[key])
				throw new Error("Run reference belongs to another caller");
		}
		this.verifyBundle(approval.bundleRoot, approval.collectionHash);
		for (const [name, hash] of Object.entries(approval.bundleHashes)) {
			const path = realpathSync(join(approval.bundleRoot, name));
			if (relative(approval.bundleRoot, path) !== name || sha256(readFileSync(path)) !== hash)
				throw new Error("Approved suite content changed");
		}
		const collection = readFileSync(join(approval.bundleRoot, "collection.json"));
		if (sha256(collection) !== approval.collectionHash) throw new Error("Collection changed during preflight");
		if (
			sha256(readFileSync(join(this.pluginRoot, "runner.mjs"))) !== sha256(approval.runner) ||
			sha256(readFileSync(join(this.pluginRoot, "network-guard.cjs"))) !== sha256(approval.guard)
		)
			throw new Error("Approved runner changed");
		if (this.attempted.has(request.runRef)) throw new Error("Run was already attempted; never resend unknown writes");
		if (this.activeProjects.has(approval.identity.cwd)) throw new Error("Project already has an active API test run");
		if (process.platform !== "darwin") throw new Error("Fixture OS isolation is only verified on macOS");
		this.attempted.add(request.runRef);
		this.activeProjects.add(approval.identity.cwd);
		const runRoot = resolve(this.outputRoot, request.runRef);
		const state = {
			schemaVersion: 1,
			runId: request.runRef,
			identity,
			collectionHash: approval.collectionHash,
			isolationPolicy: API_FIXTURE_ISOLATION_POLICY,
			status: "running",
			executionVerdict: "unknown",
			evidencePath: join(runRoot, "result.json"),
		};
		let client: McpClient | undefined;
		let outcome: unknown;
		let failure: unknown;
		let failed = false;
		const stop = AbortSignal.any([signal, AbortSignal.timeout(approval.timeoutMs)]);
		const onStop = (): void => client?.close();
		try {
			mkdirSync(runRoot, { recursive: true, mode: 0o700 });
			const save = (name: string, value: unknown): void =>
				writeFileSync(join(runRoot, name), JSON.stringify(value, null, 2), { mode: 0o600 });
			save("run.json", state); // durable run identity BEFORE the first request
			save("input.json", {
				runId: request.runRef,
				collection: JSON.parse(collection.toString()),
				requestTimeout: 1000,
			});
			writeFileSync(join(runRoot, "runner.mjs"), approval.runner);
			writeFileSync(join(runRoot, "network-guard.cjs"), approval.guard);
			client = new McpClient("api-testing-private", {
				command: "/usr/bin/env",
				args: [
					"-i",
					`HOME=${runRoot}`,
					`TMPDIR=${runRoot}`,
					`PI_API_TEST_RUNTIME=${this.pluginRoot}`,
					`PI_API_TEST_RUN_ROOT=${runRoot}`,
					`PI_API_TEST_FIXTURE_PORT=${new URL(approval.fixtureOrigin).port}`,
					`PI_API_TEST_NETWORK_LOG=${join(runRoot, "network.jsonl")}`,
					...prepareApiFixtureIsolation(runRoot, this.pluginRoot, Number(new URL(approval.fixtureOrigin).port)),
					process.execPath,
					"--require",
					join(runRoot, "network-guard.cjs"),
					join(runRoot, "runner.mjs"),
				],
				cwd: runRoot,
			});
			stop.addEventListener("abort", onStop, { once: true });
			stop.throwIfAborted();
			await client.start();
			if (client.getTools().length !== 1 || client.getTools()[0].name !== "runApprovedSuite")
				throw new Error("Unexpected private runner tool list");
			const result = (await client.call("runApprovedSuite", {}, approval.timeoutMs, stop)) as Record<string, any>;
			stop.throwIfAborted();
			if (
				result.runId !== request.runRef ||
				!["passed", "failed", "error", "blocked"].includes(result.executionVerdict)
			)
				throw new Error("Runner evidence is invalid");
			state.status = "completed";
			state.executionVerdict = result.executionVerdict;
			save("run.json", state);
			outcome = {
				runId: request.runRef,
				executionVerdict: result.executionVerdict,
				requests: result.requests,
				assertions: result.assertions,
				evidencePath: state.evidencePath,
				scope: "fixture",
			};
		} catch (error) {
			state.status = stop.aborted ? "canceled" : "error";
			// Preserve partial results independently; interruption cannot prove a rollback.
			try {
				writeFileSync(join(runRoot, "run.json"), JSON.stringify(state, null, 2));
			} catch {
				/* original failure wins */
			}
			failure = error;
			failed = true;
		}
		stop.removeEventListener("abort", onStop);
		try {
			await client?.closeAndWait();
		} catch (error) {
			state.status = "unknown";
			state.executionVerdict = "unknown";
			try {
				writeFileSync(join(runRoot, "run.json"), JSON.stringify(state, null, 2));
			} catch {
				/* preserve cleanup failure */
			}
			throw error; // retain the project lock while process termination is unproven
		}
		this.activeProjects.delete(approval.identity.cwd);
		if (failed) throw failure;
		return outcome;
	};
}
