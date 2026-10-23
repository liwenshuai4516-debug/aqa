/** Only real execution operations may request result synchronization. */
import type { TestEngine } from "./test-asset-reader.js";
import type { PlanState, PlanStep } from "./protocol.js";

/** Display projection only: native checkpoints remain the execution/approval authority. */
export function nativeUiWorkflowPlan(
	args: any,
	result: any,
	current: PlanState | null,
): { steps: PlanStep[]; activeStepId: string | null } | undefined {
	const operation = args?.request?.operation;
	if (!["start", "status", "checkpoint", "block", "resume-task"].includes(operation)) return;
	try {
		const text = result?.content?.find((part: any) => part.type === "text")?.text;
		if (typeof text !== "string" || Buffer.byteLength(text) > 64000) return;
		const output = JSON.parse(text).output;
		const task = output?.task;
		const data = task?.data;
		if (task?.kind !== "task" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(task.id ?? "")) return;
		if (!["new", "record", "execute", "analyze", "resume", "rerun-failed", "rerun-all"].includes(data?.workflow?.mode))
			return;
		if (!["running", "pending", "blocked", "cancelled", "completed"].includes(data?.state)) return;
		if (output.task_ref?.path !== `qa/ui/tasks/${task.id}/manifest.json`) return;
		if (!/^[a-f0-9]{64}$/.test(output.task_ref.sha256 ?? "")) return;
		const titles: Record<string, string> = {
			"discover-record": "发现与录制 / Discover & record",
			"case-design": "用例设计 / Case design",
			"design-review": "设计评估 / Design review",
			execute: "正式执行 / Execute",
			analyze: "结果分析 / Analyze",
			"result-review": "结果评估与报告交付 / Review & deliver",
		};
		const sequence: unknown = output.sequence;
		if (
			!Array.isArray(sequence) ||
			!sequence.length ||
			sequence.length > 6 ||
			sequence.some((stage) => typeof stage !== "string" || !titles[stage]) ||
			new Set(sequence).size !== sequence.length ||
			!sequence.includes(data.stage) ||
			!Array.isArray(data.completed_stages)
		)
			return;
		const prefix = `ui:${task.id}:`;
		const existing = current?.steps ?? [];
		// Read-only status must not attach an unrelated task to this conversation.
		if (!["start", "resume-task"].includes(operation) && !existing.some((step) => step.id.startsWith(prefix))) return;
		const reasons = [
			...(Array.isArray(data.blockers) ? data.blockers : []),
			...(Array.isArray(output.blockers) ? output.blockers.map((b: any) => b.message) : []),
		].filter((reason): reason is string => typeof reason === "string");
		const stopped = data.state === "blocked" || data.state === "cancelled" || reasons.length > 0;
		const stages: PlanStep[] = sequence.map((stage) => ({
			id: prefix + stage,
			title: `${task.id} · ${titles[stage]}`,
			status: data.completed_stages.includes(stage)
				? "done"
				: !stopped && data.state === "running" && stage === data.stage
					? "in_progress"
					: "pending",
			description:
				`${output.task_ref.path}\n` +
				(stopped && !data.completed_stages.includes(stage)
					? `${data.state === "cancelled" ? "已取消 / Cancelled" : "阻塞 / Blocked"}: ${[...new Set(reasons)].join("; ")}\n`
					: "") +
				"工作流进度不代表用例全部通过 / Workflow progress does not mean all tests passed.",
		}));
		// Preserve custom/other task steps, including their ordering.
		const remaining = [...stages];
		const steps = existing.flatMap((step) =>
			step.id.startsWith(prefix) ? (remaining.length ? [remaining.shift()!] : []) : [step],
		);
		steps.push(...remaining);
		return { steps, activeStepId: stopped || data.state !== "running" ? null : prefix + data.stage };
	} catch {
		// Missing/truncated output must never infer completion.
		return;
	}
}
export function nativeTestCompletion(
	name: string,
	args: unknown,
	result: unknown,
	isError: boolean,
): { engine: TestEngine; reference: unknown } | undefined {
	if (isError) return;
	const input = args as Record<string, any> | undefined;
	const output = result as { details?: any; content?: Array<{ type: string; text?: string }> } | undefined;
	if (name === "ui_test_run" && input?.request?.operation === "start") {
		const ref = output?.details?.artifact_refs?.find(
			(r: any) => typeof r.path === "string" && /^qa\/ui\/runs\/[^/]+\/manifest\.json$/.test(r.path),
		);
		if (ref) return { engine: "ui", reference: { path: ref.path, sha256: ref.sha256 } };
	}
	if (name === "api_test_execute" && ["run", "retest", "asset_run", undefined].includes(input?.action)) {
		try {
			const text = output?.content?.find((c) => c.type === "text")?.text;
			const value = output?.details?.runId
				? output.details
				: text && text.length <= 64000
					? JSON.parse(text)
					: undefined;
			if (typeof value?.runId === "string" && /^[a-f0-9-]{36}$/.test(value.runId))
				return { engine: "api", reference: value.runId };
		} catch {
			/* Incomplete tool output is not execution proof. */
		}
	}
}

/** Creation notices contain references only; the reader validates persisted native assets. */
export function nativeTestAssetCreated(
	name: string,
	args: any,
	result: any,
	isError: boolean,
): { engine: TestEngine; reference: unknown } | undefined {
	if (isError) return;
	if (
		name === "ui_case_design" &&
		args?.request?.operation === "candidate" &&
		result?.details?.status === "completed"
	) {
		const ref = result.details.artifact_refs?.find(
			(r: any) => typeof r.path === "string" && /^qa\/ui\/assets\/.+\/manifest\.json$/.test(r.path),
		);
		if (ref) return { engine: "ui", reference: { path: ref.path, sha256: ref.sha256 } };
	}
	if (name === "api_test_execute" && ["review", "asset_import", "asset_restore"].includes(args?.action)) {
		try {
			const text = result?.content?.find((c: any) => c.type === "text")?.text;
			const value = result?.details?.assetRef ? result.details : text && text.length <= 64000 ? JSON.parse(text) : null;
			if (/^[a-f0-9]{64}$/.test(value?.assetRef ?? "")) return { engine: "api", reference: value.assetRef };
		} catch {
			/* No usable asset reference. */
		}
	}
}
