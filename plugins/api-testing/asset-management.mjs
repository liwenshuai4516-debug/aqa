/** P2-2: small management operations over verified whole-suite assets. */
import {
	mkdirSync,
	readFileSync,
	writeFileSync,
	realpathSync,
	readdirSync,
	existsSync,
	renameSync,
	rmSync,
} from "node:fs";
import { join, resolve, relative, dirname, basename } from "node:path";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { hash, compileSuite, saveDraft } from "./suite.mjs";
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const fail = (message) => {
	throw new Error(message);
};
const read = (path) => {
	const bytes = readFileSync(path);
	if (bytes.length > 4 * 1024 * 1024) fail("Management file exceeds limit");
	return bytes;
};
const record = (path) => JSON.parse(read(path));
const actions = {
	asset_list: ["action", "offset"],
	asset_clone: ["action", "assetRef", "outputPath", "cases"],
	asset_archive: ["action", "assetRef", "archived"],
	asset_delete: ["action", "assetRef"],
	asset_export: ["action", "assetRef", "outputPath"],
	asset_restore: ["action", "sourcePath"],
};
const inside = (root, path) => {
	const canonicalRoot = realpathSync(root);
	const rel = relative(canonicalRoot, path);
	if (rel === ".." || rel.startsWith("../") || resolve(canonicalRoot, rel) !== path)
		fail("Path is outside the selected project");
	return path;
};
const target = (root, input) => {
	if (typeof input !== "string" || !input) fail("A new outputPath is required");
	const path = resolve(root, input);
	inside(root, realpathSync(dirname(path)));
	if (existsSync(path)) fail("Output already exists; never overwrite");
	return join(realpathSync(dirname(path)), basename(path));
};
const atomic = (path, value) => {
	const tmp = path + ".tmp-" + randomUUID();
	writeFileSync(tmp, json(value), { flag: "wx", mode: 0o600 });
	renameSync(tmp, path);
};
export function createAssetManagement({ root, policyHash, project, load, histories, rebuild }) {
	const statePath = (p, ref) => join(p.base, "states", ref + ".json");
	const state = (p, ref) => {
		const path = statePath(p, ref);
		if (!existsSync(path)) return { assetRef: ref, archived: false };
		const value = record(path);
		if (value.assetRef !== ref || typeof value.archived !== "boolean") fail("Asset state is corrupt");
		return value;
	};
	const key = () => {
		const path = join(root, ".backup-key");
		if (!existsSync(path)) writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
		const bytes = read(path);
		if (bytes.length !== 32) fail("Backup signing key is invalid");
		return bytes;
	};
	const sign = (value) => createHmac("sha256", key()).update(json(value)).digest("hex");
	const file = (base, name) => {
		if (
			!/^(suite\/[a-zA-Z0-9.-]+|runs\/[a-f0-9-]{36}\/[a-zA-Z0-9.-]+|suite-state.json)$/.test(name) ||
			name.split("/").includes("..")
		)
			fail("Invalid backup filename");
		return inside(base, realpathSync(join(base, name)));
	};
	const copyFiles = (source, entries, dest) => {
		mkdirSync(dest, { mode: 0o700 });
		for (const name of entries) {
			const bytes = read(inside(source, realpathSync(join(source, name))));
			writeFileSync(join(dest, name), bytes, { flag: "wx", mode: 0o600 });
		}
	};
	return {
		handles: (action) => !!actions[action],
		isArchived: (p, ref) => state(p, ref).archived,
		async call(identity, input, signal) {
			if (!actions[input.action] || Object.keys(input).some((k) => !actions[input.action].includes(k)))
				fail("Unsupported management argument");
			signal.throwIfAborted();
			const writable = !["asset_list", "asset_clone"].includes(input.action);
			const p = project(identity, writable);
			if (input.action === "asset_list") {
				const offset = input.offset ?? 0;
				if (!Number.isSafeInteger(offset) || offset < 0) fail("Offset must be a nonnegative integer");
				const suites = [],
					runs = existsSync(join(p.base, "runs")) ? histories(p) : [];
				for (const ref of existsSync(join(p.base, "suites")) ? readdirSync(join(p.base, "suites")) : []) {
					if (!/^[a-f0-9]{64}$/.test(ref)) continue;
					try {
						const { metadata } = await load(p, ref);
						suites.push({
							assetRef: ref,
							createdAt: metadata.createdAt,
							status: state(p, ref).archived ? "archived" : "approved",
						});
					} catch {
						suites.push({ assetRef: ref, status: "invalid-or-incomplete" });
					}
				}
				const assets = suites.slice(offset, offset + 20),
					recentRuns = runs
						.slice()
						.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
						.slice(offset, offset + 20)
						.map((r) => ({ runId: r.runId, assetRef: r.assetRef, status: r.status }));
				return {
					assets,
					runs: recentRuns,
					offset,
					more: suites.length > offset + 20 || runs.length > offset + 20,
					markdown: [
						"# API test assets / 接口测试资产",
						"",
						suites.length
							? "| Version / 版本 | State / 状态 |"
							: "No suites yet. Prepare and review a suite first. / 暂无套件，请先生成并评审。",
						...(suites.length ? ["| --- | --- |", ...assets.map((a) => `| ${a.assetRef} | ${a.status} |`)] : []),
						"",
						"## Runs / 运行",
						"",
						...(!runs.length
							? ["No runs yet. / 暂无运行。"]
							: [
									"| Run / 运行 | State / 状态 |",
									"| --- | --- |",
									...recentRuns.map((r) => `| ${r.runId} | ${r.status} |`),
								]),
						"",
					].join("\n"),
				};
			}
			if (input.action === "asset_restore") {
				const source = inside(p.cwd, realpathSync(resolve(p.cwd, input.sourcePath))),
					backup = record(inside(source, realpathSync(join(source, "backup.json"))));
				const { signature, ...unsigned } = backup;
				if (
					unsigned.format !== "api-testing-backup-v1" ||
					unsigned.projectRoot !== p.cwd ||
					unsigned.policyHash !== policyHash ||
					!/^[a-f0-9]{64}$/.test(unsigned.assetRef ?? "") ||
					!/^[a-f0-9]{64}$/.test(signature ?? "")
				)
					fail("Backup owner, format or policy differs");
				const expected = Buffer.from(sign(unsigned), "hex"),
					supplied = Buffer.from(signature, "hex");
				if (!timingSafeEqual(expected, supplied))
					fail("Backup provenance signature is invalid; foreign packages need fresh review");
				const names = Object.keys(unsigned.files ?? {});
				if (!names.length || names.length > 600) fail("Backup file count is invalid");
				let total = 0;
				for (const name of names) {
					const bytes = read(file(source, name));
					total += bytes.length;
					if (total > 16 * 1024 * 1024 || hash(bytes) !== unsigned.files[name]) fail("Backup hash or size differs");
				}
				const groups = new Map();
				for (const name of names.filter((n) => n !== "suite-state.json")) {
					const parts = name.split("/"),
						group = parts[0] === "suite" ? "suite" : parts.slice(0, 2).join("/");
					if (!groups.has(group)) groups.set(group, []);
					groups.get(group).push(parts.at(-1));
				}
				if (!groups.get("suite")?.includes("asset.json") || !groups.get("suite")?.includes("manifest.json"))
					fail("Backup suite is incomplete");
				for (const [group, files] of groups) {
					const dest = group === "suite" ? join(p.base, "suites", unsigned.assetRef) : join(p.base, group);
					if (existsSync(dest))
						for (const name of files)
							if (!existsSync(join(dest, name)) || hash(read(join(dest, name))) !== unsigned.files[group + "/" + name])
								fail("Same ID has different contents; restore refused");
				}
				for (const [group, files] of groups) {
					const dest = group === "suite" ? join(p.base, "suites", unsigned.assetRef) : join(p.base, group);
					if (existsSync(dest)) continue;
					const staged = join(p.base, "staging", randomUUID());
					copyFiles(join(source, group), files, staged);
					renameSync(staged, dest);
				}
				await load(p, unsigned.assetRef);
				mkdirSync(join(p.base, "states"), { recursive: true, mode: 0o700 });
				if (names.includes("suite-state.json") && !existsSync(statePath(p, unsigned.assetRef)))
					atomic(statePath(p, unsigned.assetRef), record(file(source, "suite-state.json")));
				await rebuild(p);
				return { assetRef: unsigned.assetRef, restored: true, sourcePreserved: true };
			}
			const { bundle, metadata, inspected } = await load(p, input.assetRef);
			if (input.action === "asset_clone") {
				const cases =
					input.cases ??
					inspected.cases.map(({ basis, ...c }) => ({ ...c, checks: c.checks.map(({ basis, ...check }) => check) }));
				const compiled = compileSuite({
					imported: inspected.imported,
					cases,
					rules: inspected.rules,
					baseUrl: metadata.origin,
				});
				const draft = saveDraft(p.cwd, input.outputPath, compiled);
				return {
					phase: "draft",
					draftPath: draft.path,
					inheritedApproval: false,
					next: "Use prepare with the cloned source.json and selected cases, then independent review",
				};
			}
			if (input.action === "asset_archive") {
				if (typeof input.archived !== "boolean") fail("An explicit archived boolean is required");
				mkdirSync(join(p.base, "states"), { recursive: true, mode: 0o700 });
				atomic(statePath(p, input.assetRef), { assetRef: input.assetRef, archived: input.archived });
				return { assetRef: input.assetRef, archived: input.archived };
			}
			if (input.action === "asset_delete") {
				if (!state(p, input.assetRef).archived) fail("Archive before deletion");
				if (histories(p).some((r) => r.assetRef === input.assetRef))
					fail("Asset is referenced by retained runs; deletion refused");
				if (
					existsSync(join(p.base, "schedules")) &&
					readdirSync(join(p.base, "schedules")).some(
						(name) => record(join(p.base, "schedules", name)).assetRef === input.assetRef,
					)
				)
					fail("Asset is referenced by a schedule; deletion refused");
				rmSync(bundle, { recursive: true });
				await rebuild(p);
				return { assetRef: input.assetRef, deleted: true };
			}
			const destination = target(p.cwd, input.outputPath),
				staged = destination + ".tmp-" + randomUUID();
			mkdirSync(staged, { mode: 0o700 });
			const entries = {};
			let totalBytes = 0;
			const add = (name, bytes) => {
				if (Object.keys(entries).length >= 600) fail("Backup file count exceeds limit");
				totalBytes += bytes.length;
				if (totalBytes > 16 * 1024 * 1024) fail("Backup exceeds size limit; nothing published");
				mkdirSync(dirname(join(staged, name)), { recursive: true, mode: 0o700 });
				writeFileSync(join(staged, name), bytes, { flag: "wx", mode: 0o600 });
				entries[name] = hash(bytes);
			};
			for (const name of ["asset.json", ...Object.keys(metadata.files)]) add("suite/" + name, read(join(bundle, name)));
			for (const run of histories(p).filter((r) => r.assetRef === input.assetRef)) {
				const runRoot = join(p.base, "runs", run.runId);
				add(`runs/${run.runId}/run.json`, read(join(runRoot, "run.json")));
				for (const [name, digest] of Object.entries(run.fileHashes ?? {})) {
					if (!/^[a-zA-Z0-9.-]+$/.test(name) || name === "..") fail("Unsafe run evidence filename");
					const bytes = read(inside(runRoot, realpathSync(join(runRoot, name))));
					if (hash(bytes) !== digest) fail("Run evidence changed");
					add(`runs/${run.runId}/${name}`, bytes);
				}
			}
			add("suite-state.json", Buffer.from(json(state(p, input.assetRef))));
			const unsigned = {
				format: "api-testing-backup-v1",
				assetRef: input.assetRef,
				projectRoot: p.cwd,
				policyHash,
				files: entries,
			};
			writeFileSync(join(staged, "backup.json"), json({ ...unsigned, signature: sign(unsigned) }), {
				flag: "wx",
				mode: 0o600,
			});
			renameSync(staged, destination);
			return {
				assetRef: input.assetRef,
				backupPath: destination,
				files: Object.keys(entries).length,
				scope: "same host/project/policy; backup key is not exported",
			};
		},
	};
}
