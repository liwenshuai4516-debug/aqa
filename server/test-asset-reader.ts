/** Read-only adapters to native UI/API artifacts. Never approves or executes tests. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync, readdirSync, existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
export type TestEngine = "ui" | "api";
export type TestFileRef = { path: string; sha256: string };
export interface NativeTestAsset {
	engine: TestEngine;
	workspace: string;
	assetRef: string | TestFileRef;
	revision: string;
	cases: Array<{ id: string; title: string }>;
	environment: { id: string; baseUrl: string };
}
export interface NativeTestRun {
	engine: TestEngine;
	workspace: string;
	runId: string;
	parentRunId: string;
	assetRef: string | TestFileRef;
	environment: { id: string; baseUrl: string };
	at: string;
	rows: Array<{ caseId: string; instanceId: string; status: string; evidenceComplete: boolean }>;
	evidence: TestFileRef[];
	complete: boolean;
	review: string;
}
const hash = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
const digest = (s: unknown): string => {
	if (typeof s !== "string" || !/^[a-f0-9]{64}$/.test(s)) throw new Error("Invalid asset digest");
	return s;
};
function safeRead(root: string, path: string): Buffer {
	if (typeof path !== "string" || isAbsolute(path) || path.split(/[\\/]/).some((p) => !p || p === ".." || p === "."))
		throw new Error("Invalid native evidence path");
	const file = realpathSync(resolve(root, path)),
		rel = relative(realpathSync(root), file);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\"))
		throw new Error("Native evidence escapes its root");
	if (statSync(file).size > 16 * 1024 * 1024) throw new Error("Native evidence exceeds size limit");
	return readFileSync(file);
}
const json = (root: string, path: string): any => JSON.parse(safeRead(root, path).toString("utf8"));
function fileRef(value: unknown, prefix: string): TestFileRef {
	const ref = value as TestFileRef;
	if (!ref || typeof ref.path !== "string" || !ref.path.startsWith(prefix) || !ref.path.endsWith("/manifest.json"))
		throw new Error("Invalid UI artifact reference");
	return { path: ref.path, sha256: digest(ref.sha256) };
}
async function uiRuntime(): Promise<any> {
	// Optional runtime: resolve from the host installation, never from a target workspace.
	const name = "pi-ui-testing";
	return import(name);
}
export class TestAssetReader {
	constructor(private readonly dataDir: string) {}
	private apiRoot(workspace: string): string {
		return join(this.dataDir, "api-testing/assets", hash(workspace));
	}
	async list(engine: TestEngine, workspace: string): Promise<unknown[]> {
		workspace = realpathSync(workspace);
		const directory =
			engine === "ui" ? join(workspace, "qa/ui/runs") : engine === "api" ? join(this.apiRoot(workspace), "runs") : "";
		if (!directory) throw new Error("Unsupported test engine");
		if (!existsSync(directory)) return [];
		return readdirSync(directory, { withFileTypes: true })
			.filter((e) => e.isDirectory() && /^[a-zA-Z0-9._-]+$/.test(e.name))
			.flatMap<unknown>((e) => {
				try {
					if (engine === "api") return /^[a-f0-9-]{36}$/.test(e.name) ? [e.name] : [];
					const path = `qa/ui/runs/${e.name}/manifest.json`;
					return [{ path, sha256: hash(safeRead(workspace, path)) }];
				} catch {
					return [];
				} // Incomplete directories are not completed runs.
			});
	}
	async inspect(engine: TestEngine, workspace: string, reference: unknown): Promise<NativeTestAsset> {
		workspace = realpathSync(workspace);
		if (engine === "ui") {
			const ref = fileRef(reference, "qa/ui/assets/");
			const { ArtifactStore } = await uiRuntime(),
				store = new ArtifactStore(workspace);
			const asset = await store.load(ref);
			if (asset.kind !== "asset") throw new Error("Expected a native UI asset");
			const cases = await store.load(asset.data.cases_ref),
				scope = await store.load(asset.data.scope_ref);
			return {
				engine,
				workspace,
				assetRef: ref,
				revision: asset.data.revision,
				cases: cases.data.cases.map((c: any) => ({ id: c.case_id, title: c.title ?? c.case_id })),
				environment: { id: scope.data.environment_id, baseUrl: scope.data.base_url ?? "" },
			};
		}
		if (engine !== "api") throw new Error("Unsupported test engine");
		const ref = digest(reference),
			root = join(this.apiRoot(workspace), "suites", ref);
		const meta = json(root, "asset.json");
		if (meta.assetRef !== ref || meta.projectRoot !== workspace || hash(safeRead(root, "manifest.json")) !== ref)
			throw new Error("API asset owner/hash differs");
		const required = [
			"manifest.json",
			"source.json",
			"resolved-source.json",
			"cases.json",
			"rules.json",
			"collection.json",
			"review.json",
		];
		if (JSON.stringify(Object.keys(meta.files ?? {}).sort()) !== JSON.stringify(required.sort()))
			throw new Error("API asset files incomplete");
		for (const name of required)
			if (hash(safeRead(root, name)) !== digest(meta.files[name])) throw new Error("API asset evidence changed");
		// Reuse the installed, host-owned compiler/review validator; never load code from the test workspace.
		const { inspectDraft, REVIEW_POLICY } = await import(
			pathToFileURL(join(this.dataDir, "plugins/api-testing/review.mjs")).href
		);
		const inspected = await inspectDraft(this.apiRoot(workspace), root),
			review = json(root, "review.json");
		if (
			review.verdict !== "pass" ||
			review.policyVersion !== REVIEW_POLICY ||
			review.suiteHash !== inspected.suiteHash ||
			review.artifactHash !== inspected.artifactHash
		)
			throw new Error("API asset is not frozen/reviewed");
		const cases = inspected.cases;
		return {
			engine,
			workspace,
			assetRef: ref,
			revision: ref,
			cases: cases.map((c: any) => ({ id: c.id, title: c.id })),
			environment: { id: "", baseUrl: meta.origin },
		};
	}
	async read(engine: TestEngine, workspace: string, reference: unknown): Promise<NativeTestRun> {
		workspace = realpathSync(workspace);
		if (engine === "ui") {
			const ref = fileRef(reference, "qa/ui/runs/");
			const { ArtifactStore, reconcileRun } = await uiRuntime(),
				store = new ArtifactStore(workspace);
			const run = await store.load(ref, false);
			if (run.kind !== "run") throw new Error("Expected native UI run");
			const asset = await this.inspect(engine, workspace, run.data.asset_ref);
			const reconciled = await reconcileRun(workspace, ref);
			return {
				engine,
				workspace,
				runId: run.id,
				parentRunId: run.data.parent_run_id ?? "",
				assetRef: asset.assetRef,
				environment: { ...asset.environment, id: run.data.environment_id },
				at: run.created_at,
				rows: reconciled.data.instances.map((i: any) => ({
					caseId: run.data.plan.find((p: any) => p.instance_id === i.instance_id)?.case_id ?? "",
					instanceId: i.instance_id,
					status: i.status,
					evidenceComplete: i.evidence_state === "complete" && reconciled.details.complete,
				})),
				evidence: [ref, ...run.data.output_refs],
				complete: reconciled.details.complete,
				review: "execution-evidence-only",
			};
		}
		if (engine !== "api" || typeof reference !== "string" || !/^[a-f0-9-]{36}$/.test(reference))
			throw new Error("Invalid native API run id");
		const root = join(this.apiRoot(workspace), "runs", reference),
			run = json(root, "run.json");
		if (run.runId !== reference || run.projectRoot !== workspace || run.status === "running")
			throw new Error("API run owner differs or run is still active");
		const asset = await this.inspect(engine, workspace, run.assetRef);
		const evidence: TestFileRef[] = [
			{
				path: `api-testing/assets/${hash(workspace)}/runs/${reference}/run.json`,
				sha256: hash(safeRead(root, "run.json")),
			},
		];
		if (run.status === "unknown")
			return {
				engine,
				workspace,
				runId: reference,
				parentRunId: run.priorRunId ?? "",
				assetRef: asset.assetRef,
				environment: asset.environment,
				at: run.finishedAt ?? run.startedAt,
				rows: asset.cases.map((c) => ({ caseId: c.id, instanceId: c.id, status: "unknown", evidenceComplete: false })),
				evidence,
				complete: false,
				review: "incomplete-native-run; never replay automatically",
			};
		for (const name of ["results.json", "findings.json", "report.json", "report.md"]) {
			const bytes = safeRead(root, name),
				sha256 = hash(bytes);
			if (sha256 !== run.fileHashes?.[name]) throw new Error("Native API run evidence changed");
			evidence.push({ path: `api-testing/assets/${hash(workspace)}/runs/${reference}/${name}`, sha256 });
		}
		const raw = json(root, "results.json"),
			report = json(root, "report.json");
		if (report.runId !== reference || report.executionVerdict !== run.status)
			throw new Error("API report and run disagree");
		if (raw.runId !== reference || raw.executionVerdict !== report.executionVerdict)
			throw new Error("API raw result and report disagree");
		const unknown = !["passed", "failed", "blocked", "error"].includes(report.executionVerdict);
		return {
			engine,
			workspace,
			runId: reference,
			parentRunId: run.priorRunId ?? "",
			assetRef: asset.assetRef,
			environment: asset.environment,
			at: run.finishedAt ?? run.startedAt,
			rows: asset.cases.map((c) => {
				const executions = (raw.executions ?? []).filter((e: any) => e.caseId === c.id);
				const assertions = executions.flatMap((e: any) => e.assertions ?? []);
				const status = unknown
					? "unknown"
					: !executions.length
						? "not-run"
						: executions.some((e: any) => e.requestError)
							? "blocked"
							: executions.some((e: any) => e.response?.jsonValid === false) ||
								  assertions.some((a: any) => !a.passed && !a.skipped)
								? "failed"
								: assertions.some((a: any) => a.skipped)
									? "skipped"
									: assertions.length && assertions.every((a: any) => a.passed)
										? "passed"
										: "unknown";
				return { caseId: c.id, instanceId: c.id, status, evidenceComplete: !unknown && status !== "unknown" };
			}),
			evidence,
			complete: !unknown,
			review: "execution-evidence-only",
		};
	}
}
