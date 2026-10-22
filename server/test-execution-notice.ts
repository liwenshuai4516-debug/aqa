/** Only real execution operations may request result synchronization. */
import type { TestEngine } from "./test-asset-reader.js";
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
