import { define, checks, text, finding, trustworthy, noChecks } from "./common.mjs";
export const F09 = define("F09", checks({ verifierId: text }), (_contract, view, config) => {
	const results = view.evidence.filter(
		(e) => e.data.kind === "verification-result" && e.data.producer === "vz-offline-store-1" && trustworthy(e, view),
	);
	const manifest = view.evidence.filter(
		(e) => e.data.kind === "artifact-manifest" && e.data.producer === "vz-offline-store-1" && trustworthy(e, view),
	);
	const selected = config.checks.length
		? config.checks
		: results.length
			? [{ conditionId: null, verifierId: "offline-json" }]
			: [];
	if (!selected.length) return noChecks("F09");
	return selected.map((c) => {
		const rows = results.filter((e) => e.value?.verifierId === c.verifierId),
			r = rows[0]?.value;
		const artifacts = manifest.filter((e) => e.value?.digest === r?.artifactSnapshotId && e.value?.complete);
		const items = [...rows, ...artifacts];
		if (
			rows.length !== 1 ||
			artifacts.length !== 1 ||
			r?.verifierVersion !== "1" ||
			r?.state !== "completed" ||
			!["pass", "fail"].includes(r?.verdict)
		)
			return finding(c.conditionId, "inconclusive", items, "Independent verification unavailable or verifier error", [
				r?.error ?? "unique-frozen-independent-verification",
			]);
		return finding(
			c.conditionId,
			r.verdict,
			items,
			"Registered trusted data verifier checked the frozen artifact snapshot",
			[],
			{
				verifierId: r.verifierId,
				verifierVersion: r.verifierVersion,
				fixtureDigest: r.fixtureDigest,
				artifactSnapshotId: r.artifactSnapshotId,
			},
		);
	});
});
