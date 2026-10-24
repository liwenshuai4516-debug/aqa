import { transport } from "./transport.mjs";
import { translator } from "./i18n.mjs";
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
			reviews = [],
			job;
		let draft;
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
			root.innerHTML = `<style>${CSS}</style><header><div><h1>${esc(t("title"))}</h1><p class="muted">${esc(t(view === "detail" ? "detail" : "records"))}</p></div><div class="actions">${view !== "records" ? button("back", "back") : button("refresh", "refresh")}${view === "records" ? button("new", "new", `class="primary" ${!source?.choices.length ? "disabled" : ""}`) : ""}</div></header><div role="alert" tabindex="-1">${esc(error)}</div><div class="status" role="status" aria-live="polite">${esc(busy ? t("loading") : notice)}</div><main>${view === "new" ? newHtml() : view === "detail" ? detailHtml() : recordsHtml()}</main>`;
			if (busy)
				root.querySelectorAll("button:not([data-action=back])").forEach((b) => {
					b.disabled = true;
				});
		}
		function recordsHtml() {
			return `<p class="muted">${esc(t("hint"))}</p>${source ? `<p>${esc(source.sourceId)} · ${esc(source.clientVersion ?? t("unknown"))}</p>` : `<p>${esc(t("noSource"))}</p>`}${job ? jobHtml() : ""}${!page.items.length ? `<section class="empty">${esc(t("empty"))}</section>` : `<section class="table-wrap"><table><thead><tr>${["range", "source", "execution", "goal", "coverage", "updated"].map((k) => `<th scope="col">${esc(t(k))}</th>`).join("")}</tr></thead><tbody>${page.items.map((r, i) => `<tr><td><p>${esc(r.objectivePreview)}</p><small>${esc(r.taskRange?.startMessageId)} → ${esc(r.taskRange?.endMessageId)}</small><p>${button("open", "open", `data-index="${i}"`)}</p></td><td>Pi SDK<br>${esc(r.sourceVersion ?? t("unknown"))}</td><td>${badge(r.executionState)}<br>${badge(r.assessmentStage)}</td><td>${badge(r.summary?.goal)}<br>${badge(r.summary?.deliveryVerdict)}</td><td>${r.summary?.counts?.coverage == null ? esc(t("unknown")) : `${Math.round(r.summary.counts.coverage * 100)}%`}<br>${esc(t(r.evidenceCoverage ?? "unknown"))}</td><td>${esc(r.createdAt)}</td></tr>`).join("")}</tbody></table></section>`}<div class="actions">${button("first", "first")}${page.nextCursor ? button("next", "next") : ""}</div>`;
		}
		function newHtml() {
			const options = source.choices
				.map((c) => `<option value="${esc(c.id)}">${esc(`${c.role} · ${c.id} · ${c.preview}`)}</option>`)
				.join("");
			return `<section><h2>${esc(t("new"))}</h2><p>${esc(t("selected"))}</p><p class="muted">${esc(t("window"))}</p><form data-form="diagnose"><div class="grid"><label>${esc(t("start"))}<select name="start">${options}</select></label><label>${esc(t("end"))}<select name="end">${options.replace(`value="${esc(source.choices.at(-1).id)}"`, `value="${esc(source.choices.at(-1).id)}" selected`)}</select></label></div><label>${esc(t("objective"))}<textarea name="objective" required maxlength="16384"></textarea></label><label>${esc(t("condition"))}<textarea name="conditions" maxlength="24000"></textarea></label><p class="muted">${esc(t("conditionHint"))}</p><label>${esc(t("paths"))}<textarea name="paths" maxlength="10000"></textarea></label><label>${esc(t("format"))}<select name="format"><option value="exists">${esc(t("exists"))}</option><option value="json">${esc(t("json"))}</option></select></label><button class="primary" type="submit">${esc(t("create"))}</button></form></section>`;
		}
		function jobHtml() {
			return `<section><h2>${esc(t(job.state))}</h2><p>${esc(t("jobHint"))}</p><div class="actions">${button("status", "check")}${!["completed", "cancelled", "failed", "unknown"].includes(job.state) ? button("cancel", "cancel") : ""}</div></section>`;
		}
		function detailHtml() {
			if (!report) return "";
			const d = report.data;
			return `<section><h2>${esc(contract.data.objective)}</h2><div class="grid">${field("summary", badge(d.summary.deliveryVerdict))}${field("goal", badge(d.summary.goal))}${field("stage", badge(d.assessmentStage))}${field("coverage", badge(snapshot.data.coverage))}</div><p>${esc(contract.data.scope.startMessageId)} → ${esc(contract.data.scope.endMessageId)}</p><small>${esc(report.id)} · r${report.revision} · ${esc(report.createdAt)}</small><p>${button("export", "export")}</p></section><section><h2>${esc(t("findings"))}</h2>${d.findings
				.map(
					(f, index) =>
						`<article><h3>${esc(f.ruleId)} · ${esc(f.conditionId ?? f.findingId)}</h3>${badge(f.verdict)}${badge(f.evidenceState)}<p><b>${esc(t("reason"))}</b> · ${esc(f.reason)}</p>${f.missingEvidence.length ? `<p><b>${esc(t("missing"))}</b> · ${esc(f.missingEvidence.join("; "))}</p>` : ""}<div class="actions">${f.evidenceRefs.map((_, j) => button("evidence", "evidence", `data-finding="${index}" data-evidence="${j}"`)).join("") || `<p>${esc(t("noEvidence"))}</p>`}</div><details><summary>${esc(t("reviews"))}</summary><p>${esc(t("reviewHint"))}</p><p>${esc(t("original"))}: ${esc(t(f.verdict))}</p>${
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
				)}<div class="actions">${findingsOffset ? button("findings-first", "first") : ""}${report.pages.findings?.nextOffset != null ? button("findings-next", "next") : ""}</div></section>${evidence ? `<section tabindex="-1" data-evidence-panel><h2>${esc(t("evidence"))}</h2><p>${esc(evidence.record.data.sourceLocator)}</p><p>${esc(evidence.record.data.sourceEventId)} · ${esc(evidence.record.data.origin)} · ${esc(evidence.record.data.availability)}</p><pre>${esc(evidence.text)}</pre>${evidence.nextOffset != null ? button("evidence-next", "next") : ""}</section>` : ""}<section><h2>${esc(t("config"))}</h2><p>${esc(t("costHint"))}</p><p>${esc(t("version"))}: ${esc(d.profileVersion)}</p><details><summary>${esc(t("raw"))}</summary><pre>${esc(JSON.stringify({ configuration: d.configuration, job: d.job, evaluatorVersions: d.evaluatorVersions }, null, 2))}</pre></details><h3>${esc(t("gaps"))}</h3><pre>${esc(snapshot.data.gaps.join("\n"))}</pre></section>`;
		}
		async function run(fn, { preserve = false } = {}) {
			const generation = rpc.generation;
			busy = true;
			error = "";
			notice = "";
			if (!preserve) render();
			else
				root.querySelectorAll("button").forEach((b) => {
					b.disabled = true;
				});
			try {
				await fn();
			} catch (e) {
				if (e.stale || generation !== rpc.generation || closed) return;
				error = `${e.code ? `${e.code} · ` : ""}${e.message}`;
				if (preserve) {
					const alert = root.querySelector("[role=alert]");
					alert.textContent = error;
					alert.focus();
					root.querySelectorAll("button").forEach((b) => {
						b.disabled = false;
					});
					busy = false;
					return;
				}
			} finally {
				if (generation === rpc.generation) busy = false;
			}
			if (generation === rpc.generation && !closed) render();
		}
		async function list(cursor) {
			page = await rpc.request("list", { kind: "evaluations", limit: 20, ...(cursor ? { cursor } : {}) });
		}
		async function refresh() {
			rpc.select({});
			source = undefined;
			job = undefined;
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
			reviews = reviewRows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
			findingsOffset = offset;
			evidence = undefined;
			view = "detail";
		}
		async function status() {
			job = await rpc.request("status", { jobId: job.jobId });
			if (job.reportRef) await open(job.reportRef);
		}
		async function readEvidence(reference, offset = 0) {
			const record = await rpc.request("get", { ref: reference });
			const body = await rpc.request("readEvidence", { ref: reference, offset });
			evidence = { record, ...body };
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
				rpc.select(source ? { conversationId: source.conversationId, sessionId: source.sessionId } : {});
				view = "records";
				busy = false;
				void run(() => list());
				return;
			}
			if (action === "new") {
				view = "new";
				error = "";
				notice = "";
				render();
				root.querySelector("textarea")?.focus();
				return;
			}
			void run(async () => {
				if (action === "first" || action === "next") await list(action === "next" ? page.nextCursor : undefined);
				if (action === "open") await open(ref(page.items[Number(target.dataset.index)]));
				if (action === "findings-first" || action === "findings-next")
					await open(ref(report), action === "findings-next" ? report.pages.findings.nextOffset : 0);
				if (action === "status") await status();
				if (action === "cancel") {
					job = await rpc.request("cancel", { jobId: job.jobId });
					if (job.reportRef) await open(job.reportRef);
				}
				if (action === "evidence")
					await readEvidence(
						report.data.findings[Number(target.dataset.finding)].evidenceRefs[Number(target.dataset.evidence)],
					);
				if (action === "evidence-next") await readEvidence(ref(evidence.record), evidence.nextOffset);
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
				if (action.startsWith("evidence") && !closed) root.querySelector("[data-evidence-panel]")?.focus();
			});
		});
		root.addEventListener("submit", (event) => {
			const form = event.target.closest("form");
			if (!form || busy) return;
			event.preventDefault();
			const values = Object.fromEntries(new FormData(form));
			void run(
				async () => {
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
					const fingerprint = JSON.stringify([source.sessionId, values]);
					if (draft?.fingerprint !== fingerprint) draft = { fingerprint, results: new Map() };
					const steps = draft.results;
					const step = async (action, data) => {
						if (!steps.has(action)) steps.set(action, await rpc.request(action, data));
						return steps.get(action);
					};
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
			);
		});
		const languageObserver = new MutationObserver(() => {
			t = translator(document.documentElement.lang || "zh");
			if (view !== "new" && !root.querySelector("textarea:focus")) render();
		});
		languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
		void refresh();
		return () => {
			closed = true;
			rpc.close();
			languageObserver.disconnect();
			root.remove();
		};
	},
};
