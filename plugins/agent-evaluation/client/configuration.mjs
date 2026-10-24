/** Form presentation only. The service validates configs against the installed evaluator manifests. */
const fields = {
	F01: ["path", "format", "sha256", "jsonSchema"],
	F02: ["runId", "caseIds"],
	F04: ["prerequisiteToolCallId", "dependentToolCallId"],
	F05: ["claimEvidenceId", "claimPath", "basisEvidenceId", "basisPath", "expectedValue"],
	F08: ["maxAgentWallMs"],
	prices: [
		"provider",
		"model",
		"currency",
		"version",
		"inputPerMillion",
		"outputPerMillion",
		"cacheReadPerMillion",
		"cacheWritePerMillion",
	],
};
export const conditionRuleIds = Object.keys(fields).filter((id) => id !== "prices");
const optional = new Set(["format", "sha256", "jsonSchema", "caseIds"]);
const numeric = new Set([
	"maxAgentWallMs",
	"inputPerMillion",
	"outputPerMillion",
	"cacheReadPerMillion",
	"cacheWritePerMillion",
]);
const lists = ["pollingToolNames", "repairToolNames", "childWaitToolNames"];
const split = (value) => value.split(/\r?\n/).filter(Boolean);
export function configurationRow(rule, index, value, conditions, t, esc) {
	const field = (key) => {
		const name = `config-${rule}-${index}-${key}`,
			raw = value[key];
		let input;
		if (key === "conditionId")
			input = `<select name="${name}" data-field="${key}" required><option value="">${esc(t("chooseCondition"))}</option>${conditions
				.filter((c) => [rule, `${rule}@1`].includes(c.ruleRef))
				.map(
					(c) =>
						`<option value="${esc(c.id)}" ${raw === c.id ? "selected" : ""}>${esc(c.id)} · ${esc(c.statement)}</option>`,
				)
				.join("")}</select>`;
		else if (key === "format")
			input = `<select name="${name}" data-field="${key}">${["", "json", "text"].map((v) => `<option value="${v}" ${raw === v ? "selected" : ""}>${esc(t(`cfg-format-${v || "exists"}`))}</option>`).join("")}</select>`;
		else if (["jsonSchema", "expectedValue", "caseIds"].includes(key))
			input = `<textarea name="${name}" data-field="${key}" maxlength="65536" ${optional.has(key) ? "" : "required"}>${esc(key === "caseIds" ? (raw ?? []).join("\n") : raw === undefined ? "" : JSON.stringify(raw, null, 2))}</textarea>`;
		else
			input = `<input name="${name}" data-field="${key}" ${numeric.has(key) ? 'type="number" min="0" step="any"' : 'type="text" maxlength="1024"'} ${key === "sha256" ? 'pattern="[a-f0-9]{64}"' : ""} value="${esc(raw ?? "")}" ${optional.has(key) ? "" : "required"}>`;
		return `${key === "caseIds" ? `<label>${esc(t("cfg-caseScope"))}<select name="config-${rule}-${index}-caseScope" data-case-scope><option value="all" ${raw === undefined ? "selected" : ""}>${esc(t("allCases"))}</option><option value="selected" ${raw !== undefined ? "selected" : ""}>${esc(t("selectedCases"))}</option></select></label>` : ""}<label>${esc(t(`cfg-${key}`))}${input}</label>`;
	};
	return `<fieldset data-config-row="${rule}"><legend>${esc(t(rule === "prices" ? "priceRow" : "checkRow"))}</legend><div class="grid">${(rule === "prices" ? fields[rule] : ["conditionId", ...fields[rule]]).map(field).join("")}</div><button type="button" data-action="config-remove">${esc(t("removeCheck"))}</button></fieldset>`;
}
export function configurationHtml(configs, conditions, t, esc) {
	const rows = (rule, values) =>
		`<div data-config-rows="${rule}" data-next-index="${values.length}">${values.map((v, i) => configurationRow(rule, i, v, conditions, t, esc)).join("")}</div><button type="button" data-action="config-add" data-rule="${rule}" ${rule !== "prices" && !conditions.some((c) => [rule, `${rule}@1`].includes(c.ruleRef)) ? "disabled" : ""}>${esc(t(rule === "prices" ? "addPrice" : "addCheck"))}</button>`;
	const list = (rule, key) =>
		`<label>${esc(t(`cfg-${key}`))}<textarea name="config-${key}" data-config-list="${rule}" data-field="${key}" maxlength="24000">${esc((configs[rule]?.[key] ?? []).join("\n"))}</textarea></label>`;
	return `<section data-configuration><h2>${esc(t("editConfiguration"))}</h2><p>${esc(t("configurationHint"))}</p><details><summary>${esc(t("frozenConditions"))}</summary>${conditions.map((c) => `<p><b>${esc(c.id)}</b> · ${esc(c.statement)}</p>`).join("")}</details>${["F01", "F02", "F04", "F05", "F06", "F07", "F08"].map((rule) => `<details ${rule === "F01" ? "open" : ""}><summary>${rule} · ${esc(t(`cfg-${rule}`))}</summary><p>${esc(t(`cfg-${rule}-hint`))}</p>${fields[rule] ? rows(rule, configs[rule]?.checks ?? []) : ""}${rule === "F07" ? list(rule, "pollingToolNames") + list(rule, "repairToolNames") : ""}${rule === "F08" ? list(rule, "childWaitToolNames") + rows("prices", configs.F08?.prices ?? []) : ""}</details>`).join("")}</section>`;
}
/** @returns {Record<string, any>} */
export function readConfiguration(form, t) {
	const configs = {
		F01: { checks: [] },
		F02: { checks: [] },
		F04: { checks: [] },
		F05: { checks: [] },
		F06: {},
		F07: {},
		F08: { checks: [], prices: [] },
	};
	for (const row of form.querySelectorAll("[data-config-row]")) {
		const rule = row.dataset.configRow,
			item = {};
		for (const input of row.querySelectorAll("[data-field]")) {
			const key = input.dataset.field,
				value = input.value;
			if (key === "caseIds") {
				if (row.querySelector("[data-case-scope]").value === "selected") item[key] = split(value);
				continue;
			}
			if (!value && optional.has(key)) continue;
			if (!value) throw new Error(`${t(`cfg-${key}`)}: ${t("configurationRequired")}`);
			if (numeric.has(key)) {
				item[key] = Number(value);
				if (!Number.isFinite(item[key]) || item[key] < 0)
					throw new Error(`${t(`cfg-${key}`)}: ${t("configurationNumber")}`);
			} else if (["jsonSchema", "expectedValue"].includes(key)) {
				try {
					item[key] = JSON.parse(value);
				} catch {
					throw new Error(`${t(`cfg-${key}`)}: ${t("configurationJSON")}`);
				}
			} else item[key] = value;
		}
		if (rule === "prices") configs.F08.prices.push(item);
		else configs[rule].checks.push(item);
	}
	for (const input of form.querySelectorAll("[data-config-list]")) {
		if (lists.includes(input.dataset.field))
			configs[input.dataset.configList][input.dataset.field] = split(input.value);
	}
	return configs;
}
