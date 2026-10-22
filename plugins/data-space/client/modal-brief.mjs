/**
 * 「引入到 AI 对话」弹窗：范围摘要 + 档位 / 指令选择 + 脱敏与去重开关 + 文本预览。
 *
 * 交互刻意停在草稿：点「放入输入框」只把内容塞进对话框（并把视图切到对话），
 * 不自动发送 —— 用户通常要补一句自己的要求，或者先看一眼有没有不该带出去的字段。
 */
import { S, esc, hooks, toast } from "./state.mjs";
import {
	BRIEF_DEFAULTS,
	FORMAT_CHOICES,
	INTENT_CHOICES,
	buildBrief,
	composeBrief,
	fmtChars,
	hostSupportsCompose,
	introducedCount,
	isIntroduced,
	markIntroduced,
} from "./brief.mjs";

/** 打开弹窗。cases 是「当前可见范围」的用例（跟随搜索与筛选）。 */
export function openBrief({ label, cases, filtered = false, skip = true }) {
	const list = (cases ?? []).filter(Boolean);
	S.brief = {
		label: String(label ?? "").trim() || "用例",
		cases: list,
		filtered: Boolean(filtered),
		format: BRIEF_DEFAULTS.format,
		intent: BRIEF_DEFAULTS.intent,
		redact: BRIEF_DEFAULTS.redact,
		// 单条引入时不做「跳过已引入」——用户点它就是要再引一次。
		skip: list.length > 1 ? Boolean(skip) : false,
	};
	hooks.renderOverlay();
}

/** 实际要带进对话的用例（应用「跳过已引入」）。 */
function selectedCases() {
	const m = S.brief;
	if (!m) return [];
	return m.skip ? m.cases.filter((c) => !isIntroduced(c)) : m.cases;
}

function chips(choices, current, act) {
	return choices
		.map(
			(c) =>
				`<button class="dsp-chip ${current === c.id ? "on" : ""}" data-act="${act}" data-id="${esc(c.id)}" title="${esc(c.hint || c.label)}">${esc(c.label)}</button>`,
		)
		.join("");
}

/** 弹窗里的实时预览（选项一改就重算）。 */
export function briefPreview() {
	const m = S.brief;
	if (!m) return null;
	return buildBrief({
		cases: selectedCases(),
		label: m.label,
		filtered: m.filtered,
		format: m.format,
		intent: m.intent,
		redact: m.redact,
	});
}

export function briefModalHtml() {
	const m = S.brief;
	if (!m) return "";
	const sel = selectedCases();
	const preview = briefPreview();
	const already = m.cases.length > 1 ? introducedCount(m.cases) : 0;
	const api = sel.filter((c) => String(c.type ?? "").trim() === "接口").length;
	const ui = sel.filter((c) => String(c.type ?? "").trim() === "UI").length;
	const rest = sel.length - api - ui;
	const scope = [`${sel.length} 条`, `接口 ${api} / UI ${ui}${rest > 0 ? ` / 其他 ${rest}` : ""}`]
		.concat(m.filtered ? ["已按当前筛选"] : [])
		.join(" · ");

	return `<div class="dsp-overlay" data-act="overlay">
		<div class="dsp-modal narrow brief-modal" data-stop="1">
			<div class="dsp-modal-head">
				<span>引入到 AI 对话${sel.length ? ` · ${sel.length} 条` : ""}</span>
				<button class="dsp-btn icon" data-act="close-modal" title="关闭">✕</button>
			</div>
			<div class="dsp-modal-body">
				<div class="dsp-brief-scope">
					<b>${esc(m.label)}</b>
					<span class="dsp-muted">${esc(scope)}</span>
				</div>
				<div class="dsp-field"><span>内容档位</span><div class="dsp-chips" style="margin:0">${chips(FORMAT_CHOICES, m.format, "brief-format")}</div></div>
				<div class="dsp-field"><span>末尾指令</span><div class="dsp-chips" style="margin:0">${chips(INTENT_CHOICES, m.intent, "brief-intent")}</div></div>
				<div class="dsp-brief-note">
					<label class="dsp-check"><input type="checkbox" data-el="brief-redact" ${m.redact ? "checked" : ""} />脱敏：口令 / 令牌打成 ***，数据集只带名称</label>
					${
						already
							? `<label class="dsp-check"><input type="checkbox" data-el="brief-skip" ${m.skip ? "checked" : ""} />跳过本轮已引入的 ${already} 条</label>`
							: ""
					}
				</div>
				<div class="dsp-field">
					<span>预览 · 约 ${fmtChars(preview.chars)} 字${preview.cut > 0 ? ` · 超出上限，只带前 ${preview.count} 条` : ""}</span>
					<textarea class="dsp-brief-preview" readonly rows="12" spellcheck="false">${esc(preview.text || "（没有可引入的用例）")}</textarea>
				</div>
				<div class="dsp-tip">${
					sel.length
						? "放入后不会自动发送：可以在输入框里补充自己的要求再发。执行接口类用例前请确认目标环境。"
						: "当前没有可引入的用例：取消「跳过已引入」或换一个范围。"
				}</div>
			</div>
			<div class="dsp-modal-foot">
				<span class="dsp-muted dsp-brief-count">${
					sel.length
						? `${sel.length} 条 · ${preview.format === "card" ? "卡片档" : "清单档"} · 约 ${fmtChars(preview.chars)} 字`
						: "0 条"
				}${hostSupportsCompose() ? "" : " · 当前宿主不支持自动放入，将复制到剪贴板"}</span>
				<button class="dsp-btn" data-act="close-modal">取消</button>
				<button class="dsp-btn primary" data-act="compose-brief"${sel.length ? "" : " disabled"}>放入输入框</button>
			</div>
		</div>
	</div>`;
}

/** 点「放入输入框」：生成文本 → 交给宿主 → 记下已引入。 */
export async function composeBriefNow() {
	const m = S.brief;
	if (!m) return;
	const sel = selectedCases();
	if (!sel.length) {
		toast("没有可引入的用例：先取消「跳过已引入」");
		return;
	}
	const built = briefPreview();
	if (!built?.text) {
		toast("没有可引入的内容");
		return;
	}
	const res = await composeBrief(built.text);
	if (!res.ok) {
		toast("放入失败：宿主没有可用的输入框，也没有剪贴板权限");
		return;
	}
	markIntroduced(sel, S.revision);
	S.brief = null;
	hooks.renderOverlay();
	hooks.render();
	const brief = `${built.count} 条 · ${built.format === "card" ? "卡片档" : "清单档"} · 约 ${fmtChars(built.chars)} 字`;
	toast(res.via === "composer" ? `已放入对话框 · ${brief}` : `已复制到剪贴板 · ${brief}`);
}
