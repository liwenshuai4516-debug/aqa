/** Frozen datasets and serial offline experiments; status refresh never starts work. */
const reference = ({ kind, id, revision }) => ({ kind, id, revision });
export function experimentsHtml(state, { t, esc, button }) {
	if (!state) return "";
	const form = state.form ?? {},
		current = state.current;
	const input = (name, key, value, min, max) =>
		`<label>${esc(t(key))}<input name="${name}" type="number" min="${min}" max="${max}" value="${esc(form[name] ?? value)}" required></label>`;
	return `<section data-experiments><h2>${esc(t("experiments"))}</h2><p>${esc(t("experimentsHint"))}</p>${state.anchor ? `<form data-form="dataset"><h3>${esc(t("freezeDataset"))}</h3><label>${esc(t("datasetName"))}<input name="name" value="${esc(form.name ?? "")}" maxlength="120" required></label><label>${esc(t("diagnosticMode"))}<select name="mode">${state.runtime.modes.map((m) => `<option value="${esc(m)}" ${form.mode === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label><label>${esc(t("diagnosticInput"))}<textarea name="stdin" maxlength="65536">${esc(form.stdin ?? "")}</textarea></label><label>${esc(t("previousDataset"))}<select name="previousDataset"><option value="">${esc(t("newDataset"))}</option>${state.datasets.map((d) => `<option value="${esc(d.id)}" ${form.previousDataset === d.id ? "selected" : ""}>${esc(d.data.name)} · ${esc(d.id)}</option>`).join("")}</select></label><p>${esc(t("fixedExpectation"))}</p><label class="check-label"><input type="checkbox" name="confirmed" required><span>${esc(t("confirmDataset"))}</span></label><button type="submit">${esc(t("freezeDataset"))}</button></form>` : ""}${state.datasetCursor ? button("dataset-more", "moreDatasets") : ""}<form data-form="experiment"><label>${esc(t("frozenDataset"))}<select name="datasetId" required>${state.datasets.map((d) => `<option value="${esc(d.id)}" ${form.datasetId === d.id ? "selected" : ""}>${esc(d.data.name)} · ${esc(d.id)}</option>`).join("")}</select></label><div class="grid">${input("repetitions", "repeatCount", 2, 1, 5)}${input("retries", "retryCount", 0, 0, 2)}${input("maxAttempts", "maxAttempts", 10, 1, 40)}${input("timeout", "attemptSeconds", 20, 1, 30)}${input("total", "totalSeconds", 120, 1, 600)}<label>${esc(t("failurePolicy"))}<select name="failurePolicy"><option value="stop" ${form.failurePolicy !== "continue" ? "selected" : ""}>${esc(t("stopAfterFailure"))}</option><option value="continue" ${form.failurePolicy === "continue" ? "selected" : ""}>${esc(t("continueAfterFailure"))}</option></select></label></div><label>${esc(t("hardCost"))}<input name="hardCostLimitUsd" type="number" min="0" step="0.01" value="${esc(form.hardCostLimitUsd ?? "")}"></label><p>${esc(t("hardCostUnsupported"))}</p><button type="submit" ${!state.datasets.length ? "disabled" : ""}>${esc(t("createExperiment"))}</button></form><div class="actions">${button("experiment-list", "refreshExperiments")}${button("experiment-dismiss", "dismissObservation")}</div>${state.itemCursor ? button("experiment-more", "moreExperiments") : ""}${state.items.map((e, i) => `<article><p>${esc(e.id)} · ${esc(e.createdAt)}</p>${button("experiment-select", "open", `data-index="${i}"`)}</article>`).join("")}${current ? `<article data-experiment-status role="status"><h3>${esc(t("experimentState"))}: ${esc(t("experiment-" + current.data.state))}</h3><p>${esc(current.data.reason ?? "")}</p><p>${esc(t("experimentCounts"))}: ${current.statistics.completed}/${current.statistics.planned} · ${esc(t("executedAttempts"))}: ${current.statistics.executedAttempts}</p><p>${esc(t("offlineCosts"))}</p><div class="actions">${button("experiment-status", "checkDiagnostic")}${!["completed", "stopped"].includes(current.data.state) ? button("experiment-run", "runExperiment") + button("experiment-cancel", "stopExperiment") : ""}</div>${current.data.entries.map((e) => `<p>${esc(e.caseId)} · ${esc(e.phase)} · ${esc(e.outcome ?? "")} · ${esc(e.attemptRef?.id ?? "")}${e.evaluationRef ? ` ${button("experiment-report", "openExperimentReport", `data-report="${esc(e.evaluationRef.id)}"`)}` : ""}</p>`).join("")}</article>` : ""}</section>`;
}
export async function experimentAction(action, state, rpc, extra = {}) {
	if (action === "experiment-status" || action === "experiment-select")
		state.current = await rpc.request("experimentStatus", {
			ref: reference(extra.ref ?? state.current),
		});
	if (action === "experiment-run" || action === "experiment-cancel")
		state.current = await rpc.request(action === "experiment-run" ? "runExperiment" : "cancelExperiment", {
			ref: { kind: "experiments", id: state.current.id, revision: state.current.revision },
		});
	if (["experiment-list", "experiment-more"].includes(action)) {
		const result = await rpc.request("list", {
			kind: "experiments",
			limit: 20,
			...(action === "experiment-more" ? { cursor: state.itemCursor } : {}),
		});
		state.items = action === "experiment-more" ? [...state.items, ...result.items] : result.items;
		state.itemCursor = result.nextCursor;
	}
	if (["experiment-list", "dataset-more"].includes(action)) {
		const result = await rpc.request("list", {
			kind: "datasets",
			limit: 20,
			...(action === "dataset-more" ? { cursor: state.datasetCursor } : {}),
		});
		const rows = await Promise.all(result.items.map((row) => rpc.request("get", { ref: reference(row) })));
		state.datasets = action === "dataset-more" ? [...state.datasets, ...rows] : rows;
		state.datasetCursor = result.nextCursor;
	}
	return state;
}
