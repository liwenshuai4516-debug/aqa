// Draft serializer/rendering adapter; no access to the real PMS origin.
// Mutations are triggered only by actual independent form state, never by case IDs.
const settings = await fetch("/fixture-settings.json").then((response) => response.json());
const byId = (id) => document.getElementById(id);
const mutations = new Set(settings.mutations);
const enabled = (mutation) => mutations.has(mutation);
const selected = { department: "", node: "", type: "" };
const optionSets = {
	department: [
		{ label: "全部", value: "" },
		{ label: settings.department.label, value: settings.department.id },
	],
	node: [{ label: "全部", value: "" }, ...settings.nodeOptions.map((value) => ({ label: value, value }))],
	type: [{ label: "全部", value: "" }, ...settings.projectTypeOptions.map((value) => ({ label: value, value }))],
};
// The anonymous local copy returns only a synthetic profile; no token is read or written.
byId("fixture-account").textContent = settings.account;
byId("page-size").textContent = `${settings.pageSize}条/页`;

function closeOptions() {
	byId("options").hidden = true;
	for (const key of Object.keys(selected))
		byId(key).querySelector("[role=combobox]").setAttribute("aria-expanded", "false");
}
for (const key of Object.keys(selected)) {
	const combobox = byId(key).querySelector("[role=combobox]");
	function open() {
		closeOptions();
		byId("options").replaceChildren(
			...optionSets[key].map((option) => {
				const element = document.createElement("li");
				element.className = "el-select-dropdown__item";
				element.setAttribute("role", "option");
				element.setAttribute("aria-selected", String(selected[key] === option.value));
				element.textContent = option.label;
				element.onclick = (event) => {
					event.stopPropagation();
					selected[key] = option.value;
					combobox.textContent = option.label;
					closeOptions();
				};
				return element;
			}),
		);
		byId("options").hidden = false;
		combobox.setAttribute("aria-expanded", "true");
	}
	combobox.onclick = open;
	combobox.onkeydown = (event) => {
		if (["Enter", "ArrowDown", " "].includes(event.key)) {
			event.preventDefault();
			open();
		}
	};
}
byId("expand").onclick = () => {
	byId("advanced").hidden = !byId("advanced").hidden;
	byId("expand").textContent = byId("advanced").hidden ? "展开" : "收起";
	byId("expand").setAttribute("aria-expanded", String(!byId("advanced").hidden));
};
function message(text) {
	byId("message").querySelector("p").textContent = text;
	byId("message").hidden = false;
}
function queryParams() {
	const params = new URLSearchParams({ pageNum: "1", pageSize: String(settings.pageSize) });
	const rawName = byId("name").value;
	const rawCode = byId("code").value;
	const name = rawName.trim();
	const code = rawCode.trim();
	if (name) params.set("bizName", enabled("name-untrimmed") ? rawName : name);
	if (code) params.set("bizCode", enabled("code-untrimmed") ? rawCode : code);
	if (enabled("whitespace-effective-filter") && rawName && rawCode && !name && !code)
		params.set("bizName", "CONTROLLED_WRONG_EFFECTIVE_FILTER");
	if (selected.department)
		params.set("departmentId", enabled("wrong-department-id") ? "CONTROLLED_WRONG_DEPARTMENT_ID" : selected.department);
	if (selected.node === "草稿") params.set("contractStatus", enabled("wrong-draft-status") ? "SIGNED" : "DRAFT");
	if (byId("start").value) params.set("signedAtStart", byId("start").value);
	if (byId("end").value) {
		const original = byId("end").value;
		const date = new Date(original + "T00:00:00Z");
		if (enabled("wrong-date-end") && Number.isFinite(date.getTime())) {
			date.setUTCDate(date.getUTCDate() + 1);
			params.set("signedAtEnd", date.toISOString().slice(0, 10));
		} else params.set("signedAtEnd", original);
	}
	return params;
}
async function refresh(params) {
	const response = await fetch(settings.queryEndpoint + "?" + params.toString());
	if (!response.ok) throw new Error("Controlled fixture GET failed");
	// Consume the actual response. Rows are rendered as text, never as HTML.
	const payload = await response.json();
	for (const number of document.querySelectorAll(".el-pager .number"))
		number.classList.toggle("is-active", number.textContent === String(payload.data.pageNum));
	const body = document.querySelector(".el-table__body tbody");
	body.replaceChildren(
		...payload.data.records.map((record) => {
			const row = document.createElement("tr");
			row.className = "el-table__row";
			for (const value of [
				record.bizName,
				record.bizCode,
				record.contractStatus === "DRAFT" ? "草稿" : record.contractStatus,
			]) {
				const cell = document.createElement("td");
				cell.textContent = value;
				row.append(cell);
			}
			return row;
		}),
	);
}
byId("query").onclick = async () => {
	closeOptions();
	byId("message").hidden = true;
	if (selected.type || (selected.node && selected.node !== "草稿")) {
		const corrupted = selected.type ? enabled("wrong-type-message") : enabled("wrong-node-message");
		message(corrupted ? "受控错误：不支持的筛选被错误接受" : settings.unsupportedMessage);
		return; // No list refresh; stable row structure and response timing preserved.
	}
	await refresh(queryParams());
};
byId("reset").onclick = async () => {
	closeOptions();
	byId("message").hidden = true;
	const retainedName = byId("name").value;
	for (const key of ["name", "code", "start", "end"]) byId(key).value = "";
	for (const key of Object.keys(selected)) {
		selected[key] = "";
		byId(key).querySelector("[role=combobox]").textContent = "全部";
	}
	if (enabled("reset-name-retained")) byId("name").value = retainedName;
	// Reset still makes a real 200 GET. Only one state defect is retained.
	const params = new URLSearchParams({ pageNum: "1", pageSize: String(settings.pageSize) });
	if (byId("name").value) params.set("bizName", byId("name").value.trim());
	await refresh(params);
};
for (const number of document.querySelectorAll(".el-pager .number")) {
	number.onclick = () =>
		refresh(new URLSearchParams({ pageNum: number.textContent, pageSize: String(settings.pageSize) }));
}
// Initial load never applies a mutation and finishes before user actions.
await refresh(new URLSearchParams({ pageNum: "1", pageSize: String(settings.pageSize) }));
document.documentElement.dataset.fixtureReady = "true";
