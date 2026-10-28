/** Read-only adapters to native UI/API artifacts. Never approves or executes tests. */
import { createHash } from "node:crypto";
import {
	readFileSync,
	realpathSync,
	statSync,
	readdirSync,
	existsSync,
	lstatSync,
	mkdirSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
export type TestEngine = "ui" | "api";
export type TestFileRef = { path: string; sha256: string };
export interface NativeTestAsset {
	engine: TestEngine;
	workspace: string;
	assetRef: string | TestFileRef;
	revision: string;
	/** False for archival drafts; this field never grants execution approval. */
	executable?: boolean;
	lineageId?: string;
	cases: Array<{
		id: string;
		moduleId?: string;
		featureId?: string;
		title: string;
		priority?: string;
		preconditions?: string[];
		steps?: Array<{ action: string; expect: string }>;
	}>;
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
const apiCases = (cases: any[]): NativeTestAsset["cases"] =>
	cases.map((c: any) => ({
		id: c.id,
		title: c.operationId ?? c.id,
		steps: [
			{
				action: `调用 ${c.operationId}（请求数据见原生资产）`,
				expect: `HTTP ${c.status}; ${JSON.stringify(c.checks ?? [])}`,
			},
		],
	}));
async function uiRuntime(): Promise<any> {
	// Optional runtime: resolve from the host installation, never from a target workspace.
	const name = "pi-ui-testing";
	return import(name);
}
export function trustedUiEvidenceAuthority(
	workspace: string,
	active: { cwd?: string; sessionDir?: string } | null,
): string | undefined {
	if (!active?.cwd || !active.sessionDir) return undefined;
	try {
		if (realpathSync(active.cwd) !== realpathSync(workspace)) return undefined;
		return join(active.sessionDir, "ui-review-authority");
	} catch {
		return undefined;
	}
}
export class TestAssetReader {
	constructor(
		private readonly dataDir: string,
		private readonly authorityForWorkspace?: (workspace: string) => string | undefined,
	) {}
	private registryDirectory(create = false): string {
		const root = join(realpathSync(this.dataDir), "ui-evidence-authorities");
		if (create) mkdirSync(root, { mode: 0o700, recursive: true });
		const stat = lstatSync(root);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			stat.mode & 0o077 ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new Error("Private evidence registry is not secure");
		return root;
	}
	private registeredAuthority(workspace: string, ref: TestFileRef): string | undefined {
		try {
			const dir = this.registryDirectory(),
				path = join(dir, `${hash(JSON.stringify([workspace, ref]))}.json`);
			const stat = lstatSync(path);
			if (
				!stat.isFile() ||
				stat.isSymbolicLink() ||
				stat.mode & 0o077 ||
				(process.getuid && stat.uid !== process.getuid())
			)
				return undefined;
			const record = JSON.parse(readFileSync(path, "utf8"));
			if (
				record.version !== 1 ||
				record.workspace !== workspace ||
				JSON.stringify(record.runRef) !== JSON.stringify(ref) ||
				typeof record.authority !== "string" ||
				!isAbsolute(record.authority)
			)
				return undefined;
			return record.authority;
		} catch {
			return undefined;
		}
	}
	async registerEvidence(workspace: string, reference: unknown): Promise<{ ok: true; registered: boolean }> {
		workspace = realpathSync(workspace);
		const ref = fileRef(reference, "qa/ui/runs/"),
			authority = this.authorityForWorkspace?.(workspace);
		if (!authority) throw new Error("Original session is required to register private evidence");
		const { reconcileRun } = await uiRuntime();
		const checked = await reconcileRun(workspace, ref, authority);
		if (
			!checked.details.complete ||
			!checked.data.instances.some((i: any) => i.evidence_visibility?.private_trace_integrity === "verified") ||
			checked.data.instances.some(
				(i: any) => i.evidence_visibility && i.evidence_visibility.private_trace_integrity !== "verified",
			)
		)
			throw new Error("Private evidence is not completely verified for this run");
		const canonical = realpathSync(authority),
			dir = this.registryDirectory(true);
		const path = join(dir, `${hash(JSON.stringify([workspace, ref]))}.json`);
		const record = { version: 1, workspace, runRef: ref, authority: canonical };
		try {
			writeFileSync(path, JSON.stringify(record), { mode: 0o600, flag: "wx" });
		} catch (error: any) {
			if (error.code !== "EEXIST" || this.registeredAuthority(workspace, ref) !== canonical)
				throw new Error("Private evidence registration failed");
			return { ok: true, registered: false };
		}
		return { ok: true, registered: true };
	}
	private archiveRecord(workspace: string, ref: TestFileRef): { backup: string; manifestSha256: string } {
		const dir = this.registryDirectory();
		const path = join(dir, `archive-${hash(JSON.stringify([workspace, ref]))}.json`);
		const info = lstatSync(path);
		if (
			!info.isFile() ||
			info.isSymbolicLink() ||
			info.mode & 0o077 ||
			(process.getuid && info.uid !== process.getuid())
		)
			throw new Error("Private archive registration is not secure");
		const record = JSON.parse(readFileSync(path, "utf8"));
		if (
			record.version !== 1 ||
			record.workspace !== workspace ||
			JSON.stringify(record.runRef) !== JSON.stringify(ref) ||
			typeof record.backup !== "string" ||
			!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(record.backup)
		)
			throw new Error("Invalid private archive registration");
		return { backup: record.backup, manifestSha256: digest(record.manifestSha256) };
	}
	private archiveRoot(record: { backup: string; manifestSha256: string }): { root: string; manifest: any } {
		const parent = join(realpathSync(this.dataDir), "ui-private-evidence-backups");
		const root = join(parent, record.backup);
		const authority = join(root, "authority");
		for (const path of [parent, root, join(root, "workspace"), join(root, "manifest.json"), authority]) {
			if (path === authority && !existsSync(path)) continue;
			const info = lstatSync(path);
			if (info.isSymbolicLink() || info.mode & 0o077 || (process.getuid && info.uid !== process.getuid()))
				throw new Error("Private archive is not secure");
			if (path === join(root, "manifest.json") ? !info.isFile() || info.size > 4 * 1024 * 1024 : !info.isDirectory())
				throw new Error("Invalid private archive entry");
		}
		if (realpathSync(root) !== root) throw new Error("Private archive path is not canonical");
		const bytes = readFileSync(join(root, "manifest.json"));
		if (hash(bytes) !== record.manifestSha256) throw new Error("Private archive manifest changed");
		const manifest = JSON.parse(bytes.toString("utf8"));
		if (manifest.schema !== "ui-evidence-backup/v1" || !Array.isArray(manifest.entries))
			throw new Error("Invalid private archive manifest");
		return { root, manifest };
	}
	async registerEvidenceArchive(
		workspace: string,
		reference: unknown,
		backup: string,
		manifestSha256: string,
	): Promise<{ ok: true; registered: boolean }> {
		workspace = realpathSync(workspace);
		const ref = fileRef(reference, "qa/ui/runs/"),
			authority = this.authorityForWorkspace?.(workspace);
		if (!authority) throw new Error("Original session is required to register a private archive");
		if (typeof backup !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(backup))
			throw new Error("Invalid private archive name");
		const record = { backup, manifestSha256: digest(manifestSha256) };
		const { root, manifest } = this.archiveRoot(record);
		if (
			realpathSync(manifest.originalWorkspace) !== workspace ||
			realpathSync(manifest.originalAuthority) !== realpathSync(authority)
		)
			throw new Error("Private archive does not belong to this session");
		const actual: any[] = [];
		const scan = (label: string) => {
			const path = join(root, label),
				info = lstatSync(path);
			if (info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()))
				throw new Error("Invalid private archive entry");
			if (info.isDirectory()) {
				actual.push({ path: label, type: "directory", mode: info.mode & 0o777 });
				for (const name of readdirSync(path).sort()) scan(`${label}/${name}`);
			} else if (info.isFile())
				actual.push({
					path: label,
					type: "file",
					mode: info.mode & 0o777,
					bytes: info.size,
					sha256: hash(readFileSync(path)),
				});
			else throw new Error("Invalid private archive entry");
		};
		for (const label of [
			"workspace/qa",
			"workspace/tests",
			"workspace/package.json",
			"workspace/playwright.config.mjs",
			"authority",
		])
			scan(label);
		if (JSON.stringify(actual) !== JSON.stringify(manifest.entries))
			throw new Error("Private archive content differs from manifest");
		const { reconcileRun } = await uiRuntime();
		const original = await reconcileRun(workspace, ref, authority);
		const archived = await reconcileRun(join(root, "workspace"), ref, join(root, "authority"), {
			originalWorkspace: manifest.originalWorkspace,
		});
		if (
			!original.details.complete ||
			!archived.details.complete ||
			!archived.data.instances.some((i: any) => i.evidence_visibility?.private_trace_integrity === "verified")
		)
			throw new Error("Private archive evidence is incomplete");
		const path = join(this.registryDirectory(true), `archive-${hash(JSON.stringify([workspace, ref]))}.json`);
		const value = { version: 1, workspace, runRef: ref, ...record };
		try {
			writeFileSync(path, JSON.stringify(value), { mode: 0o600, flag: "wx" });
		} catch (error: any) {
			if (error.code !== "EEXIST" || JSON.stringify(this.archiveRecord(workspace, ref)) !== JSON.stringify(record))
				throw new Error("Private archive registration failed");
			return { ok: true, registered: false };
		}
		return { ok: true, registered: true };
	}
	async readEvidenceArchive(workspace: string, reference: unknown): Promise<NativeTestRun> {
		if (!isAbsolute(workspace) || resolve(workspace) !== workspace) throw new Error("Invalid original workspace");
		const ref = fileRef(reference, "qa/ui/runs/"),
			record = this.archiveRecord(workspace, ref);
		const { root, manifest } = this.archiveRoot(record);
		if (resolve(manifest.originalWorkspace) !== workspace) throw new Error("Private archive workspace differs");
		const archiveWorkspace = join(root, "workspace");
		const { ArtifactStore, reconcileRun } = await uiRuntime();
		const run = await new ArtifactStore(archiveWorkspace).load(ref, false);
		if (run.kind !== "run") throw new Error("Expected native UI run");
		const asset = await this.inspect("ui", archiveWorkspace, run.data.asset_ref);
		if (asset.executable === false) throw new Error("Native UI run cannot reference a draft");
		const result = await reconcileRun(archiveWorkspace, ref, join(root, "authority"), {
			originalWorkspace: manifest.originalWorkspace,
		});
		return {
			engine: "ui",
			workspace,
			runId: run.id,
			parentRunId: run.data.parent_run_id ?? "",
			assetRef: asset.assetRef,
			environment: { ...asset.environment, id: run.data.environment_id },
			at: run.created_at,
			rows: result.data.instances.map((i: any) => ({
				caseId: run.data.plan.find((p: any) => p.instance_id === i.instance_id)?.case_id ?? "",
				instanceId: i.instance_id,
				status: i.status,
				evidenceComplete: i.evidence_state === "complete" && result.details.complete,
			})),
			evidence: [ref, ...run.data.output_refs],
			complete: result.details.complete,
			review: "execution-evidence-only",
		};
	}
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
			const draft = (reference as TestFileRef | null)?.path?.startsWith("qa/ui/cases/") === true;
			const ref = fileRef(reference, draft ? "qa/ui/cases/" : "qa/ui/assets/");
			const { ArtifactStore } = await uiRuntime(),
				store = new ArtifactStore(workspace);
			const asset = await store.load(ref);
			if (asset.kind !== (draft ? "cases" : "asset")) throw new Error("Expected a native UI asset or cases draft");
			const cases = draft ? asset : await store.load(asset.data.cases_ref),
				scope = await store.load(cases.data.scope_ref);
			if (cases.kind !== "cases" || scope.kind !== "scope") throw new Error("Invalid UI cases/scope kind");
			if (!draft && JSON.stringify(asset.data.scope_ref) !== JSON.stringify(cases.data.scope_ref))
				throw new Error("UI asset/cases scope differs");
			return {
				engine,
				workspace,
				assetRef: ref,
				revision: draft ? ref.sha256 : asset.data.revision,
				executable: !draft,
				lineageId: draft ? undefined : asset.id,
				cases: cases.data.cases.map((c: any) => ({
					id: c.case_id,
					moduleId: c.module_id,
					featureId: c.feature_id,
					title: c.title ?? c.case_id,
					priority: c.priority,
					preconditions: c.preconditions,
					steps: c.steps.map((step: any) => ({
						action: step.action,
						expect: c.assertions
							.filter((a: any) => step.assertion_ids.includes(a.assertion_id))
							.map((a: any) => `${a.target} ${a.comparison} ${JSON.stringify(a.expected)}`)
							.join("\n"),
					})),
				})),
				environment: { id: scope.data.environment_id, baseUrl: scope.data.base_url ?? "" },
			};
		}
		if (engine !== "api") throw new Error("Unsupported test engine");
		if (reference && typeof reference === "object") {
			const candidate = reference as TestFileRef;
			if (typeof candidate.path !== "string" || !candidate.path.endsWith("/manifest.json"))
				throw new Error("Invalid API draft manifest path");
			const ref = { path: candidate.path, sha256: digest(candidate.sha256) };
			if (hash(safeRead(workspace, ref.path)) !== ref.sha256) throw new Error("API draft manifest hash differs");
			// Only the host-installed validator may interpret workspace-controlled draft data.
			const { inspectDraft } = await import(pathToFileURL(join(this.dataDir, "plugins/api-testing/review.mjs")).href);
			const inspected = await inspectDraft(workspace, dirname(resolve(workspace, ref.path)));
			return {
				engine,
				workspace,
				assetRef: ref,
				revision: ref.sha256,
				executable: false,
				cases: apiCases(inspected.cases),
				environment: { id: "", baseUrl: new URL(inspected.collection.item[0].request.url).origin },
			};
		}
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
			executable: true,
			cases: apiCases(cases),
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
			if (asset.executable === false) throw new Error("Native UI run cannot reference a draft");
			const authority = this.authorityForWorkspace?.(workspace);
			let reconciled = await reconcileRun(workspace, ref, authority);
			const registered = this.registeredAuthority(workspace, ref);
			if (!reconciled.details.complete && registered && registered !== authority)
				reconciled = await reconcileRun(workspace, ref, registered);
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
		if (typeof run.assetRef !== "string") throw new Error("Native API run requires a frozen asset digest, not a draft");
		const asset = await this.inspect(engine, workspace, run.assetRef);
		if (asset.executable === false) throw new Error("Native API run cannot reference a draft");
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
