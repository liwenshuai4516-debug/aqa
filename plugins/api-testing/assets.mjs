/** P2-1: host-owned immutable packages and run evidence, outside the removable plugin directory. */
import {
	mkdirSync,
	readFileSync,
	writeFileSync,
	realpathSync,
	readdirSync,
	renameSync,
	unlinkSync,
	existsSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { hash } from "./suite.mjs";
import { inspectDraft, REVIEW_POLICY } from "./review.mjs";
import { buildReport } from "./report.mjs";
import { createAssetManagement } from "./asset-management.mjs";
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const fail = (message) => {
	throw new Error(message);
};
const read = (path) => {
	const bytes = readFileSync(path);
	if (bytes.length > 4 * 1024 * 1024) fail("Asset file exceeds limit");
	return bytes;
};
const atomic = (path, value) => {
	const temp = path + ".tmp-" + randomUUID();
	writeFileSync(temp, json(value), { mode: 0o600, flag: "wx" });
	try {
		renameSync(temp, path);
	} catch (e) {
		unlinkSync(temp);
		throw e;
	}
};
const id = (value) => {
	if (!/^[a-f0-9]{64}$/.test(value ?? "")) fail("Invalid asset reference");
	return value;
};
const runId = (value) => {
	if (!/^[a-f0-9-]{36}$/.test(value ?? "")) fail("Invalid run reference");
	return value;
};
const safeFile = (root, name) => {
	if (!/^[a-zA-Z0-9.-]+$/.test(name) || name === "..") fail("Unsafe asset filename");
	const file = realpathSync(join(root, name));
	if (relative(realpathSync(root), file) !== name) fail("Asset file escapes its directory");
	return file;
};

export function createAssetStore({ root, policyHash, approve, execute }) {
	let owner;
	const running = new Set();
	const lock = () => {
		mkdirSync(root, { recursive: true, mode: 0o700 });
		if (owner) {
			if (JSON.parse(read(join(root, ".owner.json"))).token !== owner) fail("Asset store ownership changed");
			return;
		}
		const token = randomUUID();
		try {
			writeFileSync(join(root, ".owner.json"), json({ pid: process.pid, token }), { flag: "wx", mode: 0o600 });
		} catch {
			fail("Asset root is already owned; stale ownership requires operator verification before recovery");
		}
		owner = token;
	};
	const project = (identity, writable = true) => {
		if (writable) lock();
		const cwd = realpathSync(identity.cwd),
			projectId = hash(cwd),
			base = join(root, projectId);
		for (const dir of writable ? ["suites", "runs", "staging"] : [])
			mkdirSync(join(base, dir), { recursive: true, mode: 0o700 });
		return { cwd, projectId, base };
	};
	const load = async (p, assetRef) => {
		const bundle = join(p.base, "suites", id(assetRef));
		const metadata = JSON.parse(read(safeFile(bundle, "asset.json")));
		if (metadata.projectRoot !== p.cwd || metadata.assetRef !== assetRef || metadata.policyHash !== policyHash)
			fail("Asset owner or approval policy differs");
		for (const [name, digest] of Object.entries(metadata.files))
			if (hash(read(safeFile(bundle, name))) !== digest) fail("Stored asset changed");
		if (hash(read(safeFile(bundle, "manifest.json"))) !== assetRef) fail("Stored manifest changed");
		const inspected = await inspectDraft(p.base, bundle);
		const review = JSON.parse(inspected.files["review.json"]);
		if (
			review.verdict !== "pass" ||
			review.policyVersion !== REVIEW_POLICY ||
			review.suiteHash !== inspected.suiteHash ||
			review.artifactHash !== inspected.artifactHash
		)
			fail("Stored review does not approve the frozen suite");
		return { bundle, metadata, inspected };
	};
	const histories = (p) =>
		readdirSync(join(p.base, "runs"))
			.filter((name) => /^[a-f0-9-]{36}$/.test(name))
			.map((name) => {
				const dir = join(p.base, "runs", name),
					record = JSON.parse(read(safeFile(dir, "run.json")));
				if (record.runId !== name || record.projectRoot !== p.cwd) fail("Run identity differs");
				return record.status === "running"
					? { ...record, status: "unknown", recovery: "interrupted; never automatically replayed" }
					: record;
			});
	const rebuild = async (p) => {
		const assets = [];
		for (const assetRef of readdirSync(join(p.base, "suites"))) {
			if (!/^[a-f0-9]{64}$/.test(assetRef)) continue;
			try {
				const { metadata } = await load(p, assetRef);
				assets.push(metadata);
			} catch {
				assets.push({ assetRef, status: "invalid-or-incomplete" });
			}
		}
		const result = { schemaVersion: 1, projectId: p.projectId, assets, runs: histories(p) };
		atomic(join(p.base, "index.json"), result);
		return result;
	};
	const publish = async (identity, bundlePath) => {
		const p = project(identity),
			inspected = await inspectDraft(identity.cwd, bundlePath);
		const review = JSON.parse(inspected.files["review.json"]);
		if (
			review.verdict !== "pass" ||
			review.policyVersion !== REVIEW_POLICY ||
			review.suiteHash !== inspected.suiteHash ||
			review.artifactHash !== inspected.artifactHash
		)
			fail("Only live independently approved packages can be published");
		const manifest = read(join(inspected.bundlePath, "manifest.json")),
			assetRef = hash(manifest);
		const target = join(p.base, "suites", assetRef);
		if (existsSync(target)) {
			await load(p, assetRef);
			return { assetRef, duplicate: true };
		}
		const staged = join(p.base, "staging", randomUUID());
		mkdirSync(staged, { mode: 0o700 });
		const files = { "manifest.json": manifest, ...inspected.files };
		for (const [name, bytes] of Object.entries(files))
			writeFileSync(join(staged, name), bytes, { flag: "wx", mode: 0o600 });
		const metadata = {
			schemaVersion: 1,
			assetRef,
			projectRoot: p.cwd,
			policyHash,
			createdAt: new Date().toISOString(),
			origin: new URL(inspected.collection.item[0].request.url).origin,
			files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])),
		};
		for (const [name, digest] of Object.entries(metadata.files))
			if (hash(read(safeFile(staged, name))) !== digest) fail("Staged asset failed validation");
		writeFileSync(join(staged, "asset.json"), json(metadata), { flag: "wx", mode: 0o600 });
		renameSync(staged, target); // Never fall back to overwriting a partly published package.
		await load(p, assetRef);
		await rebuild(p);
		return { assetRef, duplicate: false };
	};
	const copyRun = (identity, assetRef, source) => {
		const p = project(identity),
			sourcePath = realpathSync(source);
		const rel = relative(p.cwd, sourcePath);
		if (rel === ".." || rel.startsWith("../")) fail("Run evidence is outside its project");
		const record = JSON.parse(read(safeFile(sourcePath, "run.json")));
		const target = join(p.base, "runs", runId(record.runId));
		mkdirSync(target, { mode: 0o700 });
		const report = JSON.parse(read(safeFile(sourcePath, "report.json")));
		for (const name of ["results.json", "findings.json", "report.json", "report.md"])
			writeFileSync(join(target, name), read(safeFile(sourcePath, name)), { flag: "wx", mode: 0o600 });
		atomic(join(target, "run.json"), {
			...record,
			projectRoot: p.cwd,
			assetRef,
			hasWrites: report.cleanup !== "not-required",
			importedFromP1: true,
			fileHashes: Object.fromEntries(
				["results.json", "findings.json", "report.json", "report.md"].map((name) => [
					name,
					hash(read(join(target, name))),
				]),
			),
		});
	};
	const management = createAssetManagement({ root, policyHash, project, load, histories, rebuild });
	return {
		publish,
		copyRun,
		isArchived(identity, assetRef) {
			return management.isArchived(project(identity, false), assetRef);
		},
		close() {
			if (running.size) fail("Stored API run is still active");
			if (owner) {
				if (JSON.parse(read(join(root, ".owner.json"))).token !== owner) fail("Asset ownership changed");
				unlinkSync(join(root, ".owner.json"));
				owner = undefined;
			}
		},
		async call(identity, input, signal) {
			if (management.handles(input.action)) return management.call(identity, input, signal);
			const allowed = {
				asset_import: ["action", "sourcePath"],
				asset_inspect: ["action", "assetRef"],
				asset_report: ["action", "runId"],
				asset_run: ["action", "assetRef", "priorRunId"],
			};
			if (!allowed[input.action] || Object.keys(input).some((k) => !allowed[input.action].includes(k)))
				fail("Unsupported asset action/argument");
			signal.throwIfAborted();
			const p = project(identity, input.action === "asset_run");
			if (input.action === "asset_import") {
				const source = realpathSync(resolve(identity.cwd, input.sourcePath));
				const inspected = await inspectDraft(identity.cwd, source);
				const assetRef = hash(read(join(source, "manifest.json")));
				// Imports cannot make a copied pass label authoritative. Only an exact host-published version can reuse approval.
				if (!existsSync(join(p.base, "suites", assetRef, "asset.json")))
					fail("Imported pass label has no host provenance; prepare and independently review it before reuse");
				await load(p, assetRef);
				for (const [name, bytes] of Object.entries(inspected.files)) {
					if (hash(bytes) !== hash(read(join(p.base, "suites", assetRef, name))))
						fail("Import differs from approved stored version");
				}
				return { assetRef, duplicate: true, sourcePreserved: true };
			}
			if (input.action === "asset_report") {
				const record = histories(p).find((r) => r.runId === input.runId) ?? fail("Unknown stored run");
				const dir = join(p.base, "runs", runId(input.runId));
				if (record.status === "unknown") return { record, scope: "historical; incomplete evidence; no requests" };
				for (const [name, digest] of Object.entries(record.fileHashes ?? {}))
					if (hash(read(safeFile(dir, name))) !== digest) fail("Stored run evidence changed");
				return {
					record,
					report: JSON.parse(read(safeFile(dir, "report.json"))),
					reportPath: join(dir, "report.md"),
					scope: "historical; no requests or model calls",
				};
			}
			if (input.action === "asset_run") {
				if (running.has(p.projectId)) fail("Project already has an active stored run");
				running.add(p.projectId);
			}
			try {
				const { bundle, metadata, inspected } = await load(p, input.assetRef);
				if (input.action === "asset_inspect") {
					const result = {
						metadata,
						cases: inspected.cases,
						collection: inspected.collection,
						scope: "read-only; no requests or model calls",
					};
					if (json(result).length <= 48000) return result;
					return {
						metadata,
						caseIds: inspected.cases.map((c) => c.id),
						collectionPath: join(bundle, "collection.json"),
						collectionExcerpt: json(inspected.collection).slice(0, 16000),
						truncated: true,
					};
				}
				if (management.isArchived(p, input.assetRef)) fail("Archived asset cannot execute; explicitly unarchive first");
				const previousRuns = histories(p);
				if (previousRuns.some((r) => r.hasWrites && ["running", "unknown"].includes(r.status)))
					fail("Unknown writes require reconciliation; no request sent");
				const prior = input.priorRunId
					? (previousRuns.find((r) => r.runId === input.priorRunId && r.assetRef === input.assetRef) ??
						fail("Retest needs a run of the same version"))
					: undefined;
				let previous = [];
				if (prior?.fileHashes) {
					const bytes = read(safeFile(join(p.base, "runs", prior.runId), "findings.json"));
					if (hash(bytes) !== prior.fileHashes["findings.json"]) fail("Prior findings changed");
					previous = JSON.parse(bytes);
				}
				const reference = approve({ identity, bundleRoot: bundle, fixtureOrigin: metadata.origin });
				const dir = join(p.base, "runs", reference);
				mkdirSync(dir, { mode: 0o700 });
				const cases = inspected.cases.map((c, i) => ({
					id: c.id,
					phase: c.phase ?? "main",
					method: inspected.collection.item[i].request.method,
				}));
				const record = {
					schemaVersion: 1,
					runId: reference,
					projectRoot: p.cwd,
					assetRef: input.assetRef,
					startedAt: new Date().toISOString(),
					priorRunId: prior?.runId ?? null,
					status: "running",
					hasWrites: cases.some((c) => !["GET", "HEAD", "OPTIONS"].includes(c.method)),
					modelCalls: { generation: 0, review: 0, analysis: 0 },
				};
				atomic(join(dir, "run.json"), record);
				let evidence,
					interrupted = false;
				try {
					const result = await execute(
						identity,
						{ serverId: "api-testing", toolName: "runApprovedSuite", runRef: reference },
						signal,
					);
					evidence = JSON.parse(read(result.evidencePath));
				} catch {
					interrupted = true;
					evidence = { executionVerdict: "unknown", executions: [] };
				}
				const report = buildReport({
					runId: reference,
					suiteHash: inspected.suiteHash,
					evidence,
					interrupted,
					previous,
					priorRunId: record.priorRunId,
					cases,
				});
				const files = {
					"results.json": json(evidence),
					"findings.json": json(report.findings),
					"report.json": json(report),
					"report.md": report.markdown,
				};
				for (const [name, value] of Object.entries(files))
					writeFileSync(join(dir, name), value, { mode: 0o600, flag: "wx" });
				atomic(join(dir, "run.json"), {
					...record,
					status: report.executionVerdict,
					finishedAt: new Date().toISOString(),
					fileHashes: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)])),
				});
				await rebuild(p);
				return {
					runId: reference,
					assetRef: input.assetRef,
					executionVerdict: report.executionVerdict,
					reportPath: join(dir, "report.md"),
					modelCalls: record.modelCalls,
				};
			} finally {
				if (input.action === "asset_run") running.delete(p.projectId);
			}
		},
	};
}
