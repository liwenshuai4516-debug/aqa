import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDesktopClientId } from "../../desktop/client-identity.js";

const dirs: string[] = [];
const temporary = () => {
	const dir = mkdtempSync(join(tmpdir(), "desktop-identity-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("native client identity", () => {
	it("persists a main-generated ID for one userData without sharing another profile or adopting UI IDs", () => {
		const dir = temporary();
		writeFileSync(join(dir, "ui-preferences.json"), JSON.stringify({ clientId: "renderer-chosen" }));
		const id = loadDesktopClientId(dir);
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(loadDesktopClientId(dir)).toBe(id);
		expect(loadDesktopClientId(temporary())).not.toBe(id);
		expect(readFileSync(join(dir, "client-identity"), "utf8")).toBe(`${id}\n`);
		if (process.platform !== "win32") expect(statSync(join(dir, "client-identity")).mode & 0o777).toBe(0o600);
	});
	it.each(["", "not-a-uuid", "x".repeat(129)])("rejects a damaged identity without rewriting it: %j", (value) => {
		const dir = temporary(),
			path = join(dir, "client-identity");
		writeFileSync(path, value);
		expect(() => loadDesktopClientId(dir)).toThrow(/Invalid desktop client identity/);
		expect(readFileSync(path, "utf8")).toBe(value);
	});
	it("rejects a symlink instead of borrowing another profile identity", () => {
		const first = temporary(),
			second = temporary();
		const id = loadDesktopClientId(first);
		symlinkSync(join(first, "client-identity"), join(second, "client-identity"));
		expect(() => loadDesktopClientId(second)).toThrow();
		expect(loadDesktopClientId(first)).toBe(id);
	});
	it("preload restores only a main-issued ID before the application and cannot persist a renderer replacement", () => {
		const preload = transformSync(readFileSync("desktop/preload.cts", "utf8"), { loader: "ts", format: "cjs" }).code;
		for (const issued of [null, loadDesktopClientId(temporary())]) {
			const storage = new Map([["pi-web-client-id", "renderer-replacement"]]);
			const sendSync = vi.fn((channel) => (channel === "pi-desktop:client-identity" ? issued : null));
			runInNewContext(preload, {
				module: { exports: {} },
				require: () => ({ contextBridge: { exposeInMainWorld: vi.fn() }, ipcRenderer: { sendSync } }),
				process: { platform: process.platform },
				location: { protocol: "http:" },
				sessionStorage: { setItem: (key: string, value: string) => storage.set(key, value) },
			});
			expect(storage.get("pi-web-client-id")).toBe(issued ?? "renderer-replacement");
			expect(sendSync.mock.calls[0]).toEqual(["pi-desktop:client-identity"]);
		}
	});
});
