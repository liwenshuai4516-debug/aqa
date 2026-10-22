#!/usr/bin/env node
/** Install optional locked tools; preserve existing non-profile dependency directories. */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const profiles = {
	desktop: { directory: "desktop", links: ["electron", "electron-builder"] },
	vendor: { directory: "tools/vendor", links: [] },
	e2e: { directory: "tools/e2e", links: ["@playwright/test", "playwright", "playwright-core", "pi-ui-testing"] },
};
export function linkProfile(root, name) {
	const profile = profiles[name];
	if (!profile) throw new Error(`Unknown profile: ${name}`);
	const links = profile.links.map((pkg) => ({
		source: join(root, profile.directory, "node_modules", pkg),
		target: join(root, "node_modules", pkg),
	}));
	// Validate every link before making changes. Never replace an installed package.
	for (const { source, target } of links) {
		if (!existsSync(join(source, "package.json"))) throw new Error(`Missing profile package: ${source}`);
		let stat;
		try {
			stat = lstatSync(target);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		if (stat && (!stat.isSymbolicLink() || resolve(dirname(target), readlinkSync(target)) !== resolve(source)))
			throw new Error(`Existing dependency is not owned by this profile: ${target}. Use a clean npm ci first.`);
	}
	for (const { source, target } of links) {
		if (existsSync(target)) continue;
		try {
			if (lstatSync(target).isSymbolicLink()) unlinkSync(target);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		mkdirSync(dirname(target), { recursive: true });
		symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
	}
}
function main() {
	const name = process.argv[2];
	const profile = profiles[name];
	if (!profile) throw new Error("Usage: node scripts/install-profile.mjs desktop|vendor|e2e [--link-only]");
	const root = fileURLToPath(new URL("../", import.meta.url));
	if (!process.argv.includes("--link-only")) {
		// npm_execpath avoids shell quoting and Windows .cmd execution differences.
		const npm = process.env.npm_execpath;
		if (!npm) throw new Error("Run through npm run install:<profile>");
		const run = spawnSync(
			process.execPath,
			[
				npm,
				"ci",
				"--prefix",
				join(root, profile.directory),
				"--no-audit",
				"--no-fund",
				...(name === "e2e" ? ["--omit=peer"] : []),
			],
			{ stdio: "inherit" },
		);
		if (run.status !== 0) throw new Error(`Profile install failed: ${run.error?.message ?? run.status}`);
	}
	linkProfile(root, name);
	console.log(`Installed ${name} profile (${profile.directory})`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
