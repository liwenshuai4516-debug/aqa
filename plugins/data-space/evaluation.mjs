/** Read-only relationships and an idempotent report index. Never imports cases, refreshes auth or runs tests. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, openSync, fsyncSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicJson } from "./durable.mjs";
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const check = (ok, code, message) => {
	if (!ok) throw Object.assign(new Error(message), { code });
};
const text = (v) => typeof v === "string" && v.length > 0 && v.length <= 256;
export function createEvaluationInterface({ host, store, automation }) {
	const directory = join(host.dataDir, "data-space"),
		file = join(directory, "evaluation-index.json");
	const save = (value) => {
		atomicJson(file, value);
		const fd = openSync(directory, "r");
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	};

	if (!existsSync(file)) save({ version: 1, spaceId: randomUUID(), reports: [] });
	const load = () => {
		check(statSync(file).size <= 8 * 1024 * 1024, "LIMIT_EXCEEDED", "Report index exceeds 8 MiB");
		const ledger = JSON.parse(readFileSync(file, "utf8"));
		check(
			ledger.version === 1 && text(ledger.spaceId) && Array.isArray(ledger.reports),
			"STORE_CORRUPT",
			"Invalid Data Space report index; preserve original",
		);
		check(
			ledger.reports.every(
				(r) =>
					/^[a-f0-9]{64}$/.test(r.key ?? "") &&
					text(r.evaluationId) &&
					/^[a-f0-9]{64}$/.test(r.reportDigest ?? "") &&
					r.projectRef?.spaceId === ledger.spaceId &&
					text(r.projectRef?.projectId) &&
					Number.isFinite(Date.parse(r.syncedAt)),
			) && new Set(ledger.reports.map((r) => r.key)).size === ledger.reports.length,
			"STORE_CORRUPT",
			"Invalid report index entries; preserve original",
		);
		check(ledger.reports.length <= 10000, "LIMIT_EXCEEDED", "Data Space report index is full");
		return ledger;
	};
	return async (q, binding, verify) => {
		verify();
		check(
			q && ["describe", "observe", "indexStatus", "syncIndex"].includes(q.action),
			"INVALID_INPUT",
			"Invalid Data Space evaluation action",
		);
		check(
			Object.keys(q).every((k) =>
				[
					"action",
					"projectRef",
					"environmentRef",
					"engine",
					"assetRef",
					"runRef",
					"evaluationId",
					"reportDigest",
				].includes(k),
			),
			"INVALID_INPUT",
			"Unexpected Data Space field",
		);
		const ledger = load(),
			s = store();
		const environments = s.envs.filter((e) =>
			automation.channels().some((c) => c.workspace === binding.workspace && c.envId === e.id),
		);
		const envRef = (e) => ({ environmentId: e.id, revision: hash([e.id, e.systemId, e.name, e.baseUrl, e.updatedAt]) });
		const projects = s.systems
			.filter((p) => environments.some((e) => e.systemId === p.id))
			.map((p) => ({
				projectRef: { spaceId: ledger.spaceId, projectId: p.id },
				name: p.name,
				environments: environments.filter((e) => e.systemId === p.id).map((e) => ({ ...envRef(e), name: e.name })),
			}));
		if (q.action === "describe") {
			const assets = [
				...new Map(
					s.cases
						.filter((c) => c.nativeSource?.workspace === binding.workspace)
						.map((c) => [
							hash([c.nativeSource.engine, c.nativeSource.assetRef]),
							{ engine: c.nativeSource.engine, assetRef: c.nativeSource.assetRef, title: c.title.slice(0, 200) },
						]),
				).values(),
			].slice(0, 100);
			return { projects, assets, observedAt: new Date().toISOString() };
		}
		check(
			q.projectRef &&
				Object.keys(q.projectRef).sort().join(",") === "projectId,spaceId" &&
				q.projectRef?.spaceId === ledger.spaceId &&
				projects.some((p) => p.projectRef.projectId === q.projectRef?.projectId),
			"PERMISSION_DENIED",
			"Project is unavailable in the authorized workspace",
		);
		if (["indexStatus", "syncIndex"].includes(q.action)) {
			check(
				text(q.evaluationId) && /^[a-f0-9]{64}$/.test(q.reportDigest ?? ""),
				"INVALID_INPUT",
				"A frozen report identity is required",
			);
			const key = hash([binding.principalId, binding.workspaceId, q.projectRef, q.evaluationId]);
			const prior = ledger.reports.find((r) => r.key === key);
			if (prior) {
				check(prior.reportDigest === q.reportDigest, "VERSION_CONFLICT", "Report index identity conflicts");
				return { status: "synced", receipt: prior };
			}
			if (q.action === "indexStatus") return { status: "missing" };
			check(ledger.reports.length < 10000, "LIMIT_EXCEEDED", "Data Space report index is full");
			verify();
			const receipt = {
				key,
				evaluationId: q.evaluationId,
				projectRef: q.projectRef,
				reportDigest: q.reportDigest,
				syncedAt: new Date().toISOString(),
			};
			save({ ...ledger, reports: [...ledger.reports, receipt] });
			return { status: "synced", receipt };
		}
		check(
			["api", "ui"].includes(q.engine) &&
				q.assetRef &&
				q.environmentRef &&
				Object.keys(q.environmentRef).sort().join(",") === "environmentId,revision" &&
				text(q.environmentRef.environmentId) &&
				text(q.environmentRef.revision),
			"INVALID_INPUT",
			"Explicit native asset and environment references required",
		);
		const env = environments.find(
			(e) => e.id === q.environmentRef.environmentId && e.systemId === q.projectRef.projectId,
		);
		check(
			env && envRef(env).revision === q.environmentRef.revision,
			"VERSION_CONFLICT",
			"Environment ownership or revision changed",
		);
		const asset = await host.testing.inspect(q.engine, binding.workspace, q.assetRef);
		verify();
		check(asset.cases.length <= 100, "LIMIT_EXCEEDED", "Select an asset with at most 100 native cases");
		const receipt = await automation.call(binding.workspace, {
			action: "archive-status",
			engine: q.engine,
			assetRef: q.assetRef,
			envId: env.id,
		});
		verify();
		check(
			receipt.project?.id === q.projectRef.projectId &&
				receipt.env?.id === env.id &&
				receipt.workspace === binding.workspace &&
				receipt.revision === asset.revision &&
				hash(receipt.assetRef) === hash(asset.assetRef) &&
				receipt.total === asset.cases.length &&
				receipt.items?.length === asset.cases.length &&
				!receipt.itemsTruncated,
			"EVIDENCE_GAP",
			"Complete matching intake receipt and readback required",
		);
		const run = q.runRef
			? await automation.call(binding.workspace, { action: "sync-status", engine: q.engine, runRef: q.runRef })
			: undefined;
		verify();
		if (run)
			check(hash(run.assetRef) === hash(asset.assetRef), "VERSION_CONFLICT", "Run belongs to another native batch");
		const current = store();
		check(
			current.envs.some(
				(e) =>
					e.id === env.id && envRef(e).revision === q.environmentRef.revision && e.systemId === q.projectRef.projectId,
			),
			"VERSION_CONFLICT",
			"Environment changed during observation",
		);
		const projectOf = (c) =>
			current.modules.find((m) => m.id === current.features.find((f) => f.id === c.featureId)?.moduleId)?.systemId;
		const items = asset.cases.map((native) => {
			const matches = current.cases.filter(
				(c) =>
					c.nativeSource?.workspace === binding.workspace &&
					c.nativeSource.engine === q.engine &&
					c.nativeSource.envId === env.id &&
					hash(c.nativeSource.assetRef) === hash(asset.assetRef) &&
					c.nativeSource.nativeCaseId === native.id,
			);
			const receiptRows = receipt.items.filter((r) => r.nativeCaseId === native.id);
			check(
				receiptRows.length === 1 && receiptRows[0].caseId === (matches[0]?.id ?? null),
				"EVIDENCE_GAP",
				"Intake receipt differs from current readback",
			);
			const c = matches[0],
				p = c && projectOf(c);
			return {
				nativeCaseId: native.id,
				caseId: c?.id ?? null,
				projectId: p ?? null,
				intakeRevision: c?.nativeSource.intakeRevision ?? null,
				createdAt: c?.createdAt ?? null,
				status: !c
					? "missing"
					: matches.length !== 1
						? "duplicate"
						: p !== q.projectRef.projectId
							? "wrong-project"
							: c.nativeSource.revision !== asset.revision || receiptRows[0].status === "stale"
								? "stale"
								: "present",
			};
		});
		return {
			schemaVersion: 1,
			projectRef: q.projectRef,
			environmentRef: envRef(env),
			batchRef: {
				engine: q.engine,
				assetRef: asset.assetRef,
				revision: asset.revision,
				identity: hash([q.engine, asset.assetRef]),
			},
			storeRevision: current.revision,
			observedAt: new Date().toISOString(),
			receipt: { status: receipt.status, total: receipt.total, counts: receipt.counts, revision: receipt.revision },
			complete: true,
			items,
			...(run
				? {
						run: {
							runId: run.runId,
							runRef: run.runRef,
							complete: run.complete,
							status: run.status,
							items: run.items.map((r) => ({
								caseId: r.caseId,
								projectId: r.projectId,
								envId: r.envId,
								status: r.status,
							})),
						},
					}
				: {}),
		};
	};
}
