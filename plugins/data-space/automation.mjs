/** Associations and deterministic native-result projection; original runners retain execution authority. */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { caseFingerprint } from "./model.mjs";
import { createTestChannel, environmentUrl as url } from "./test-channel.mjs";
import { normalizeVerdict } from "./runs.mjs";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function createAutomation({ host, store, runs, commitStore, commitRuns }) {
	const channel = createTestChannel({ host, store, commitStore });
	let syncError = "",
		queue = Promise.resolve(),
		serial = Promise.resolve(),
		disposed = false;
	const find = (id) => {
		const exact = store().cases.find((c) => c.id === id);
		if (exact) return exact;
		const matches = store().cases.filter((c) => c.code === id);
		if (matches.length > 1) throw new Error("用例编号不唯一，请使用用例 ID");
		return matches[0];
	};
	function environment(c, id) {
		const s = store(),
			feature = s.features.find((f) => f.id === c.featureId),
			mod = s.modules.find((m) => m.id === feature?.moduleId);
		const env = s.envs.find((e) => e.id === id && e.systemId === mod?.systemId);
		if (!env) throw new Error("请选择用例所属项目的明确环境");
		return env;
	}
	async function bind(cwd, input) {
		const c = find(input.caseId);
		if (!c) throw new Error("用例不存在");
		if ((c.type === "UI" ? "ui" : c.type === "接口" ? "api" : "") !== input.engine)
			throw new Error("自动化引擎与用例类型不一致");
		const env = environment(c, input.envId);
		const asset = await host.testing.inspect(input.engine, cwd, input.assetRef);
		if (!asset.cases.some((x) => x.id === input.nativeCaseId)) throw new Error("原生资产没有指定用例");
		if (url(env.baseUrl) !== url(asset.environment.baseUrl)) throw new Error("项目环境地址与原生资产目标不一致");
		// Recheck after IO: do not bind a changed case/version to a stale snapshot.
		if (disposed || !same(env, environment(c, input.envId)) || !same(c, find(c.id)))
			throw new Error("用例已更新，请重试关联");
		const binding = {
			engine: asset.engine,
			workspace: asset.workspace,
			assetRef: asset.assetRef,
			revision: asset.revision,
			nativeCaseId: input.nativeCaseId,
			envId: env.id,
			nativeEnvironmentId: asset.environment.id,
			caseVersion: caseFingerprint(c),
		};
		commitStore({
			...store(),
			revision: store().revision + 1,
			updatedAt: new Date().toISOString(),
			cases: store().cases.map((x) => (x.id === c.id ? { ...x, automation: binding } : x)),
		});
		return { ok: true, binding };
	}
	function sync(cwd, engine, reference) {
		const next = serial.then(() => syncNative(cwd, engine, reference));
		serial = next.catch(() => {});
		return next;
	}
	async function syncNative(cwd, engine, reference) {
		const workspace = realpathSync(cwd);
		let native;
		if (channel.list().some((c) => c.workspace === workspace && c.engine === engine)) {
			native = await host.testing.read(engine, workspace, reference);
			const asset = await host.testing.inspect(engine, workspace, native.assetRef);
			if (disposed) throw new Error("数据空间已停用");
			channel.intake(asset);
		}
		const candidates = store().cases.filter(
			(c) => c.automation?.engine === engine && c.automation.workspace === workspace,
		);
		if (!candidates.length) return { ok: true, imported: 0, duplicate: 0, unmatched: true };
		native ??= await host.testing.read(engine, workspace, reference);
		if (disposed) throw new Error("数据空间已停用");
		const pending = [],
			errors = [];
		let duplicate = 0;
		for (const c of candidates) {
			if (!same(c, find(c.id))) {
				errors.push(`${c.code || c.id}: 同步期间用例或关联已改变，请重试`);
				continue;
			}
			const b = c.automation;
			if (!same(b.assetRef, native.assetRef)) continue;
			if (b.caseVersion !== caseFingerprint(c)) {
				errors.push(`${c.code || c.id}: 用例已修改，须重新关联资产版本`);
				continue;
			}
			const env = environment(c, b.envId);
			if (url(env.baseUrl) !== url(native.environment.baseUrl) || b.nativeEnvironmentId !== native.environment.id)
				throw new Error("原生批次环境与关联环境不同");
			const rows = native.rows.filter((r) => r.caseId === b.nativeCaseId);
			if (!rows.length) continue; // A subset rerun must not manufacture outcomes for unselected cases.
			const key = JSON.stringify([engine, workspace, native.runId, c.id]);
			if (runs().runs.some((r) => r.automation?.key === key)) {
				duplicate++;
				continue;
			}
			const states = rows.map((r) => (r.status === "passed" && !r.evidenceComplete ? "unknown" : r.status));
			const status =
				["failed", "unknown", "cancelled", "not-run", "blocked", "skipped", "flaky", "passed"].find((s) =>
					states.includes(s),
				) ?? "unknown";
			pending.push({
				id: randomUUID(),
				caseId: c.id,
				code: c.code,
				verdict: normalizeVerdict(status),
				note: "原生执行证据同步；报告评审状态独立保留",
				at: native.at,
				source: "automation",
				caseUpdatedAt: c.updatedAt,
				taskId: native.runId,
				taskName: `${engine.toUpperCase()} · ${native.runId}`,
				env: env.name,
				envId: env.id,
				automation: {
					key,
					engine,
					workspace,
					runId: native.runId,
					parentRunId: native.parentRunId,
					assetRef: native.assetRef,
					revision: b.revision,
					nativeCaseId: b.nativeCaseId,
					caseVersion: b.caseVersion,
					environment: native.environment,
					instances: rows,
					evidence: native.evidence,
					complete: native.complete,
					review: native.review,
				},
			});
		}
		if (pending.length) commitRuns({ ...runs(), revision: runs().revision + 1, runs: [...runs().runs, ...pending] });
		syncError = errors.join("；");
		return { ok: !errors.length, imported: pending.length, duplicate, errors };
	}
	async function call(cwd, input) {
		if (disposed) throw new Error("数据空间已停用");
		if (input.action === "initialize") return channel.initialize(cwd, input);
		if (input.action === "disconnect") return channel.disconnect(cwd, input);
		if (input.action === "import") {
			const asset = await host.testing.inspect(input.engine, cwd, input.assetRef);
			if (disposed) throw new Error("数据空间已停用");
			return channel.intake(asset);
		}
		if (input.action === "bind") return bind(cwd, input);
		if (input.action === "sync") return sync(cwd, input.engine, input.runRef);
		if (input.action === "inspect") {
			const asset = await host.testing.inspect(input.engine, cwd, input.assetRef);
			// Keep the public picker payload compact; detailed cases are for host-side intake.
			return { ...asset, cases: asset.cases.map(({ id, title }) => ({ id, title })) };
		}
		const c = find(input.caseId),
			b = c?.automation;
		if (!b || b.workspace !== realpathSync(cwd)) throw new Error("当前工作区没有此用例的自动化关联");
		if (input.action === "unbind") {
			commitStore({
				...store(),
				revision: store().revision + 1,
				cases: store().cases.map((x) => (x.id === c.id ? { ...x, automation: null } : x)),
			});
			return { ok: true };
		}
		if (input.action !== "route" || caseFingerprint(c) !== b.caseVersion) throw new Error("关联已过期或操作无效");
		const env = environment(c, b.envId);
		const asset = await host.testing.inspect(b.engine, b.workspace, b.assetRef);
		if (
			disposed ||
			!same(c, find(c.id)) ||
			!same(env, environment(c, b.envId)) ||
			url(env.baseUrl) !== url(asset.environment.baseUrl) ||
			asset.environment.id !== b.nativeEnvironmentId
		)
			throw new Error("关联或环境已改变，请重新关联");
		return {
			ok: true,
			binding: b,
			scope: { nativeCaseIds: asset.cases.map((c) => c.id) },
			tool: b.engine === "api" ? "api_test_execute" : "ui_test_workflow",
			input:
				b.engine === "api"
					? { action: "asset_run", assetRef: b.assetRef }
					: {
							request: {
								operation: "start",
								input: { task_id: `ds-${randomUUID()}`, mode: "execute", asset_ref: b.assetRef },
							},
						},
			instruction:
				"执行范围为整个原生资产，包含全部原生用例；按用户授权范围核对后，继续原工作流的批准、诊断与预检；执行完成后宿主自动同步结果。同步失败时用 sync 按原批次重试，不重放执行。",
		};
	}
	const off = host.onToolEvent?.((ev) => {
		if (ev.phase !== "end" || ev.isError || !ev.cwd || (!ev.testRun && !ev.testAsset)) return;
		queue = queue
			.then(async () => {
				if (disposed) return;
				if (
					ev.testAsset &&
					channel.list().some((c) => c.workspace === realpathSync(ev.cwd) && c.engine === ev.testAsset.engine)
				)
					await call(ev.cwd, { action: "import", engine: ev.testAsset.engine, assetRef: ev.testAsset.reference });
				if (ev.testRun) await sync(ev.cwd, ev.testRun.engine, ev.testRun.reference);
			})
			.catch((error) => {
				syncError = String(error.message || error);
				host.log("error", "自动化结果同步失败", syncError);
				host.broadcast({ kind: "sync-error", error: syncError });
			});
	});
	// Recover missed completion notifications from native disk records after restart.
	queue = queue
		.then(async () => {
			if (!host.testing?.list) return;
			const groups = new Map(
				store()
					.cases.filter((c) => c.automation)
					.map((c) => [JSON.stringify([c.automation.engine, c.automation.workspace]), c.automation]),
			);
			for (const c of channel.list()) groups.set(JSON.stringify([c.engine, c.workspace]), c);
			const recoveryErrors = [];
			for (const b of groups.values()) {
				let references;
				try {
					references = await host.testing.list(b.engine, b.workspace);
				} catch (error) {
					syncError = String(error.message || error);
					recoveryErrors.push(syncError);
					host.log("error", "历史工作区扫描失败", syncError);
					continue;
				}
				for (const reference of references) {
					if (disposed) return;
					try {
						const receipt = await sync(b.workspace, b.engine, reference);
						recoveryErrors.push(...(receipt.errors ?? []));
					} catch (error) {
						syncError = String(error.message || error);
						recoveryErrors.push(syncError);
						host.log("error", "历史批次同步失败", syncError);
					}
				}
			}
			if (recoveryErrors.length) syncError = [...new Set(recoveryErrors)].join("；");
		})
		.catch((error) => {
			syncError = String(error.message || error);
		});
	return {
		call,
		sync,
		status: () => ({ error: syncError }),
		dispose() {
			disposed = true;
			off?.();
		},
		idle: async () => {
			await queue;
			await serial;
		},
	};
}
