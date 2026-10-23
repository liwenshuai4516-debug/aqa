/** Persistent environment selection and idempotent native case intake; no runner or credentials. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { atomicJson } from "./durable.mjs";
import { MAX, normalizeStore, str } from "./model.mjs";
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
/** 默认归档目录：模块「测试用例」，功能按引擎区分；目录 ID 持久化后跟随用户重命名。 */
const DEFAULT_MODULE = "测试用例";
const defaultFeature = (engine) => (engine === "ui" ? "UI用例" : "API用例");
export function createTestChannel({ host, store, commitStore }) {
	const file = host.dataDir ? join(host.dataDir, "data-space/channels.json") : null;
	let channels = [],
		destinations = [];
	if (file) {
		try {
			const saved = JSON.parse(readFileSync(file, "utf8"));
			// v1 只有通道；v2 追加按项目/引擎记住的用例目录，读取旧文件不改结构。
			if (![1, 2].includes(saved.version) || !Array.isArray(saved.channels))
				throw new Error("测试通道文件格式不受支持");
			channels = saved.channels;
			destinations = Array.isArray(saved.destinations) ? saved.destinations : [];
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	const save = (next, nextDestinations = destinations) => {
		if (file) atomicJson(file, { version: 2, channels: next, destinations: nextDestinations });
		channels = next;
		destinations = nextDestinations;
	};
	const remember = (systemId, engine, featureId, names) => {
		const kept = destinations.filter((d) => !(d.systemId === systemId && d.engine === engine));
		save(channels, [...kept, { systemId, engine, featureId, ...names }]);
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
	/**
	 * 解析入库目标：显式 envId 决定项目；没有 envId 时沿用同地址的已初始化通道。
	 * 环境被删除或地址不一致都直接阻塞，不静默改归属。
	 */
	function resolve(asset, input) {
		const s = store(),
			base = environmentUrl(asset.environment.baseUrl),
			envId = str(input.envId, 64);
		if (envId) {
			const env = s.envs.find((e) => e.id === envId);
			if (!env || !s.systems.some((p) => p.id === env.systemId)) throw new Error("所选环境不存在或已删除，未导入用例");
			if (environmentUrl(env.baseUrl) !== base) throw new Error("所选环境地址与原生用例目标不一致，未导入用例");
			const channel =
				channels.find((c) => c.workspace === asset.workspace && c.engine === asset.engine && c.envId === env.id) ??
				null;
			return { s, env, channel };
		}
		const channel = select(asset);
		return channel ? { s, env: s.envs.find((e) => e.id === channel.envId), channel } : null;
	}

	/** 目标功能：显式 ID > 记住的目录 ID > 通道目录 > 默认/自定义名称（不存在则建，存在则复用）。 */
	function destination(target, asset, input, timestamp, modules, features) {
		const systemId = target.env.systemId,
			belongs = (id) =>
				features.some((f) => f.id === id && modules.some((m) => m.id === f.moduleId && m.systemId === systemId)),
			name = (id) => {
				const feature = features.find((f) => f.id === id),
					module = modules.find((m) => m.id === feature.moduleId);
				return { moduleName: module.name, featureName: feature.name };
			};
		const wanted = str(input.featureId, 64);
		if (wanted) {
			if (!belongs(wanted)) throw new Error("目标功能不属于所选项目，未导入用例");
			remember(systemId, asset.engine, wanted, name(wanted));
			return wanted;
		}
		const remembered = destinations.find((d) => d.systemId === systemId && d.engine === asset.engine);
		if (remembered) {
			// 记住的是目录 ID：用户重命名后仍能用；被删除或改属时明确阻塞，不静默重建。
			if (!belongs(remembered.featureId))
				throw new Error("上次使用的用例目录已被删除或移动，请用 featureId 指定目标功能");
			return remembered.featureId;
		}
		if (target.channel?.featureId && belongs(target.channel.featureId)) {
			remember(systemId, asset.engine, target.channel.featureId, name(target.channel.featureId));
			return target.channel.featureId;
		}
		const moduleName = str(input.moduleName, 60) || DEFAULT_MODULE,
			featureName = str(input.featureName, 60) || defaultFeature(asset.engine);
		let module = modules.find((m) => m.systemId === systemId && m.name === moduleName);
		if (!module) {
			module = {
				id: `ds-${key([systemId, "module", moduleName]).slice(0, 24)}`,
				systemId,
				name: moduleName,
				note: "原生测试用例归档",
				createdAt: timestamp,
			};
			modules.push(module);
		}
		let feature = features.find((f) => f.moduleId === module.id && f.name === featureName);
		if (!feature) {
			feature = {
				id: `${module.id}-${key([module.id, featureName]).slice(0, 16)}`,
				moduleId: module.id,
				name: featureName,
				note: "按原生资产版本保留用例",
				createdAt: timestamp,
			};
			features.push(feature);
		}
		remember(systemId, asset.engine, feature.id, { moduleName: module.name, featureName: feature.name });
		return feature.id;
	}

	const nativeKey = (c) => key([c.moduleId ?? "", c.featureId ?? ""]);
	const sourceKey = (asset, env, c) => key([asset.workspace, asset.engine, asset.assetRef, env.id, c.id]);
	const belongs = (s, systemId, featureId) =>
		s.features.some((f) => f.id === featureId && s.modules.some((m) => m.id === f.moduleId && m.systemId === systemId));
	function mappings(asset, target, input) {
		if (
			input.featureMappings !== undefined &&
			(!Array.isArray(input.featureMappings) || input.featureMappings.length > 100)
		)
			throw new Error("featureMappings 须为至多 100 条明确映射");
		const out = new Map();
		if (input.featureId) {
			if (!belongs(target.s, target.env.systemId, input.featureId))
				throw new Error("目标功能不属于所选项目，未导入用例");
			out.set("*", input.featureId);
		}
		for (const item of input.featureMappings ?? []) {
			if (
				!item ||
				typeof item.nativeModuleId !== "string" ||
				!item.nativeModuleId ||
				typeof item.nativeFeatureId !== "string" ||
				!item.nativeFeatureId ||
				typeof item.featureId !== "string"
			)
				throw new Error("功能映射需要原生模块 ID、原生功能 ID 和目标功能 ID");
			const mappingKey = nativeKey({ moduleId: item.nativeModuleId, featureId: item.nativeFeatureId });
			if (out.has(mappingKey)) throw new Error("原生功能映射重复");
			if (!asset.cases.some((c) => nativeKey(c) === mappingKey)) throw new Error("映射引用了资产中不存在的原生功能");
			if (!belongs(target.s, target.env.systemId, item.featureId)) throw new Error("映射目标功能不属于所选项目");
			out.set(mappingKey, item.featureId);
		}
		return out;
	}
	function archived(asset, env, c, s) {
		return s.cases.find(
			(x) =>
				x.nativeSource?.key === sourceKey(asset, env, c) ||
				(x.automation?.workspace === asset.workspace &&
					x.automation.engine === asset.engine &&
					x.automation.envId === env.id &&
					x.automation.nativeCaseId === c.id &&
					same(x.automation.assetRef, asset.assetRef)),
		);
	}
	function receipt(asset, target, map, newIds = new Set()) {
		const { s, env } = target;
		const counts = { new: 0, existing: 0, pending: 0, stale: 0, unclassified: 0 };
		const items = asset.cases.map((c) => {
			const found = archived(asset, env, c, s);
			let status = !found ? "pending" : newIds.has(found.id) ? "new" : "existing",
				reason = null;
			if (
				found &&
				(!belongs(s, env.systemId, found.featureId) ||
					(found.nativeSource?.featureId && found.nativeSource.featureId !== found.featureId) ||
					((map.get(nativeKey(c)) ?? map.get("*")) && (map.get(nativeKey(c)) ?? map.get("*")) !== found.featureId))
			) {
				status = "stale";
				reason = "映射已改变，或原目录已删除/移动；未迁移历史用例";
			}
			counts[status]++;
			const mappingState = found?.nativeSource?.mappingState ?? "unclassified";
			if (found && mappingState === "unclassified") counts.unclassified++;
			return {
				nativeCaseId: c.id,
				nativeModuleId: c.moduleId ?? null,
				nativeFeatureId: c.featureId ?? null,
				caseId: found?.id ?? null,
				featureId: found?.featureId ?? null,
				status,
				mappingState,
				reason,
			};
		});
		const featureIds = [...new Set(items.filter((i) => i.caseId).map((i) => i.featureId))];
		return {
			ok: counts.stale === 0,
			status: counts.stale
				? "stale"
				: counts.pending
					? "pending"
					: counts.unclassified
						? "needs-classification"
						: "archived",
			project: { id: env.systemId, name: s.systems.find((p) => p.id === env.systemId)?.name },
			env: { id: env.id, name: env.name },
			workspace: asset.workspace,
			engine: asset.engine,
			assetRef: asset.assetRef,
			revision: asset.revision,
			executable: asset.executable !== false,
			featureId: featureIds.length === 1 ? featureIds[0] : null,
			featureName: featureIds.length === 1 ? (s.features.find((f) => f.id === featureIds[0])?.name ?? null) : null,
			imported: counts.new,
			duplicate: items.filter((i) => i.caseId && i.status !== "new").length,
			counts,
			total: items.length,
			classificationComplete: counts.unclassified === 0 && counts.pending === 0 && counts.stale === 0,
			items: items.slice(0, 100),
			itemsTruncated: items.length > 100,
		};
	}
	function intake(asset, input = {}) {
		const target = resolve(asset, input);
		if (!target) return { ok: false, imported: 0, unmatched: true };
		const map = mappings(asset, target, input);
		const previous = receipt(asset, target, map);
		if (previous.items.some((item) => item.caseId && !belongs(target.s, target.env.systemId, item.featureId)))
			throw new Error("上次使用的用例目录已被删除或移动，未导入用例");
		if (previous.counts.stale) return previous;
		const s = target.s,
			env = target.env,
			timestamp = new Date().toISOString(),
			pending = asset.cases.filter((c) => !archived(asset, env, c, s));
		let modules = [...s.modules],
			features = [...s.features];
		if (!pending.length) return previous;
		const featureId = pending.some((c) => !map.has(nativeKey(c)))
			? destination(target, asset, input, timestamp, modules, features)
			: null;
		if (s.cases.length + pending.length > MAX.cases) throw new Error("用例数量超过数据空间上限，未部分导入");
		if (modules.length > MAX.modules || features.length > MAX.features) throw new Error("归档目录超过数据空间上限");
		const drafts = pending.map((c) => ({
			id: randomUUID(),
			featureId: map.get(nativeKey(c)) ?? featureId,
			code: `DS-${key([asset.assetRef, env.id, c.id]).slice(0, 20)}`,
			title: c.title || c.id,
			priority: c.priority || "P2",
			type: asset.engine === "ui" ? "UI" : "接口",
			status: "草稿",
			tags: !map.has(nativeKey(c)) && !input.featureId ? ["待归类"] : [],
			preconditions: (c.preconditions ?? []).join("\n"),
			steps: c.steps ?? [],
			note: `原生 ${asset.engine} 用例 ${c.id}；修订 ${asset.revision}。完整断言与来源见原生资产。`,
			createdAt: timestamp,
			updatedAt: timestamp,
		}));
		const normalized = normalizeStore({ ...s, modules, features, cases: drafts }, null).cases;
		// 入库只保存草稿用例：不建立自动化关联、不执行、不生成结果（关联仍走独立 bind）。
		const imported = normalized.map((c, i) => ({
			...c,
			nativeSource: {
				key: sourceKey(asset, env, pending[i]),
				workspace: asset.workspace,
				engine: asset.engine,
				projectId: env.systemId,
				envId: env.id,
				lineageId: asset.lineageId ?? null,
				revision: asset.revision,
				intakeRevision: s.revision + 1,
				assetRef: asset.assetRef,
				nativeCaseId: pending[i].id,
				nativeModuleId: pending[i].moduleId ?? null,
				nativeFeatureId: pending[i].featureId ?? null,
				featureId: c.featureId,
				mappingState: map.has(nativeKey(pending[i])) || input.featureId ? "mapped" : "unclassified",
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
			...receipt(asset, { ...target, s: store() }, map, new Set(imported.map((c) => c.id))),
			caseIds: imported.slice(0, 100).map((c) => c.id),
			caseIdsTruncated: imported.length > 100,
		};
	}
	return {
		initialize,
		intake,
		receipt(asset, input = {}) {
			const target = resolve(asset, input);
			return target
				? receipt(asset, target, mappings(asset, target, input))
				: { ok: false, status: "missing-environment", unmatched: true, imported: 0, assetRef: asset.assetRef };
		},
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
