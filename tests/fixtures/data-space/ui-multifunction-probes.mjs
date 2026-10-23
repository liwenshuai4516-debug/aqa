/** Unapproved synthetic diagnostic mutations; never changes the frozen positive page. */
import { createServer } from "node:http";
import { optimizationPage } from "./ui-optimization-page.mjs";

// The case header isolates faults from non-target cases. It is not authentication.
export const probes = [
	["A-search-1", "C-search", "Ignore the submitted query", "query=new FormData(e.target).get('query')", "query=''"],
	["A-search-2", "C-search", "Reset leaves the active query", "onreset=()=>{query='';", "onreset=()=>{"],
	[
		"A-edit-1",
		"C-edit",
		"Cancel incorrectly persists the entered name",
		"$('#cancel').onclick=()=>$('dialog').close()",
		"$('#cancel').onclick=()=>{names.push($('[name=name]').value);localStorage.setItem('names',JSON.stringify(names));$('dialog').close()}",
	],
	[
		"A-edit-2",
		"C-edit",
		"Save loses persistence",
		"localStorage.setItem('names',JSON.stringify(names))",
		"localStorage.removeItem('names')",
	],
	["A-details-1", "C-details", "Selecting About leaves List selected", "String(name===id)", "String(name==='list')"],
	["A-details-2", "C-details", "Disclosure starts expanded", "<details>", "<details open>"],
	[
		"A-paging-1",
		"C-paging",
		"Page incorrectly shows three rows",
		"rows.slice(page*2,page*2+2)",
		"rows.slice(page*2,page*2+3)",
	],
	[
		"A-paging-2",
		"C-paging",
		"Next discards the active filter",
		"$('#next').onclick=()=>{page++;render()}",
		"$('#next').onclick=()=>{query='';page++;render()}",
	],
	[
		"A-permission-1",
		"C-permission",
		"Viewer is incorrectly shown Add",
		"$('#add').hidden=role!=='tester'",
		"$('#add').hidden=false",
	],
	[
		"A-permission-2",
		"C-permission",
		"Tester Add is incorrectly disabled",
		"$('#add').hidden=role!=='tester'",
		"$('#add').hidden=role!=='tester';$('#add').disabled=role==='tester'",
	],
	[
		"A-states-1",
		"C-states",
		"Loading state is replaced with an undeclared status",
		"textContent='Loading'",
		"textContent='Initializing'",
	],
	[
		"A-states-2",
		"C-states",
		"Empty results have the wrong status",
		"rows.length?'Ready':'Empty'",
		"rows.length?'Ready':'No matches'",
	],
	[
		"A-states-3",
		"C-states",
		"Failure has the wrong error status",
		"fail?'Error loading names'",
		"fail?'Unknown error'",
	],
].map(([assertionId, caseId, description, before, after]) => ({ assertionId, caseId, description, before, after }));

export function probePage(probeId, caseId) {
	const original = optimizationPage();
	if (probeId === "positive") return original;
	const probe = probes.find((item) => item.assertionId === probeId);
	if (!probe) throw new Error(`Unknown probe: ${probeId}`);
	if (caseId !== probe.caseId) return original;
	if (original.split(probe.before).length !== 2) throw new Error(`Mutation source changed: ${probeId}`);
	return original.replace(probe.before, probe.after);
}

export function createProbeServer(probeId) {
	probePage(probeId, ""); // Validate before opening a port.
	return createServer((request, response) => {
		if (request.method !== "GET" || new URL(request.url, "http://fixture").pathname !== "/") {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
		response.end(probePage(probeId, request.headers["x-u05-case"]));
	});
}
