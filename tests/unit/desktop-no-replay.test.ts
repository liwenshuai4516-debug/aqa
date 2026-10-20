import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "../../server/agent-service-daemon.js";
import { ClientSession } from "../../server/agent-service.js";
import { ClientStateStore } from "../../server/client-state.js";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
describe("D02 desktop interrupted runs", () => {
	for (const disabled of [true, false]) {
		it(
			disabled
				? "retains interruption notices without automatic model continuation"
				: "preserves ordinary Web/CLI automatic continuation records",
			async () => {
				const root = mkdtempSync(join(tmpdir(), "desktop-no-replay-"));
				mkdirSync(join(root, "agent"));
				vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
				vi.stubEnv("PI_WEB_RESUME_INTERRUPTED", disabled ? "0" : undefined);
				const store = new ClientStateStore(join(root, "client-state.json"));
				const entry = {
					title: "interrupted job",
					cwd: root,
					at: Date.now(),
					sessionFile: join(root, "saved-session.jsonl"),
				};
				store.saveInterrupted("desktop-test", [entry]);
				const resume = vi.spyOn(ClientSession.prototype, "resumeInterrupted").mockResolvedValue();
				const service = new AgentService(root, store);
				try {
					await service.attach("desktop-test", () => {});
					expect(resume).toHaveBeenCalledOnce();
					expect(resume).toHaveBeenCalledWith(
						disabled ? [{ title: entry.title, cwd: entry.cwd, at: entry.at }] : [entry],
					);
					expect(store.takeInterrupted("desktop-test")).toBeUndefined();
				} finally {
					await service.disposeAll();
					rmSync(root, { recursive: true, force: true });
				}
			},
			15000,
		);
	}
});
