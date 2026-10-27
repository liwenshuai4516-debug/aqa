#!/usr/bin/env node
/** Project-local generated cache cleanup. Preview by default; no service or user-data access. */
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, realpathSync, rmSync, existsSync } from "node:fs";
import { resolve, join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const cachePaths = ["node_modules/.vite", "node_modules/.vite-temp", "node_modules/.cache"];
const portable = (path) => path.split(sep).join("/");
const inside = (parent, path) => path === parent || path.startsWith(parent + sep);
const mib = (bytes) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

/** Execution residue: produced by tests and aborted tool writes, rebuildable, so no retention window. */
const residueDirs = [".workbuddy/tmp", ".tmp-test-data"];
const residueKinds = new Set(["run-residue", "stray-file", "stale-lock"]);
const strayNames = new Set([".DS_Store", "Thumbs.db"]);
const straySuffixes = [".orig", ".rej", ".tmp", "~"];
const straySkipDirs = new Set(["node_modules", ".git", "dist", "release", ".watermate", "tests"]);
const strayMaxDepth = 4;
const strayRootMaxBytes = 64;
const lockNames = ["index.lock", "HEAD.lock", "config.lock", "packed-refs.lock"];
const lockGraceMs = 10 * 60 * 1000;

function trackedPaths(root) {
	return execFileSync("git", ["ls-files", "--cached", "-z"], {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 32 * 1024 ** 2,
	})
		.split("\0")
		.filter(Boolean);
}

/** Reject symlink ancestors, including links pointing back inside the repository. */
function safeDirectory(root, path) {
	if (!inside(root, path) || path === root) return false;
	let current = root;
	for (const part of relative(root, path).split(sep)) {
		current = join(current, part);
		try {
			const stat = lstatSync(current);
			if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
		} catch (error) {
			if (error.code === "ENOENT") return false;
			throw error;
		}
	}
	return realpathSync(path) === path;
}

function treeInfo(path) {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) return { bytes: 0, newest: 0, pinned: false };
	const result = { bytes: stat.isFile() ? stat.size : 0, newest: stat.mtimeMs, pinned: false };
	if (stat.isDirectory()) {
		for (const name of readdirSync(path)) {
			if (name === ".cleanup-keep") result.pinned = true;
			const child = treeInfo(join(path, name));
			result.bytes += child.bytes;
			result.newest = Math.max(result.newest, child.newest);
			result.pinned ||= child.pinned;
		}
	}
	return result;
}

function pinnedAncestor(root, path) {
	for (let current = path; inside(root, current); current = dirname(current)) {
		if (existsSync(join(current, ".cleanup-keep"))) return true;
		if (current === root) break;
	}
	return false;
}

/** Any entry, file or directory, whose ancestors are real directories inside the repository. */
function safeEntry(root, path) {
	if (!inside(root, path) || path === root) return false;
	try {
		if (lstatSync(path).isSymbolicLink()) return false;
	} catch {
		return false;
	}
	const parent = dirname(path);
	return parent === root || safeDirectory(root, parent);
}

/** Root-level extension-less micro files are left behind by aborted tool writes. */
function rootStrayName(name) {
	return name.length <= 16 && !name.includes(".") && /^[A-Za-z0-9_-]+$/.test(name);
}

function findStrayFiles(root) {
	const found = [];
	const walk = (dir, depth) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) continue;
			const child = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (depth < strayMaxDepth && !straySkipDirs.has(entry.name)) walk(child, depth + 1);
				continue;
			}
			if (!entry.isFile()) continue;
			const byName = strayNames.has(entry.name) || straySuffixes.some((suffix) => entry.name.endsWith(suffix));
			const rootLeak = depth === 0 && rootStrayName(entry.name) && lstatSync(child).size <= strayRootMaxBytes;
			if (byName || rootLeak) found.push(relative(root, child));
		}
	};
	walk(root, 0);
	return found;
}

/** A lock left by a killed process blocks Git until removed; only stale ones qualify. */
function findStaleLocks(root, nowMs) {
	return lockNames
		.map((name) => join(root, ".git", name))
		.filter((path) => {
			try {
				const stat = lstatSync(path);
				return stat.isFile() && nowMs - stat.mtimeMs > lockGraceMs;
			} catch {
				return false;
			}
		})
		.map((path) => relative(root, path));
}

/** Only dependency trees in scratch with both install manifests, and explicit tool caches. */
export function planCleanup(root, { days = 7, now = Date.now() } = {}) {
	if (!Number.isFinite(days) || days < 0) throw new Error("days must be a non-negative number");
	root = realpathSync(root);
	const tracked = trackedPaths(root);
	const candidates = [];
	const add = (path, kind) => {
		if (!safeDirectory(root, path)) return;
		const name = portable(relative(root, path));
		const info = treeInfo(path);
		let reason;
		if (tracked.some((file) => file === name || file.startsWith(name + "/"))) reason = "Git 跟踪文件";
		else if (info.pinned || pinnedAncestor(root, path)) reason = ".cleanup-keep 保留标记";
		else if (days > 0 && info.newest > now - days * 86400000) reason = `未满 ${days} 天或近期有写入`;
		candidates.push({ path: name, kind, bytes: info.bytes, eligible: !reason, reason });
	};
	const scan = (path) => {
		if (!safeDirectory(root, path)) return;
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === ".git") continue;
			const child = join(path, entry.name);
			if (entry.name === "node_modules") {
				if (["package.json", "package-lock.json"].every((file) => existsSync(join(path, file)))) {
					add(child, "scratch-dependencies");
				}
			} else scan(child);
		}
	};
	scan(join(root, "tests/scratch"));
	for (const path of cachePaths) add(join(root, path), "tool-cache");
	/** Execution residue is rebuildable by the next run, so the retention window does not apply. */
	const addResidue = (path, kind) => {
		if (!safeEntry(root, path)) return;
		const name = portable(relative(root, path));
		const info = treeInfo(path);
		let reason;
		if (tracked.some((file) => file === name || file.startsWith(name + "/"))) reason = "Git 跟踪文件";
		else if (info.pinned || pinnedAncestor(root, path)) reason = ".cleanup-keep 保留标记";
		candidates.push({ path: name, kind, bytes: info.bytes, eligible: !reason, reason });
	};
	for (const path of residueDirs) addResidue(join(root, path), "run-residue");
	for (const path of findStrayFiles(root)) addResidue(join(root, path), "stray-file");
	for (const path of findStaleLocks(root, now)) addResidue(join(root, path), "stale-lock");
	return candidates.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
}

/**
 * Re-plan immediately before each deletion; never trust an earlier preview.
 * @param {string} root
 * @param {{days?: number, only?: string[]}} [options]
 */
export function applyCleanup(root, { days = 7, only = [] } = {}) {
	const initial = planCleanup(root, { days });
	for (const path of only) {
		if (!initial.some((entry) => entry.path === path)) throw new Error(`不在清理白名单中: ${path}`);
	}
	const removed = [];
	for (const entry of initial.filter((entry) => entry.eligible && (!only.length || only.includes(entry.path)))) {
		const current = planCleanup(root, { days }).find((item) => item.path === entry.path);
		if (!current?.eligible) continue;
		rmSync(join(realpathSync(root), current.path), { recursive: true });
		removed.push(current);
	}
	return removed;
}

function main(args) {
	let apply = false;
	let residue = false;
	let quiet = false;
	let days = 7;
	const only = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--apply") apply = true;
		else if (args[i] === "--residue") residue = true;
		else if (args[i] === "--quiet") quiet = true;
		else if (args[i] === "--days" && args[i + 1] !== undefined && args[i + 1].trim() !== "") {
			days = Number(args[++i]);
		} else if (args[i] === "--only" && args[i + 1]) only.push(args[++i]);
		else
			throw new Error("用法: npm run clean -- [--apply] [--residue] [--quiet] [--days 7] [--only 白名单中的相对路径]");
	}
	if (apply && days === 0 && !only.length && !residue) throw new Error("--days 0 执行时必须用 --only 指定精确候选");
	const entries = planCleanup(projectRoot, { days });
	for (const path of only) {
		if (!entries.some((entry) => entry.path === path)) throw new Error(`不在清理白名单中: ${path}`);
	}
	const scoped = residue ? entries.filter((entry) => residueKinds.has(entry.kind)) : entries;
	const selected = scoped.filter((entry) => !only.length || only.includes(entry.path));
	if (!quiet)
		console.log(
			apply ? "执行清理（请先结束使用这些目录的测试/构建进程）" : "仅预览；未删除文件。执行前先结束相关测试/构建进程。",
		);
	if (!quiet)
		for (const entry of selected) {
			console.log(
				`${entry.eligible ? "可清理" : "保留"}\t${mib(entry.bytes)}\t${entry.path}${entry.reason ? ` · ${entry.reason}` : ""}`,
			);
		}
	const eligible = selected.filter((entry) => entry.eligible);
	console.log(`可清理 ${eligible.length} 项，共 ${mib(eligible.reduce((sum, entry) => sum + entry.bytes, 0))}。`);
	if (apply) {
		const selection = residue ? eligible.map((entry) => entry.path) : only;
		const removed = residue && !selection.length ? [] : applyCleanup(projectRoot, { days, only: selection });
		console.log(
			`实际删除 ${removed.length} 项，逻辑大小 ${mib(removed.reduce((sum, entry) => sum + entry.bytes, 0))}。`,
		);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
