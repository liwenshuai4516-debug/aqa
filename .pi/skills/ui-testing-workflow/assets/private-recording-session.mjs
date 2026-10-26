// Internal host preparation. Native session facts are authoritative; no MCP or model tool is opened.
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { PrivateEvidence, RecordingService } from "pi-ui-testing";
import { preparePrivateRecordingWorkspace } from "./private-recording-workspace.mjs";

/** @param {{workspace: string, authority: string, sessionRef: import("pi-ui-testing").FileRef}} options */
export async function preparePrivateRecordingSession({ workspace, authority, sessionRef }) {
	const context = await new RecordingService(workspace).privateContext(sessionRef);
	if (!context) throw new Error("私密录制准备阻塞：原生会话未绑定私有环境与明确输入引用");
	const privacy = await PrivateEvidence.create(workspace, authority, context.environment, dirname(sessionRef.path));
	if (!privacy) throw new Error("私密录制准备阻塞：原生私密捕获未创建");
	// Playwright may otherwise create this directory with public permissions before the fixture runs.
	if (context.capture) await mkdir(join(privacy.directory, "output"), { mode: 0o700 });
	const snapshot = await preparePrivateRecordingWorkspace({
		workspace,
		authority: privacy.directory,
		environment: context.environment,
		inputRefs: [
			...new Map([...context.inputRefs, context.environmentRef, sessionRef].map((ref) => [ref.path, ref])).values(),
		],
	});
	if (context.capture) Object.assign(snapshot.childEnv, privacy.env);
	return {
		// Private handles stay inside the host; only receipt is suitable for ordinary output.
		privacy,
		snapshot,
		...(context.capture ? { capture: context.capture } : {}),
		receipt: {
			session_ref: sessionRef,
			...snapshot.receipt,
			...(context.capture
				? {
						capture: {
							protocol: context.capture.protocol,
							maxSteps: context.capture.maxSteps,
							maxToolCalls: context.capture.maxToolCalls,
							reservedToolCalls: context.capture.reservedToolCalls,
						},
					}
				: {}),
		},
	};
}
