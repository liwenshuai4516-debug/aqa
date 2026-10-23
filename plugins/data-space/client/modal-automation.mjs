import { BASE, S, esc, hooks, load, pathOfFeature, toast } from "./state.mjs";
import { versionText } from "./case-versions.mjs";
import { composeBrief } from "./brief.mjs";
export function openAutomation(id) {
	const c = S.cases.find((c) => c.id === id);
	if (!c) return;
	const b = c.automation;
	S.automationModal = {
		caseId: c.id,
		title: c.title,
		engine: c.type === "UI" ? "ui" : "api",
		assetText: b ? (typeof b.assetRef === "string" ? b.assetRef : JSON.stringify(b.assetRef)) : "",
		nativeCaseId: b?.nativeCaseId || "",
		envId: b?.envId || "",
		runText: "",
		message: "",
	};
	hooks.renderOverlay();
}
export function automationModalHtml() {
	const m = S.automationModal;
	if (!m) return "";
	const c = S.cases.find((c) => c.id === m.caseId),
		{ system } = pathOfFeature(c?.featureId);
	const envs = S.envs.filter((e) => e.systemId === system?.id);
	const records = S.runs.filter((r) => r.caseId === m.caseId && r.automation);
	return `<div class="dsp-overlay"><div class="dsp-modal"><div class="dsp-modal-head"><span>自动化关联 · ${esc(m.title)}</span><button class="dsp-btn" data-act="close-modal">关闭</button></div>
	<div class="dsp-modal-body">
	${c?.nativeSource ? `<details><summary>${esc(versionText("source"))}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(c.nativeSource, null, 2))}</pre></details>` : ""}
	<p>关联原生 ${m.engine.toUpperCase()} 资产，继续使用原工作流的批准、预检与执行。结果从原生证据同步。引入执行将运行整个原生资产中的用例，请在发送草稿前核对范围。</p>
	<label class="dsp-field"><span>资产引用（API 摘要 / UI 引用 JSON）</span><textarea data-f="assetText" rows="2">${esc(m.assetText)}</textarea></label>
	<label class="dsp-field"><span>原生用例 ID</span><input data-f="nativeCaseId" value="${esc(m.nativeCaseId)}" /></label>
	<label class="dsp-field"><span>项目环境</span><select data-f="envId"><option value="">请选择环境</option>${envs.map((e) => `<option value="${esc(e.id)}" ${e.id === m.envId ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label>
	<div class="dsp-chips"><button class="dsp-btn" data-act="automation-inspect">读取原生资产</button><button class="dsp-btn primary" data-act="automation-bind">保存关联</button><button class="dsp-btn" data-act="automation-route">引入执行对话</button><button class="dsp-btn" data-act="automation-unbind">解除关联</button></div>
	<label class="dsp-field"><span>已有批次引用（API runId / UI 引用 JSON）</span><textarea data-f="runText" rows="2">${esc(m.runText)}</textarea></label><button class="dsp-btn" data-act="automation-sync">同步已有批次（不重跑）</button>
	<p role="status">${esc(m.message)}</p>
	<details><summary>原生执行记录与证据 · ${records.length}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(
		JSON.stringify(
			records.map((r) => ({ verdict: r.verdict, at: r.at, ...r.automation })),
			null,
			2,
		),
	)}</pre></details>
	</div></div></div>`;
}
const ref = (text, engine) => (engine === "api" ? text.trim() : JSON.parse(text));
export async function automationAction(action) {
	const m = S.automationModal;
	if (!m) return;
	try {
		const input = { action, caseId: m.caseId, engine: m.engine, workspace: S.workspace };
		if (["inspect", "bind"].includes(action)) input.assetRef = ref(m.assetText, m.engine);
		if (action === "bind") Object.assign(input, { nativeCaseId: m.nativeCaseId, envId: m.envId });
		if (action === "sync") input.runRef = ref(m.runText, m.engine);
		const response = await fetch(`${BASE}/automation`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});
		const output = await response.json();
		if (!response.ok || output.ok === false)
			throw new Error(output.error || output.errors?.join("；") || "关联操作失败");
		if (action === "route") {
			const result = await composeBrief(
				`请调用 ${output.tool}，参数：\n${JSON.stringify(output.input)}\n${output.instruction}`,
			);
			if (!result.ok) throw new Error("无法放入对话，请检查宿主输入框");
			S.automationModal = null;
			hooks.render();
			return;
		}
		m.message =
			action === "inspect"
				? `原生用例：${output.cases.map((c) => c.id).join("、")}`
				: action === "sync"
					? `已同步 ${output.imported} 条，重复 ${output.duplicate} 条`
					: "已保存";
		await load();
		hooks.render();
	} catch (error) {
		m.message = String(error.message || error);
		toast(m.message);
		hooks.renderOverlay();
	}
}
