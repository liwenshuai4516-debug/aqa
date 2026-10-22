/**
 * 项目 / 模块 / 功能三级选择器（用例弹窗与数据集弹窗共用）。
 * 联动时只重建 options，不重渲染整块弹窗，避免输入焦点丢失。
 */
import { S, esc, featuresOf, modulesOf } from "./state.mjs";

function selOptions(list, value) {
	return list.map(([v, l]) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(l)}</option>`).join("");
}

export const sysOptions = (value) => selOptions([["", "请选择项目"], ...S.systems.map((s) => [s.id, s.name])], value);

export const modOptions = (systemId, value) =>
	selOptions(
		[["", systemId ? "请选择模块" : "先选项目"], ...(systemId ? modulesOf(systemId).map((m) => [m.id, m.name]) : [])],
		value,
	);

export const featOptions = (moduleId, value) =>
	selOptions(
		[["", moduleId ? "请选择功能" : "先选模块"], ...(moduleId ? featuresOf(moduleId).map((f) => [f.id, f.name]) : [])],
		value,
	);

export function pathSelects(prefix, val) {
	return `<div class="dsp-path-selects">
		<select data-el="${prefix}-system" title="项目">${sysOptions(val.systemId)}</select>
		<select data-el="${prefix}-module" title="模块">${modOptions(val.systemId, val.moduleId)}</select>
		<select data-el="${prefix}-feature" title="功能">${featOptions(val.moduleId, val.featureId)}</select>
	</div>`;
}

export function refreshPathSelects(prefix) {
	const val = prefix === "case" ? S.caseModal : S.datasetModal;
	if (!val || !S.nodes) return;
	const sys = S.nodes.overlay.querySelector(`[data-el="${prefix}-system"]`);
	const mod = S.nodes.overlay.querySelector(`[data-el="${prefix}-module"]`);
	const feat = S.nodes.overlay.querySelector(`[data-el="${prefix}-feature"]`);
	if (!sys || !mod || !feat) return;
	sys.innerHTML = sysOptions(val.systemId);
	mod.innerHTML = modOptions(val.systemId, val.moduleId);
	feat.innerHTML = featOptions(val.moduleId, val.featureId);
	sys.value = val.systemId;
	mod.value = val.moduleId;
	feat.value = val.featureId;
}
