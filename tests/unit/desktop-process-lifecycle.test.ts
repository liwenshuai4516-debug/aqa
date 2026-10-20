import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { stopOwnedSidecar } from "../../desktop/process-lifecycle.js";
describe("owned sidecar shutdown", () => {
	it("requests graceful IPC shutdown and waits for the real child to exit", async () => {
		const child = spawn(
			process.execPath,
			[
				"-e",
				'process.on("message",m=>{if(m.type==="pi-desktop:shutdown")setTimeout(()=>process.exit(0),20)});process.send("ready");',
			],
			{ stdio: ["ignore", "ignore", "ignore", "ipc"], detached: process.platform !== "win32" },
		);
		await once(child, "message");
		await stopOwnedSidecar(child, 1000);
		expect(child.exitCode).toBe(0);
	});
	it("bounds an unresponsive owned child without terminating an unrelated process", async () => {
		const args = ["-e", 'process.on("message",()=>{});setInterval(()=>{},1000);process.send("ready");'];
		const options = {
			stdio: ["ignore", "ignore", "ignore", "ipc"] as ["ignore", "ignore", "ignore", "ipc"],
			detached: process.platform !== "win32",
		};
		const child = spawn(process.execPath, args, options);
		const unrelated = spawn(process.execPath, args, options);
		await Promise.all([once(child, "message"), once(unrelated, "message")]);
		try {
			await stopOwnedSidecar(child, 30);
			expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
			expect(unrelated.exitCode).toBeNull();
			expect(unrelated.signalCode).toBeNull();
		} finally {
			unrelated.kill("SIGKILL");
		}
	});
});
