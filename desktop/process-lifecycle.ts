import { spawn, type ChildProcess } from "node:child_process";

/** Only accepts a ChildProcess owned by this app. The sidecar calls the original SIGTERM handler on IPC. */
export async function stopOwnedSidecar(child: ChildProcess, timeoutMs = 7_000): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	await new Promise<void>((resolve) => {
		let forceTimer: ReturnType<typeof setTimeout>;
		let finalTimer: ReturnType<typeof setTimeout>;
		const done = () => {
			clearTimeout(forceTimer);
			clearTimeout(finalTimer);
			child.removeListener("exit", done);
			resolve();
		};
		child.once("exit", done);
		try {
			if (child.connected) child.send({ type: "pi-desktop:shutdown" }, () => {});
			else child.kill("SIGTERM");
		} catch {
			/* Already exiting. */
		}
		forceTimer = setTimeout(() => {
			if (child.exitCode !== null || child.signalCode !== null) return done();
			console.warn("[desktop] 服务退出超时，仅强制清理本应用子进程。");
			if (process.platform === "win32" && child.pid) {
				const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
					windowsHide: true,
					stdio: "ignore",
				});
				killer.on("error", () => child.kill("SIGKILL"));
			} else {
				try {
					if (child.pid) process.kill(-child.pid, "SIGKILL");
				} catch {
					child.kill("SIGKILL");
				}
			}
		}, timeoutMs);
		finalTimer = setTimeout(() => {
			child.kill("SIGKILL");
			done();
		}, timeoutMs + 2_000);
	});
}
