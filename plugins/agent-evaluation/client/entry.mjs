import { offlineHtml as executionHtml, offlineAttemptsHtml } from "./offline.mjs";
import { transport } from "./transport.mjs";
import { translator } from "./i18n.mjs";
import { configurationHtml, configurationRow, readConfiguration, conditionRuleIds } from "./configuration.mjs";
import { CSS } from "./style.mjs";
const esc = (value) =>
	String(value ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
const ref = ({ kind, id, revision }) => ({ kind, id, revision });
const lines = (value) =>
	value
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter(Boolean);
export default {
	mount(container, ctx) {
		const rpc = transport(ctx);
		let closed = false,
			source,
			page = { items: [], nextCursor: null },
			report,
			contract,
			snapshot,
			targetKind,
			reviews = [],
			jobs,
			job;
		let draft, revision, observation, configuration, upload, execution, offlineAttempts;
		let view = "records",
			error = "",
			notice = "",
			busy = false,
			findingsOffset = 0,
			evidence;
		let t = translator(document.documentElement.lang || "zh");
		const root = document.createElement("div");
		root.className = "aev";
		container.append(root);
		const button = (action, key, attributes = "") =>
			`<button type="button" data-action="${action}" ${attributes}>${esc(t(key))}</button>`;
		const badge = (value) => `<span class="badge">${esc(t(value ?? "unknown"))}</span>`;
		const field = (key, content) => `<div><span class="muted">${esc(t(key))}</span><p>${content}</p></div>`;
		function render() {
			if (closed) return;
			const offlineForm = root.querySelector("form[data-form=offline-execution]");
			if (execution && offlineForm) execution.form = Object.fromEntries(new FormData(offlineForm));
			const importForm = root.querySelector("form[data-form=import]");
			if (upload && importForm) {
				const values = new FormData(importForm);
				upload.form = { ...Object.fromEntries(values), trajectories: values.getAll("trajectory") };
			}
			root.innerHTML = `<style>${CSS}</style><header><div><h1>${esc(t("title"))}</h1><p class="muted">${esc(t(view === "detail" ? "detail" : "records"))}</p></div><div class="actions">${view !== "records" ? button("back", "back") : button("refresh", "refresh")}${view === "records" ? button("import", "import", !source ? "disabled" : "") : ""}${view === "records" ? button("new", "new", `class="primary" ${!source?.choices.length ? "disabled" : ""}`) : ""}</div></header><div role="alert" tabindex="-1">${esc(error)}</div><div class="status" role="status" aria-live="polite">${esc(busy ? t("loading") : notice)}</div>${observation && !configuration ? observationHtml() : ""}${executionHtml(execution, { t, esc, button, badge })}<main>${view === "import" ? importHtml() : view === "new" ? newHtml() : view === "detail" ? detailHtml() : recordsHtml()}</main>`;
			if (busy)
				root.querySelectorAll("button:not([data-action=back])").forEach((b) => {
					b.disabled = true;
				});
		}
		function recordsHtml() {
			return `<p class="muted">${esc(t("hint"))}</p>${source ? `<p>${esc(source.sourceId)} · ${esc(source.clientVersion ?? t("unknown"))}</p>` : `<p>${esc(t("noSource"))}</p>`}${job ? jobHtml() : ""}<div class="actions">${button("jobs", "scoringJobs", !source ? "disabled" : "")}${button("offline-attempts", "findOfflineAttempts", !source ? "disabled" : "")}</div>${offlineAttemptsHtml(offlineAttempts, { t, esc, button, badge })}${jobs ? jobsHtml() : ""}${!page.items.length ? `<section class="empty">${esc(t("empty"))}</section>` : `<section class="table-wrap"><table><thead><tr>${["range", "source", "execution", "goal", "coverage", "updated"].map((k) => `<th scope="col">${esc(t(k))}</th>`).join("")}</tr></thead><tbody>${page.items.map((r, i) => `<tr><td><p>${esc(r.objectivePreview)}</p><small>${r.taskRange?.source === "offline" ? esc(t("offline")) : `${esc(r.taskRange?.startMessageId)} → ${esc(r.taskRange?.endMessageId)}`}</small><p>${button("open", "open", `data-index="${i}" data-id="${esc(r.id)}"`)}</p></td><td>${esc(r.targetKind === "cli" ? t("offlineDiagnostic") : r.taskRange?.source === "offline" ? t("offline") : "Pi SDK")}<br>${esc(r.sourceVersion ?? t("unknown"))}</td><td>${badge(r.executionState)}<br><small>${esc(t("scoringState"))}</small> ${badge(r.state)}<br>${badge(r.assessmentStage)}</td><td>${badge(r.summary?.goal)}<br>${badge(r.summary?.deliveryVerdict)}</td><td>${r.summary?.counts?.coverage == null ? esc(t("unknown")) : `${Math.round(r.summary.counts.coverage * 100)}%`}<br>${esc(t(r.evidenceCoverage ?? "unknown"))}</td><td>${esc(r.createdAt)}</td></tr>`).join("")}</tbody></table></section>`}<div class="actions">${button("first", "first")}${page.nextCursor ? button("next", "next") : ""}</div>`;
		}
		function observationHtml() {
			return `<section data-observation><h2>${esc(t("observation"))} · ${esc(t(observation.state ?? "observing"))}</h2><p>${esc(t("observationHint"))}</p><p>${esc(observation.range)} · ${esc(t("evidence"))}: ${observation.latest?.evidenceCount ?? 0} · ${esc(t("gaps"))}: ${observation.latest?.gapCount ?? 0}</p><p>${esc(observation.error?.message ?? observation.lastError?.message ?? "")}</p><div class="actions">${button("watch-status", "checkObservation")}${observation.state !== "stopped" ? button("watch-stop", "stopObservation") : button("watch-dismiss", "dismissObservation")}${observation.latest?.checkpointRef ? button("watch-score", "scoreObservation") : ""}</div></section>`;
		}
		function detachObservation() {
			if (!observation) return;
			if (observation.state !== "stopped") {
				try {
					ctx.send({
						action: "watchStop",
						...observation.source,
						watchId: observation.watchId,
						requestId: crypto.randomUUID(),
					});
				} catch {
					/* The server lease expires if the channel has already closed. */
				}
			}
			observation = undefined;
		}
		function newHtml() {
			const options = source.choices
				.map((c) => `<option value="${esc(c.id)}">${esc(`${c.role} · ${c.id} · ${c.preview}`)}</option>`)
				.join("");
			return `<section><h2>${esc(t("new"))}</h2><p>${esc(t("selected"))}</p><p class="muted">${esc(t("window"))}</p><form data-form="diagnose"><div class="grid"><label>${esc(t("start"))}<select name="start">${options}</select></label><label>${esc(t("end"))}<select name="end">${options.replace(`value="${esc(source.choices.at(-1).id)}"`, `value="${esc(source.choices.at(-1).id)}" selected`)}</select></label></div><label>${esc(t("objective"))}<textarea name="objective" required maxlength="16384"></textarea></label><label>${esc(t("condition"))}<textarea name="conditions" maxlength="24000"></textarea></label><p class="muted">${esc(t("conditionHint"))}</p><label>${esc(t("paths"))}<textarea name="paths" maxlength="10000"></textarea></label><label>${esc(t("format"))}<select name="format"><option value="exists">${esc(t("exists"))}</option><option value="json">${esc(t("json"))}</option></select></label><button class="primary" type="submit">${esc(t("create"))}</button></form></section>`;
		}
		function discardUpload() {
			if (!upload) return;
			try {
				ctx.send({ action: "uploadDiscard", ...upload.source, requestId: crypto.randomUUID() });
			} catch {
				/* The fixed upload expiry still applies. */
			}
			upload = undefined;
		}
		function importHtml() {
			const preview = upload?.preview,
				saved = upload?.form ?? {};
			if (!preview)
				return `<section><h2>${esc(t("import"))}</h2><p>${esc(t("importHint"))}</p><form data-form="upload"><label>${esc(t("atifFile"))}<input name="file" type="file" accept=".json,application/json" required aria-describedby="upload-hint"></label><p id="upload-hint" class="muted">${esc(t("uploadHint"))}</p><button type="submit" class="primary">${esc(t("previewImport"))}</button></form></section>`;
			return `<section data-import-preview><h2>${esc(t("confirmImport"))}</h2><p>${esc(upload.name)} · ${preview.byteLength} bytes · ${preview.format}</p><p>${esc(t("packageDigest"))}: ${esc(preview.sha256)}</p><p class="muted">${esc(t("unverifiedImport"))}</p><p>${esc(t("conversionLosses"))}: ${preview.lossCount} · ${esc(t("evidence"))}: ${preview.eventCount}</p><details><summary>${esc(t("conversionLosses"))}</summary><pre>${esc(JSON.stringify(preview.losses, null, 2))}</pre>${preview.nextOffset != null ? button("import-losses", "next") : ""}</details><form data-form="import"><fieldset><legend>${esc(t("selectDocuments"))}</legend>${preview.trajectories.map((item, i) => `<label class="check-label"><input type="checkbox" name="trajectory" value="${esc(item.pointer)}" ${(saved.trajectories ? saved.trajectories.includes(item.pointer) : i === 0) ? "checked" : ""}><span>${esc(item.pointer)} · ${esc(item.trajectoryId ?? item.sessionId ?? t("unknown"))} · ${esc(item.agentName)}</span></label>`).join("")}</fieldset><p class="muted">${esc(t("documentHint"))}</p><label>${esc(t("sourceDeclaration"))}<textarea name="sourceDeclaration" required maxlength="4096">${esc(saved.sourceDeclaration)}</textarea></label><label>${esc(t("objective"))}<textarea name="objective" required maxlength="16384">${esc(saved.objective)}</textarea></label><label>${esc(t("condition"))}<textarea name="conditions" required maxlength="24000">${esc(saved.conditions)}</textarea></label><p class="muted">${esc(t("conditionHint"))}</p><label class="check-label"><input type="checkbox" name="confirm" required ${saved.confirm === "on" ? "checked" : ""}>${esc(t("confirmOffline"))}</label><div class="actions"><button type="submit" class="primary">${esc(t("importAndScore"))}</button>${button("import-reset", "changeFile")}</div></form></section>`;
		}
		function offlineHtml() {
			const scope = contract.data.scope;
			return `<section data-offline-source><h2>${esc(t("offline"))}</h2><p>${esc(t("unverifiedImport"))}</p><p>${esc(scope.format)} · ${esc(t("converterVersion"))}: ${esc(scope.converterVersion)}</p><p>${esc(t("packageDigest"))}: ${esc(scope.packageDigest)}</p><p>${esc(t("selectDocuments"))}: ${esc(scope.trajectoryPointers.join(", "))}</p><div class="actions">${button("import-manifest", "importManifest")}${button("import-source", "evidenceRaw")}</div><form data-form="original"><label class="check-label"><input type="checkbox" name="allowOriginal" required>${esc(t("originalWarning"))}</label><button type="submit">${esc(t("readOriginal"))}</button></form></section>`;
		}
		function jobsHtml() {
			return `<section data-jobs><h2>${esc(t("scoringJobs"))}</h2><p class="muted">${esc(t("jobsHint"))}</p>${jobs.items.length ? jobs.items.map((item, i) => `<div><p>${esc(item.objectivePreview)} · ${esc(item.createdAt)}</p>${button("job-open", "check", `data-index="${i}" data-id="${esc(item.jobId)}"`)}</div>`).join("") : `<p>${esc(t("noJobs"))}</p>`}<div class="actions">${button("jobs-first", "first")}${jobs.nextCursor ? button("jobs-next", "next") : ""}</div></section>`;
		}
		function jobHtml() {
			return `<section data-job="${esc(job.jobId)}"><h2>${esc(t(job.state))}</h2><p>${esc(t(job.state === "unknown" ? "unknownJobHint" : "jobHint"))}</p><div class="actions">${button("status", "check")}${!["completed", "cancelled", "failed", "unknown"].includes(job.state) ? button("cancel", "cancel") : ""}</div></section>`;
		}
		function detailHtml() {
			if (!report) return "";
			if (revision) return revisionHtml();
			if (configuration)
				return `<form data-form="configuration"><section><h2>${esc(t("configureRules"))}</h2><p>${esc(t("configureSnapshotHint"))}</p><p>${esc(configuration.contract.data.objective)}</p><p>${esc(report.id)} · ${esc(snapshot.id)}</p></section>${configurationHtml(configuration.configs, [...configuration.contract.data.conditions, ...configuration.contract.data.constraints], t, esc)}<div class="actions"><button type="submit" class="primary">${esc(t("saveConfiguration"))}</button>${button("discard-configuration", "discardRevision")}</div></form>`;
			const d = report.data;
			return `<section><h2>${esc(contract.data.objective)}</h2><div class="grid">${field("source", esc(targetKind === "cli" ? t("offlineDiagnostic") : contract.data.scope.source === "offline" ? t("offline") : "Pi SDK"))}${field("summary", badge(d.summary.deliveryVerdict))}${field("goal", badge(d.summary.goal))}${field("scoringState", badge(d.state))}${field("stage", badge(d.assessmentStage))}${field("coverage", badge(snapshot.data.coverage))}</div><p>${contract.data.scope.source === "offline" ? esc(t("offline")) : `${esc(contract.data.scope.startMessageId)} → ${esc(contract.data.scope.endMessageId)}`}</p><small>${esc(report.id)} · r${report.revision} · ${esc(report.createdAt)}</small><p>${esc(t("contractRevision"))}: ${esc(contract.revision)}</p><div class="actions">${button("export", "export")}${button("reevaluate", "reevaluate")}${contract.data.scope.source === "pi" ? button("offline-new", "offlineDiagnostic") : ""}${contract.data.scope.source !== "offline" && targetKind !== "cli" ? button("revise", "revise") : ""}${button("configure", "configureRules", observation && observation.state !== "stopped" ? "disabled" : "")}${contract.data.scope.source !== "offline" && targetKind !== "cli" && !observation && snapshot.data.attemptRefs?.length ? button("watch-start", "startObservation") : ""}</div><p class="muted">${esc(t("reevaluateHint"))}</p></section>${contract.data.scope.source === "offline" ? offlineHtml() : ""}<section><h2>${esc(t("findings"))}</h2>${d.findings
				.map(
					(f, index) =>
						`<article><h3>${esc(f.ruleId)} · ${esc(f.conditionId ?? f.findingId)}</h3>${badge(f.verdict)}${badge(f.evidenceState)}<p><b>${esc(t("reason"))}</b> · ${esc(t(f.reason))}</p>${f.missingEvidence.length ? `<p><b>${esc(t("missing"))}</b> · ${esc(f.missingEvidence.map((item) => t(item)).join("; "))}</p>` : ""}<div class="actions">${f.evidenceRefs.map((_, j) => button("evidence", "evidence", `data-finding="${index}" data-evidence="${j}"`)).join("") || `<p>${esc(t("noEvidence"))}</p>`}</div><details><summary>${esc(t("reviews"))}</summary><p>${esc(t("reviewHint"))}</p><p>${esc(t("original"))}: ${esc(t(f.verdict))}</p>${
							reviews
								.filter((r) => r.review.findingId === f.findingId)
								.map(
									(r) =>
										`<div class="review">${badge(r.review.decision)}<span>${esc(r.createdAt)} · ${esc(r.reviewer)}</span><p>${esc(r.review.reason)}</p></div>`,
								)
								.join("") || `<p>${esc(t("noReviews"))}</p>`
						}<form data-form="review" data-finding="${index}"><label>${esc(t("decision"))}<select name="decision">${["inconclusive", "pass", "fail", "not-applicable"].map((v) => `<option value="${v}">${esc(t(v))}</option>`).join("")}</select></label><label>${esc(t("reviewReason"))}<textarea name="reason" required maxlength="16384"></textarea></label><button type="submit">${esc(t("saveReview"))}</button></form></details>${f.metrics ? `<details><summary>${esc(t("raw"))}</summary><pre>${esc(JSON.stringify(f.metrics, null, 2))}</pre></details>` : ""}</article>`,
				)
				.join(
					"",
				)}<div class="actions">${findingsOffset ? button("findings-first", "first") : ""}${report.pages.findings?.nextOffset != null ? button("findings-next", "next") : ""}</div></section>${evidence ? `<section tabindex="-1" data-evidence-panel><h2>${esc(t("evidence"))}</h2><p>${esc(evidence.record.data.sourceLocator)}</p><p>${esc(evidence.record.id)} · ${esc(evidence.record.data.sourceEventId)} · ${esc(evidence.record.data.origin)} · ${esc(evidence.record.data.availability)}</p><p class="muted">${esc(t("sealedEvidenceHint"))}</p><div class="actions">${button("evidence-raw", "evidenceRaw")}${evidence.record.data.kind === "message" && evidence.record.data.producer === "pi-evidence-v1" ? button("evidence-source", "revealSource") : ""}${evidence.record.data.kind === "artifact-snapshot" && evidence.record.data.producer === "artifact-reader-v1" ? button("evidence-artifact", "sealedFile") : ""}${evidence.record.data.kind === "native-test-run" && evidence.record.data.producer === "native-reader-v1" ? button("evidence-native", "sealedRun") + button("evidence-run", "openNativeRun") : ""}</div>${evidence.nativeRun ? nativeRunHtml(evidence.nativeRun) : ""}<h3>${esc(t(evidence.view === "original" ? "readOriginal" : evidence.view === "artifact-text" ? "sealedFile" : evidence.view === "native-run" ? "sealedRun" : "evidenceRaw"))}</h3>${evidence.unavailable ? `<p role="status">${esc(t(evidence.unavailable))}</p>` : `<pre>${esc(evidence.text)}</pre>`}<p>${esc(t("characterOffset"))}: ${evidence.offset}</p><div class="actions">${evidence.offset ? button("evidence-first", "first") : ""}${evidence.nextOffset != null ? button("evidence-next", "next") : ""}</div></section>` : ""}<section><h2>${esc(t("config"))}</h2><p>${esc(t("costHint"))}</p><p>${esc(t("version"))}: ${esc(d.profileVersion)}</p><details><summary>${esc(t("raw"))}</summary><pre>${esc(JSON.stringify({ configuration: d.configuration, job: d.job, evaluatorVersions: d.evaluatorVersions }, null, 2))}</pre></details><h3>${esc(t("gaps"))}</h3><pre>${esc(snapshot.data.gaps.join("\n"))}</pre></section>`;
		}
		function nativeRunHtml(run) {
			return `<section data-native-run><h3>${esc(t("openNativeRun"))}</h3><p>${esc(t("nativeVerified"))}</p><p>${esc(run.engine)} · ${esc(run.runId)} · ${esc(run.at)}</p><p>${esc(t("nativeEvidence"))}: ${esc(t(run.complete ? "complete" : "partial"))} · ${esc(t(run.review))}</p><p class="muted">${esc(t("nativeRowsHint"))}</p><div class="table-wrap"><table><thead><tr>${["nativeCase", "nativeInstance", "nativeStatus", "nativeEvidence"].map((key) => `<th scope="col">${esc(t(key))}</th>`).join("")}</tr></thead><tbody>${run.rows.map((row) => `<tr><td>${esc(row.caseId)}</td><td>${esc(row.instanceId)}</td><td>${esc(["passed", "failed", "skipped", "SKIP", "not-run", "blocked", "error", "unknown"].includes(row.status) ? t(`native-status-${row.status}`) : row.status)}</td><td>${esc(t(row.evidenceComplete ? "complete" : "partial"))}</td></tr>`).join("")}</tbody></table></div><p>${run.total ? run.offset + 1 : 0}–${Math.min(run.total, run.offset + run.rows.length)} / ${run.total}</p><div class="actions">${run.offset ? button("evidence-run-first", "first") : ""}${run.nextOffset != null ? button("evidence-run-next", "next") : ""}</div></section>`;
		}
		function bindingRules() {
			return (source?.rules ?? []).filter((rule) => conditionRuleIds.includes(rule.id));
		}
		function bindingSelect(name, label = "bindingMethod") {
			return `<label>${esc(t(label))}<select name="${name}"><option value="">${esc(t("manualBinding"))}</option>${bindingRules()
				.map(
					(rule) =>
						`<option value="${esc(`${rule.id}@${rule.version}`)}">${esc(rule.id)} · ${esc(t(`cfg-${rule.id}`))} · v${esc(rule.version)}</option>`,
				)
				.join("")}</select></label>`;
		}
		function selectedBinding(value) {
			if (!value) return undefined;
			if (!bindingRules().some((rule) => `${rule.id}@${rule.version}` === value))
				throw new Error(t("bindingUnavailable"));
			return value;
		}

		function revisionHtml() {
			const data = revision.contract.data;
			return `<section><h2>${esc(t("revise"))}</h2><p>${esc(t("revisionHint"))}</p><p>${esc(data.scope.startMessageId)} → ${esc(data.scope.endMessageId)} · ${esc(t("contractRevision"))} ${revision.contract.revision}</p><p>${esc(t("bindingHint"))}</p><form data-form="revision"><label>${esc(t("objective"))}<textarea name="objective" required maxlength="16384">${esc(data.objective)}</textarea></label>${["conditions", "constraints"].map((field) => `<fieldset><legend>${esc(t(field))}</legend>${data[field].map((c, index) => `<div class="condition"><label>${esc(c.id)}<textarea name="${field}-${index}-statement" required maxlength="16384" ${c.ruleRef ? "readonly" : ""}>${esc(c.statement)}</textarea></label>${c.ruleRef ? `<p class="muted">${esc(t("boundCheck"))} · ${esc(c.ruleRef)}</p>` : bindingSelect(`${field}-${index}-ruleRef`)}<label class="check-label"><input type="checkbox" name="${field}-${index}-required" ${c.required ? "checked" : ""}>${esc(t("required"))}</label></div>`).join("")}</fieldset>`).join("")}<label>${esc(t("additionalConditions"))}<textarea name="additionalConditions" maxlength="24000"></textarea></label>${bindingSelect("additionalRuleRef", "additionalBindingMethod")}<p class="muted">${esc(t("conditionHint"))}</p><div class="actions"><button type="submit" class="primary">${esc(t("saveRevision"))}</button>${button("discard-revision", "discardRevision")}</div></form></section>`;
		}
		function reportConfigs() {
			if (!report.data.configuration) throw new Error(t("missingConfig"));
			return Object.fromEntries(report.data.configuration.rules.map((rule) => [rule.id, rule.config]));
		}
		async function completeContract(reference) {
			const result = await rpc.request("get", { ref: reference, limit: 20 });
			// Fetch every field before revising; a page projection must never delete unseen conditions.
			for (const [field, page] of Object.entries(result.pages)) {
				let offset = page.nextOffset;
				while (offset != null) {
					const part = await rpc.request("get", { ref: reference, offset, limit: 20 });
					if (part.sourceDigest !== result.sourceDigest) throw new Error(t("recordChanged"));
					result.data[field].push(...part.data[field]);
					offset = part.pages[field].nextOffset;
				}
			}
			return result;
		}
		async function run(fn, { preserve = false } = {}) {
			const generation = rpc.generation;
			const fileInputs = [...root.querySelectorAll("input[type=file]:not(:disabled)")];
			fileInputs.forEach((input) => {
				input.disabled = true;
			});
			const enabledButtons = preserve ? [...root.querySelectorAll("button:not(:disabled)")] : [];
			busy = true;
			error = "";
			notice = "";
			if (!preserve) render();
			else {
				root.querySelector("[role=alert]").textContent = "";
				root.querySelector(".status").textContent = t("loading");
				enabledButtons.forEach((b) => {
					b.disabled = true;
				});
			}
			try {
				await fn();
			} catch (e) {
				if (e.stale || generation !== rpc.generation || closed) return;
				error = `${e.code ? `${e.code} · ` : ""}${e.message}`;
				if (preserve) {
					const alert = root.querySelector("[role=alert]");
					alert.textContent = error;
					alert.focus();
					enabledButtons.forEach((b) => {
						if (b.isConnected) b.disabled = false;
					});
					root.querySelector(".status").textContent = "";
					busy = false;
					return;
				}
			} finally {
				if (generation === rpc.generation) busy = false;
				fileInputs.forEach((input) => {
					if (input.isConnected) input.disabled = false;
				});
			}
			if (generation === rpc.generation && !closed) render();
		}
		async function list(cursor) {
			page = await rpc.request("list", { kind: "evaluations", limit: 20, ...(cursor ? { cursor } : {}) });
		}
		async function refresh() {
			discardUpload();
			detachObservation();
			rpc.select({});
			source = undefined;
			execution = undefined;
			offlineAttempts = undefined;
			revision = undefined;
			configuration = undefined;
			draft = undefined;
			job = undefined;
			jobs = undefined;
			report = undefined;
			view = "records";
			page = { items: [] };
			await run(async () => {
				source = await rpc.request("describe", { limit: 100 });
				// No pending requests here; bind all subsequent calls to this exact source.
			});
			if (closed || !source) return;
			rpc.select({ conversationId: source.conversationId, sessionId: source.sessionId });
			await run(() => list());
		}
		async function open(reference, offset = 0) {
			const value = await rpc.request("get", { ref: reference, offset, limit: 10 });
			const c = await rpc.request("get", { ref: value.data.contractRef });
			const s = await rpc.request("get", { ref: value.data.snapshotRef });
			const attempt = s.data.attemptRefs?.[0] ? await rpc.request("get", { ref: s.data.attemptRefs[0] }) : undefined;
			const target = attempt ? await rpc.request("get", { ref: attempt.data.targetRef }) : undefined;
			const reviewRows = [];
			let cursor;
			do {
				const result = await rpc.request("list", {
					kind: "reviews",
					ref: reference,
					limit: 50,
					...(cursor ? { cursor } : {}),
				});
				reviewRows.push(...result.items);
				cursor = result.nextCursor;
			} while (cursor && reviewRows.length < 1000);
			report = value;
			contract = c;
			snapshot = s;
			targetKind = target?.data.kind;
			reviews = reviewRows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
			findingsOffset = offset;
			evidence = undefined;
			view = "detail";
		}
		async function status(jobId = job.jobId) {
			job = await rpc.request("status", { jobId });
			if (job.reportRef) await open(job.reportRef);
		}
		async function readEvidence(reference, offset = 0, evidenceView = "raw") {
			const record = await rpc.request("get", { ref: reference });
			const body =
				evidenceView === "original"
					? await rpc.request("readOriginal", { ref: reference, offset })
					: await rpc.request("readEvidence", { ref: reference, offset, evidenceView });
			evidence = { record, ...body, view: evidenceView, offset };
		}
		root.addEventListener("click", (event) => {
			const target = event.target.closest?.("button[data-action]");
			if (!target || target.disabled) return;
			const action = target.dataset.action;
			if (action === "refresh") {
				void refresh();
				return;
			}
			if (action === "back") {
				discardUpload();
				rpc.select(source ? { conversationId: source.conversationId, sessionId: source.sessionId } : {});
				view = "records";
				revision = undefined;
				configuration = undefined;
				busy = false;
				void run(() => list());
				return;
			}
			if (action === "import" || action === "import-reset") {
				discardUpload();
				upload = { source: { conversationId: source.conversationId, sessionId: source.sessionId } };
				draft = undefined;
				view = "import";
				error = "";
				notice = "";
				render();
				root.querySelector("input[type=file]")?.focus();
				return;
			}
			if (action === "new") {
				draft = undefined;
				view = "new";
				error = "";
				notice = "";
				render();
				root.querySelector("textarea")?.focus();
				return;
			}
			if (action === "config-add") {
				const rule = target.dataset.rule,
					rows = root.querySelector(`[data-config-rows="${rule}"]`);
				if (rows.children.length >= 100) {
					error = t("configurationLimit");
					root.querySelector("[role=alert]").textContent = error;
					return;
				}
				const index = Number(rows.dataset.nextIndex++);
				rows.insertAdjacentHTML(
					"beforeend",
					configurationRow(
						rule,
						index,
						{},
						[...configuration.contract.data.conditions, ...configuration.contract.data.constraints],
						t,
						esc,
					),
				);
				rows.lastElementChild.querySelector("select,input,textarea")?.focus();
				return;
			}
			if (action === "config-remove") {
				const row = target.closest("[data-config-row]"),
					rows = row.parentElement;
				row.remove();
				rows.nextElementSibling?.focus();
				return;
			}
			if (action === "discard-configuration") {
				configuration = undefined;
				draft = undefined;
				render();
				root.querySelector("[data-action=configure]")?.focus();
				return;
			}

			if (action === "discard-revision") {
				revision = undefined;
				draft = undefined;
				render();
				root.querySelector("[data-action=revise]")?.focus();
				return;
			}
			void run(async () => {
				if (action === "offline-new") {
					const capabilities = await rpc.request("offlineDescribe");
					execution = { capabilities, contractRef: ref(contract), objective: contract.data.objective };
				}
				if (action === "offline-dismiss") execution = undefined;
				if (["offline-attempts", "offline-first", "offline-next"].includes(action))
					offlineAttempts = await rpc.request("list", {
						kind: "offlineAttempts",
						limit: 20,
						...(action === "offline-next" ? { cursor: offlineAttempts.nextCursor } : {}),
					});
				if (action === "offline-open") {
					const item = offlineAttempts.items[Number(target.dataset.index)];
					execution = {
						attemptRef: ref(item),
						objective: item.objectivePreview,
						status: { state: "unknown", stopConfirmed: false },
					};
					execution.status = await rpc.request("offlineStatus", { ref: execution.attemptRef });
					execution.attemptRef = execution.status.attemptRef;
				}
				if (["offline-start", "offline-status", "offline-reconcile", "offline-cancel"].includes(action)) {
					const selected = execution;
					try {
						const status = await rpc.request(
							{
								"offline-start": "offlineStart",
								"offline-status": "offlineStatus",
								"offline-reconcile": "offlineReconcile",
								"offline-cancel": "offlineCancel",
							}[action],
							{ ref: selected.attemptRef },
						);
						if (execution === selected) {
							selected.status = status;
							selected.attemptRef = status.attemptRef;
						}
					} catch (error) {
						if (execution === selected && ["TIMEOUT", "EXECUTION_UNKNOWN", "PERMISSION_DENIED"].includes(error.code))
							selected.status = { state: "unknown", stopConfirmed: false };
						throw error;
					}
				}
				if (action === "offline-cleanup") {
					const selected = execution,
						value = await rpc.request("offlineCleanup", { ref: selected.attemptRef });
					if (execution === selected) {
						selected.snapshotRef = value.snapshotRef;
						selected.snapshot = await rpc.request("get", { ref: value.snapshotRef, limit: 20 });
						for (const ref of selected.snapshot.data.evidenceRefs) {
							const evidence = await rpc.request("get", { ref });
							if (evidence.data.kind === "verification-result") {
								const body = await rpc.request("readEvidence", { ref });
								selected.verification = JSON.parse(body.text);
							}
						}
					}
				}
				if (action === "offline-score") {
					job = await rpc.request("evaluate", { ref: execution.snapshotRef });
					view = "records";
					await list();
					await status();
				}
				if (["offline-evidence", "offline-evidence-first", "offline-evidence-next"].includes(action)) {
					const selected = execution,
						reference =
							action === "offline-evidence"
								? selected.snapshot.data.evidenceRefs[Number(target.dataset.index)]
								: selected.evidence.ref;
					const offset = action === "offline-evidence-next" ? selected.evidence.nextOffset : 0;
					const body = await rpc.request("readEvidence", { ref: reference, offset });
					if (execution === selected) selected.evidence = { ...body, ref: reference, offset };
				}
				if (action === "import-losses") {
					const part = await rpc.request("uploadPreview", {
						data: { uploadId: upload.preview.uploadId },
						offset: upload.preview.nextOffset,
					});
					upload.preview.losses = part.losses;
					upload.preview.nextOffset = part.nextOffset;
				}
				if (action === "import-source") await readEvidence(snapshot.data.evidenceRefs[0]);
				if (action === "import-manifest") {
					const total = snapshot.pages.evidenceRefs.total;
					const last = await rpc.request("get", { ref: ref(snapshot), offset: total - 1, limit: 1 });
					await readEvidence(last.data.evidenceRefs[0]);
				}
				if (action === "watch-start") {
					const configs = reportConfigs(),
						paths = [...new Set((configs.F01?.checks ?? []).map((check) => check.path))];
					if (paths.length > 20) throw new Error(t("tooManyPaths"));
					const watchId = crypto.randomUUID();
					const selected = (observation = {
						watchId,
						source: { conversationId: source.conversationId, sessionId: source.sessionId },
						configs,
						range: `${contract.data.scope.startMessageId} → ${contract.data.scope.endMessageId}`,
						state: "observing",
					});
					let value;
					try {
						value = await rpc.request("watchStart", {
							ref: snapshot.data.attemptRefs[0],
							artifactPaths: paths,
							watchId,
						});
					} catch (error) {
						if (
							observation === selected &&
							error.code &&
							!["TIMEOUT", "EXECUTION_UNKNOWN", "IO_ERROR"].includes(error.code)
						)
							observation = undefined;
						throw error;
					}
					if (observation === selected && !closed) Object.assign(selected, value);
				}
				if (action === "watch-dismiss" && observation?.state === "stopped") observation = undefined;
				if (["watch-status", "watch-stop", "watch-score"].includes(action)) {
					const selected = observation;
					const value = await rpc.request(action === "watch-status" ? "watchStatus" : "watchStop", {
						...selected.source,
						watchId: selected.watchId,
					});
					if (observation !== selected || closed) return;
					Object.assign(selected, value);
					if (action === "watch-score") {
						if (!observation.latest?.checkpointRef) throw new Error(t("noObservation"));
						const sealed = await rpc.request("seal", { ref: observation.latest.checkpointRef });
						job = await rpc.request("evaluate", { ref: sealed, configs: observation.configs });
						view = "records";
						await list();
						await status();
					}
				}
				if (action === "configure") {
					configuration = { configs: reportConfigs(), contract: await completeContract(ref(contract)) };
					draft = undefined;
				}
				if (action === "revise") {
					const configs = reportConfigs();
					revision = { contract: await completeContract(ref(contract)), configs };
					draft = undefined;
				}
				if (action === "reevaluate") {
					job = await rpc.request("evaluate", { ref: ref(report) });
					view = "records";
					await list();
					await status();
					notice = t("reevaluateStarted");
				}
				if (action === "first" || action === "next") await list(action === "next" ? page.nextCursor : undefined);
				if (action === "open") await open(ref(page.items[Number(target.dataset.index)]));
				if (action === "findings-first" || action === "findings-next")
					await open(ref(report), action === "findings-next" ? report.pages.findings.nextOffset : 0);
				if (["jobs", "jobs-first", "jobs-next"].includes(action))
					jobs = await rpc.request("list", {
						kind: "jobs",
						limit: 20,
						...(action === "jobs-next" ? { cursor: jobs.nextCursor } : {}),
					});
				if (action === "job-open") await status(jobs.items[Number(target.dataset.index)].jobId);
				if (action === "status") await status();
				if (action === "cancel") {
					job = await rpc.request("cancel", { jobId: job.jobId });
					if (job.reportRef) await open(job.reportRef);
				}
				if (action === "evidence")
					await readEvidence(
						report.data.findings[Number(target.dataset.finding)].evidenceRefs[Number(target.dataset.evidence)],
					);
				if (["evidence-run", "evidence-run-first", "evidence-run-next"].includes(action)) {
					const offset = action === "evidence-run-next" ? evidence.nativeRun.nextOffset : 0;
					evidence.nativeRun = undefined;
					evidence.nativeRun = await rpc.request("inspectNativeRun", { ref: ref(evidence.record), offset });
				}
				if (action === "evidence-source") {
					const target = await rpc.request("locateEvidence", { ref: ref(evidence.record) });
					const host = window.__piWebUiHost;
					if (!host?.sessions?.revealMessage) throw new Error(t("sourceHostUnavailable"));
					const result = host.sessions.revealMessage(target);
					if (!result.ok) throw new Error(result.error ?? t("sourceUnavailable"));
				}
				if (["evidence-raw", "evidence-artifact", "evidence-native"].includes(action))
					await readEvidence(
						ref(evidence.record),
						0,
						{ "evidence-raw": "raw", "evidence-artifact": "artifact-text", "evidence-native": "native-run" }[action],
					);
				if (action === "evidence-first" || action === "evidence-next")
					await readEvidence(
						ref(evidence.record),
						action === "evidence-first" ? 0 : evidence.nextOffset,
						evidence.view,
					);
				if (action === "export") {
					let text = "",
						offset = 0,
						manifest;
					do {
						const part = await rpc.request("export", { ref: ref(report), offset });
						manifest ??= part.manifestDigest;
						if (manifest !== part.manifestDigest)
							throw new Error("Report reviews changed during export; retry to obtain one consistent export.");
						text += part.text;
						offset = part.nextOffset;
					} while (offset !== null);
					const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
					const link = document.createElement("a");
					link.href = url;
					link.download = `evaluation-${report.id}.json`;
					link.click();
					setTimeout(() => URL.revokeObjectURL(url), 1000);
					notice = t("exportDone");
				}
			}).then(() => {
				if (
					((action.startsWith("evidence") && action !== "evidence-source") ||
						["import-source", "import-manifest"].includes(action)) &&
					!closed
				)
					root.querySelector("[data-evidence-panel]")?.focus();
				if (["offline-new", "offline-open"].includes(action) && !closed)
					root.querySelector(error ? "[role=alert]" : "[data-offline-execution]")?.focus();
				if (action === "revise" && !closed) root.querySelector("form[data-form=revision] textarea")?.focus();
			});
		});
		root.addEventListener("change", (event) => {
			if (!event.target.matches?.("input[type=file]")) return;
			const input = event.target,
				file = input.files?.[0];
			if (upload) {
				try {
					ctx.send({ action: "uploadDiscard", ...upload.source, requestId: crypto.randomUUID() });
				} catch {
					/* The fixed upload expiry still applies. */
				}
			}
			input.setCustomValidity(file && file.size > 0 && file.size <= 512 * 1024 ? "" : t("uploadHint"));
			if (!input.checkValidity()) input.reportValidity();
		});
		root.addEventListener("submit", (event) => {
			const form = event.target.closest("form");
			if (!form || busy) return;
			event.preventDefault();
			const values = Object.fromEntries(new FormData(form));
			const selectedPointers = form.dataset.form === "import" ? new FormData(form).getAll("trajectory") : [];
			void run(
				async () => {
					if (form.dataset.form === "offline-execution") {
						const selected = execution;
						const argv = [values.mode, ...(values.args ? values.args.split(/\r?\n/) : [])];
						const attemptRef = await rpc.request("offlinePrepare", {
							ref: selected.contractRef,
							data: { argv, stdin: values.stdin, timeoutMs: Number(values.timeout) * 1000, graceMs: 200 },
						});
						if (execution === selected) {
							selected.attemptRef = attemptRef;
							selected.status = { state: "preparing", environmentState: "prepared", stopConfirmed: false };
						}
						return;
					}
					if (form.dataset.form === "upload") {
						const file = values.file,
							selected = upload;
						if (!file?.size || file.size > 512 * 1024) throw new Error(t("uploadHint"));
						const bytes = new Uint8Array(await file.arrayBuffer());
						const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
							.map((b) => b.toString(16).padStart(2, "0"))
							.join("");
						if (upload !== selected || closed) return;
						const start = await rpc.request("uploadStart", { data: { byteLength: bytes.length, sha256 } });
						for (let offset = start.offset; offset < bytes.length; offset += start.chunkBytes) {
							const base64 = btoa(String.fromCharCode(...bytes.subarray(offset, offset + start.chunkBytes)));
							await rpc.request("uploadChunk", { data: { uploadId: start.uploadId, offset, base64 } });
							root.querySelector(".status").textContent =
								`${t("uploading")}: ${Math.min(offset + start.chunkBytes, bytes.length)} / ${bytes.length}`;
						}
						const preview = await rpc.request("uploadPreview", { data: { uploadId: start.uploadId } });
						if (upload === selected && !closed) Object.assign(selected, { preview, name: file.name });
						return;
					}
					if (form.dataset.form === "original") {
						if (values.allowOriginal !== "on") throw new Error(t("originalWarning"));
						await readEvidence(snapshot.data.evidenceRefs[0], 0, "original");
						return;
					}
					if (form.dataset.form === "review") {
						const finding = report.data.findings[Number(form.dataset.finding)];
						const previous = reviews.filter((r) => r.review.findingId === finding.findingId).at(-1);
						await rpc.request("review", {
							data: {
								evaluationRef: ref(report),
								findingId: finding.findingId,
								...(previous ? { previousReviewRef: ref(previous) } : {}),
								decision: values.decision,
								reason: values.reason,
							},
						});
						await open(ref(report), findingsOffset);
						notice = t("saved");
						return;
					}
					const fingerprint = JSON.stringify([
						form.dataset.form,
						source.conversationId,
						source.sessionId,
						revision ? ref(revision.contract) : null,
						values,
						selectedPointers,
						upload?.preview?.sha256,
					]);
					if (draft?.fingerprint !== fingerprint) draft = { fingerprint, results: new Map() };
					const steps = draft.results;
					const step = async (action, data) => {
						if (!steps.has(action)) steps.set(action, await rpc.request(action, data));
						return steps.get(action);
					};
					if (form.dataset.form === "import") {
						if (values.confirm !== "on" || !selectedPointers.length || !lines(values.conditions).length)
							throw new Error(t("confirmOffline"));
						const c = await step("createImportContract", {
							data: {
								uploadId: upload.preview.uploadId,
								trajectoryPointers: selectedPointers,
								confirmed: true,
								contract: {
									objective: values.objective,
									conditions: lines(values.conditions).map((statement, i) => ({
										id: `condition-${i + 1}`,
										statement,
										sourceRef: "human-ui:offline",
										sourceType: "user",
										required: true,
										applicableWhen: "always",
									})),
									constraints: [],
									environmentRefs: [],
									provenance: "human-confirmed offline import",
									evaluationSubject: "agent-task",
								},
							},
						});
						const imported = await step("importAtif", {
							ref: c,
							data: { uploadId: upload.preview.uploadId, sourceDeclaration: values.sourceDeclaration, confirmed: true },
						});
						job = await step("evaluate", { ref: imported.snapshotRef });
						discardUpload();
						view = "records";
						await list();
						await status();
						notice = t("imported");
						return;
					}
					if (form.dataset.form === "configuration") {
						const configs = readConfiguration(form, t);
						await step("validateConfiguration", { ref: ref(report), configs });
						job = await step("evaluate", { ref: ref(snapshot), configs });
						view = "records";
						await list();
						await status();
						configuration = undefined;
						notice = t("configurationSaved");
						return;
					}
					if (form.dataset.form === "revision") {
						const original = revision.contract.data;
						const data = {
							...original,
							objective: values.objective,
							provenance: `human-confirmed revision of ${revision.contract.id}.${revision.contract.revision}`,
						};
						for (const field of ["conditions", "constraints"])
							data[field] = original[field].map((c, index) => {
								const statement = c.ruleRef ? c.statement : values[`${field}-${index}-statement`];
								const required = values[`${field}-${index}-required`] === "on";
								const ruleRef = c.ruleRef ?? selectedBinding(values[`${field}-${index}-ruleRef`]);
								const confirmed =
									c.required !== required ||
									c.statement !== statement ||
									ruleRef !== c.ruleRef ||
									(required && c.sourceType === "proposed");
								return {
									...c,
									...(ruleRef ? { ruleRef } : {}),
									statement,
									required,
									...(confirmed
										? { sourceType: "user", sourceRef: `human-ui:${revision.contract.id}:${field}:${c.id}` }
										: {}),
								};
							});
						const additional = lines(values.additionalConditions);
						const additionalRule = selectedBinding(values.additionalRuleRef);
						draft.conditionIds ??= additional.map(() => crypto.randomUUID());
						data.conditions.push(
							...additional.map((statement, index) => ({
								id: `condition-${draft.conditionIds[index]}`,
								...(additionalRule ? { ruleRef: additionalRule } : {}),
								statement,
								sourceType: "user",
								sourceRef: `human-ui:${revision.contract.id}`,
								required: true,
								applicableWhen: "always",
							})),
						);
						const paths = [...new Set((revision.configs.F01?.checks ?? []).map((check) => check.path))];
						if (paths.length > 20) throw new Error(t("revisionPathLimit"));
						const c = await step("reviseContract", { previousRef: ref(revision.contract), data });
						const attempt = await step("createAttempt", { ref: c });
						const collected = await step("collect", { ref: attempt, artifactPaths: paths });
						const sealed = await step("seal", { ref: collected.checkpointRef });
						job = await step("evaluate", { ref: sealed, configs: revision.configs });
						view = "records";
						await list();
						await status();
						revision = undefined;
						notice = t("revisionSaved");
						return;
					}
					const paths = [...new Set(lines(values.paths))];
					if (paths.length > 20) throw new Error(t("paths"));
					if (
						source.choices.findIndex((c) => c.id === values.start) >
						source.choices.findIndex((c) => c.id === values.end)
					)
						throw new Error(`${t("start")} > ${t("end")}`);
					const conditions = lines(values.conditions).map((statement, i) => ({
						id: `condition-${i + 1}`,
						statement,
						sourceRef: values.start,
						sourceType: "user",
						required: true,
						applicableWhen: "always",
					}));
					paths.forEach((path, i) =>
						conditions.push({
							id: `artifact-${i + 1}`,
							statement: `${t(values.format === "json" ? "json" : "exists")}: ${path}`,
							sourceRef: values.start,
							sourceType: "user",
							required: true,
							applicableWhen: "always",
							ruleRef: "F01@1",
						}),
					);
					const c = await step("createContract", {
						data: {
							scope: {
								source: "pi",
								sessionId: source.sessionId,
								startMessageId: values.start,
								endMessageId: values.end,
								boundaryPrecision: "exact",
								childPolicy: "exclude",
								childSessionIds: [],
							},
							objective: values.objective,
							conditions,
							constraints: [],
							environmentRefs: [],
							provenance: "human-confirmed in evaluation view",
							evaluationSubject: "agent-task",
						},
					});
					const attempt = await step("createAttempt", { ref: c });
					const collected = await step("collect", { ref: attempt, artifactPaths: paths });
					const sealed = await step("seal", { ref: collected.checkpointRef });
					job = await step("evaluate", {
						ref: sealed,
						configs: {
							F01: {
								checks: paths.map((path, i) => ({
									conditionId: `artifact-${i + 1}`,
									path,
									...(values.format === "json" ? { format: "json" } : {}),
								})),
							},
						},
					});
					view = "records";
					await list();
					await status();
				},
				{ preserve: true },
			).then(() => {
				if (closed || error) return;
				if (form.dataset.form === "upload" && view === "import" && upload?.preview)
					root.querySelector("[name=sourceDeclaration]")?.focus();
				if (form.dataset.form === "original") root.querySelector("[data-evidence-panel]")?.focus();
			});
		});
		const languageObserver = new MutationObserver(() => {
			t = translator(document.documentElement.lang || "zh");
			if (!["new", "import"].includes(view) && !revision && !configuration && !root.querySelector("textarea:focus"))
				render();
		});
		languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
		const heartbeat = setInterval(async () => {
			const selected = observation;
			if (!selected || selected.state === "stopped" || closed || busy) return;
			try {
				const value = await rpc.request("watchStatus", { ...selected.source, watchId: selected.watchId });
				if (observation !== selected || closed) return;
				Object.assign(selected, value);
				const panel = root.querySelector("[data-observation]");
				if (panel && !panel.contains(document.activeElement)) panel.outerHTML = observationHtml();
			} catch (error) {
				if (observation === selected && !closed && !error.stale && error.code !== "IN_PROGRESS") {
					selected.error = { message: error.message };
					const panel = root.querySelector("[data-observation]");
					if (panel && !panel.contains(document.activeElement)) panel.outerHTML = observationHtml();
				}
			}
		}, 15000);
		void refresh();
		return () => {
			discardUpload();
			clearInterval(heartbeat);
			detachObservation();
			closed = true;
			rpc.close();
			languageObserver.disconnect();
			root.remove();
		};
	},
};
