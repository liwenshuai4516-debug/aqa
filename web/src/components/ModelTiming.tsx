import { useEffect, useState } from "react";
import { useT } from "../i18n";

/** SDK duration covers request + generation, not a provider's private reasoning clock. */
export function ModelTiming({
	durationMs,
	timestamp,
	streaming,
}: {
	durationMs?: number;
	timestamp?: number;
	streaming: boolean;
}) {
	const t = useT();
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!streaming || timestamp === undefined) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [streaming, timestamp]);
	const elapsed = streaming && timestamp !== undefined ? Math.max(0, now - timestamp) : durationMs;
	if (elapsed === undefined || !Number.isFinite(elapsed) || elapsed < 0) return null;
	return (
		<div className="model-timing" title={t("modelTimingHint")}>
			{t(streaming ? "modelTimingLive" : "modelTimingDone", { seconds: (elapsed / 1000).toFixed(1) })}
		</div>
	);
}
