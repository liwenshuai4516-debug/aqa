/** Persistent environment selection and idempotent native case intake; no runner or credentials. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { atomicJson } from "./durable.mjs";
import { caseFingerprint, MAX, normalizeStore } from "./model.mjs";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function environmentUrl(value) {
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error("环境地址必须是明确的 HTTP(S) URL");
	}
	if (
		!["http:", "https:"].includes(parsed.protocol) ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	)
		throw new Error("环境地址必须是无凭据、查询参数和片段的 HTTP(S) URL");
	return parsed.href.replace(/\/+$/, "");
}
export function createTestChannel({ host, store, commitStore }) {
	const file = host.dataDir ? join(host.dataDir, "data-space/channels.json") : null;
	let channels = [];
	if (file) {
		try {
			const saved = JSON.parse(readFileSync(file, "utf8"));
			if (saved.version !== 1 || !Array.isArray(saved.channels)) throw new Error("测试通道文件格式不受支持");
			channels = saved.channels;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	const save = (next) => {
		if (file) atomicJson(file, { version: 1, channels: next });
		channels = next;
	};
	function initialize(cwd, input) {
		if (!["ui", "api"].includes(input.engine)) throw new Error("初始化需要 ui/api 引擎");
		const workspace = realpathSync(cwd),
			s = store();
		const target = input.targetUrl ? environmentUrl(input.targetUrl) : null;
		if (!target && !input.envId && !input.systemId) throw new Error("初始化需要目标 URL、项目 ID 或环境 ID");
		const candidates = s.envs.filter((env) => {
			if (input.systemId && env.systemId !== input.systemId) return false;
			if (input.envId && env.id !== input.envId) return false;
			if (!s.systems.some((p) => p.id === env.systemId)) return false;
			try {
				const base = environmentUrl(env.baseUrl);
				return !target || target === base || target.startsWith(base + "/");
			} catch {
				return false;
			}
		});
		if (candidates.length !== 1)
			return {
				ok: false,
				status: candidates.length ? "ambiguous" : "missing-environment",
				candidateCount: candidates.length,
				candidatesTruncated: candidates.length > 50,
				candidates: candidates
					.slice(0, 50)
					.map((e) => ({ systemId: e.systemId, envId: e.id, name: e.name, baseUrl: e.baseUrl })),
			};
		const env = candidates[0];
		if (
			input.featureId &&
			!s.features.some(
				(f) => f.id === input.featureId && s.modules.some((m) => m.id === f.moduleId && m.systemId === env.systemId),
			)
		)
			throw new Error("功能不属于所选项目");
		const channel = {
			workspace,
			engine: input.engine,
			systemId: env.systemId,
			envId: env.id,
			baseUrl: environmentUrl(env.baseUrl),
			featureId: input.featureId || "",
		};
		const existing = channels.find((c) => c.workspace === workspace && c.engine === input.engine && c.envId === env.id);
		// Retain explicit destination when a subsequent initialization only refreshes parameters.
		if (existing && !input.featureId) channel.featureId = existing.featureId;
		if (!same(existing, channel)) save([...channels.filter((c) => c !== existing), channel]);
		return {
			ok: true,
			status: "configured",
			channel,
			revision: s.revision,
			parameters: Object.fromEntries((env.params ?? []).filter((p) => !p.secret).map((p) => [p.key, p.value])),
			privateParameterKeys: (env.params ?? []).filter((p) => p.secret).map((p) => p.key),
			checks: { network: "not-checked", authentication: "not-checked" },
			features: s.features
				.filter((f) => s.modules.some((m) => m.id === f.moduleId && m.systemId === env.systemId))
				.slice(0, 100)
				.map((f) => ({ id: f.id, moduleId: f.moduleId, name: f.name })),
			featuresTruncated:
				s.features.filter((f) => s.modules.some((m) => m.id === f.moduleId && m.systemId === env.systemId)).length >
				100,
		};
	}
	function select(asset) {
		const matches = channels.filter(
			(c) =>
				c.workspace === asset.workspace &&
				c.engine === asset.engine &&
				c.baseUrl === environmentUrl(asset.environment.baseUrl),
		);
		if (!matches.length) return null;
		if (matches.length !== 1) throw new Error("同一地址存在多个测试通道，请断开非本次通道后重试");
		const channel = matches[0],
			s = store();
		const env = s.envs.find((e) => e.id === channel.envId && e.systemId === channel.systemId);
		if (!env || environmentUrl(env.baseUrl) !== channel.baseUrl || !s.systems.some((p) => p.id === channel.systemId))
			throw new Error("测试通道环境已变更，请重新初始化");
		return channel;
	}
	function intake(asset) {
		const channel = select(asset);
		if (!channel) return { ok: false, imported: 0, unmatched: true };
		const s = store(),
			timestamp = new Date().toISOString();
		const pending = asset.cases.filter(
			(c) =>
				!s.cases.some(
					(x) =>
						x.nativeSource?.key === key([asset.workspace, asset.engine, asset.assetRef, channel.envId, c.id]) ||
						(x.automation?.workspace === asset.workspace &&
							x.automation.engine === asset.engine &&
							x.automation.envId === channel.envId &&
							x.automation.nativeCaseId === c.id &&
							same(x.automation.assetRef, asset.assetRef)),
				),
		);
		if (!pending.length) return { ok: true, imported: 0, duplicate: asset.cases.length };
		if (s.cases.length + pending.length > MAX.cases) throw new Error("用例数量超过数据空间上限，未部分导入");
		let modules = [...s.modules],
			features = [...s.features],
			featureId = channel.featureId;
		if (
			featureId &&
			!features.some(
				(f) => f.id === featureId && modules.some((m) => m.id === f.moduleId && m.systemId === channel.systemId),
			)
		)
			throw new Error("通道目标功能已删除或移动，请重新初始化");
		if (!featureId) {
			const moduleId = `ds-${key([channel.systemId, "native-import"]).slice(0, 24)}`;
			featureId = `${moduleId}-${asset.engine}`;
			if (!modules.some((m) => m.id === moduleId))
				modules.push({
					id: moduleId,
					systemId: channel.systemId,
					name: "自动化测试",
					note: "原生测试资产归档",
					createdAt: timestamp,
				});
			if (!features.some((f) => f.id === featureId))
				features.push({
					id: featureId,
					moduleId,
					name: `${asset.engine.toUpperCase()} 自动化导入`,
					note: "按原生资产版本保留用例",
					createdAt: timestamp,
				});
		}
		if (
			!features.some(
				(f) => f.id === featureId && modules.some((m) => m.id === f.moduleId && m.systemId === channel.systemId),
			)
		)
			throw new Error("归档目录已移动到其他项目，请指定新的功能 ID");
		if (modules.length > MAX.modules || features.length > MAX.features) throw new Error("归档目录超过数据空间上限");
		const drafts = pending.map((c) => ({
			id: randomUUID(),
			featureId,
			code: `DS-${key([asset.assetRef, channel.envId, c.id]).slice(0, 20)}`,
			title: c.title || c.id,
			priority: c.priority || "P2",
			type: asset.engine === "ui" ? "UI" : "接口",
			status: "草稿",
			preconditions: (c.preconditions ?? []).join("\n"),
			steps: c.steps ?? [],
			note: `原生 ${asset.engine} 用例 ${c.id}；修订 ${asset.revision}。完整断言与来源见原生资产。`,
			createdAt: timestamp,
			updatedAt: timestamp,
		}));
		const normalized = normalizeStore({ ...s, modules, features, cases: drafts }, null).cases;
		const imported = normalized.map((c, i) => ({
			...c,
			nativeSource: {
				key: key([asset.workspace, asset.engine, asset.assetRef, channel.envId, pending[i].id]),
				assetRef: asset.assetRef,
				nativeCaseId: pending[i].id,
			},
			automation: {
				engine: asset.engine,
				workspace: asset.workspace,
				assetRef: asset.assetRef,
				revision: asset.revision,
				nativeCaseId: pending[i].id,
				envId: channel.envId,
				nativeEnvironmentId: asset.environment.id,
				caseVersion: caseFingerprint(c),
			},
		}));
		commitStore({
			...s,
			modules,
			features,
			cases: [...s.cases, ...imported],
			revision: s.revision + 1,
			updatedAt: timestamp,
		});
		return {
			ok: true,
			imported: imported.length,
			duplicate: asset.cases.length - imported.length,
			caseIds: imported.slice(0, 100).map((c) => c.id),
			caseIdsTruncated: imported.length > 100,
		};
	}
	return {
		initialize,
		intake,
		list: () => channels,
		disconnect(cwd, input) {
			if (!input.envId || !["ui", "api"].includes(input.engine)) throw new Error("断开需要 engine 和 envId");
			const workspace = realpathSync(cwd);
			save(
				channels.filter((c) => !(c.workspace === workspace && c.engine === input.engine && c.envId === input.envId)),
			);
			return { ok: true };
		},
	};
}
