/**
 * 「登记执行结果」小弹窗：用例 → 通过 / 失败 / 阻塞 + 一句话备注。
 *
 * 与 AI 回写（data_space_record_result）写的是同一条记录链，区别只是 source。
 * 结果只追加不改历史：再登记一次就是最新结论，旧记录仍留在 runs.json 里可追溯。
 */
import { S, esc, fmtTime, hooks, resultOf, saveResult, toast } from "./state.mjs";
import { invalidateMentionCache } from "./mention.mjs";

export function openResultModal(caseId) {
	const c = S.cases.find((x) => x.id === caseId);
	if (!c) return;
	const last = resultOf(c);
	S.resultModal = {
		caseId,
		verdict: last?.run.verdict || S.verdicts[0] || "通过",
		note: "",
	};
	hooks.renderOverlay();
}

export function resultModalHtml() {
	const m = S.resultModal;
	if (!m) return "";
	const c = S.cases.find((x) => x.id === m.caseId);
	if (!c) return "";
	const last = resultOf(c);
	const verdicts = (S.verdicts.length ? S.verdicts : ["通过", "失败", "阻塞"])
		.map(
			(v) =>
				`<button class="dsp-chip ${m.verdict === v ? "on" : ""}" data-act="result-verdict" data-id="${esc(v)}">${esc(v)}</button>`,
		)
		.join("");
	const lastLine = last
		? `上次：<b class="${last.run.verdict === "失败" ? "dsp-bad" : ""}">${esc(last.run.verdict)}</b> · ${esc(fmtTime(last.run.at))} · ${
				last.run.source === "ai" ? "AI 回写" : "手工登记"
			}${last.stale ? ` · <span class="dsp-warn">用例已更新，旧结果仅作参考</span>` : ""}${
				last.run.note ? `<br/><span class="dsp-muted">备注：${esc(last.run.note)}</span>` : ""
			}`
		: "还没有执行记录。";

	return `<div class="dsp-overlay" data-act="overlay">
		<div class="dsp-modal narrow" data-stop="1">
			<div class="dsp-modal-head">
				<span>登记执行结果</span>
				<button class="dsp-btn icon" data-act="close-modal" title="关闭">✕</button>
			</div>
			<div class="dsp-modal-body">
				<div class="dsp-brief-scope">
					<b>${esc(c.code || "未编号")} · ${esc(c.title)}</b>
					<span class="dsp-muted">${esc(c.type || "未分类")} · ${esc(c.priority)} · 数据 revision ${S.revision}</span>
				</div>
				<div class="dsp-field"><span>本次结论</span><div class="dsp-chips" style="margin:0">${verdicts}</div></div>
				<div class="dsp-field">
					<span>备注（失败时写现象与初步判断，选填）</span>
					<input class="dsp-input" data-f="note" value="${esc(m.note)}" maxlength="300" placeholder="例如：返回 500 而非 409，疑似唯一索引缺失" />
				</div>
				<div class="dsp-tip">${lastLine}</div>
			</div>
			<div class="dsp-modal-foot">
				<span class="dsp-muted">结果 revision ${S.runsRevision} · 概览里的通过率随之更新</span>
				<button class="dsp-btn" data-act="close-modal">取消</button>
				<button class="dsp-btn primary" data-act="save-result">保存结果</button>
			</div>
		</div>
	</div>`;
}

export async function saveResultNow() {
	const m = S.resultModal;
	if (!m) return;
	const res = await saveResult(m.caseId, m.verdict, m.note);
	if (!res.ok) {
		toast(res.error || "登记失败");
		return;
	}
	S.resultModal = null;
	invalidateMentionCache();
	hooks.renderOverlay();
	hooks.render();
	toast(`已记录 ${m.verdict} · 结果 revision ${res.runsRevision}`);
}
