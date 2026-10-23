/** Controlled browser target; no credentials or live model configuration. */
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { optimizationPage } from "./ui-optimization-page.mjs";
export async function setupUiFixture({ discardPersistence = false, optimization = false } = {}) {
	const root = await mkdtemp(join(tmpdir(), "data-space-native-ui-")),
		project = join(root, "project"),
		agentDir = join(root, "agent");
	await mkdir(project);
	await mkdir(agentDir);
	const state = { browserRequests: 0 };
	const server = createServer((_req, res) => {
		state.browserRequests++;
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		if (optimization) return res.end(optimizationPage({ discardPersistence }));
		res.end(`<!doctype html><h1>Names</h1><form><label>Name <input required name="name"></label><button>Save</button></form><ul></ul><script>
 const list=document.querySelector('ul'),names=JSON.parse(localStorage.getItem('names')||'[]');
 function render(){list.replaceChildren(...names.map(name=>{const li=document.createElement('li');li.textContent=name;return li}));}
 document.querySelector('form').onsubmit=e=>{e.preventDefault();names.push(new FormData(e.target).get('name'));${discardPersistence ? "localStorage.removeItem('names')" : "localStorage.setItem('names',JSON.stringify(names))"};render();};render();</script>`);
	});
	await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
	if (server.address().port < 8900) throw new Error("Fixture port below isolated range");
	await symlink(fileURLToPath(new URL("../../../node_modules", import.meta.url)), join(project, "node_modules"), "dir");
	await writeFile(join(project, "package.json"), '{"type":"module"}');
	return {
		project,
		agentDir,
		url: `http://127.0.0.1:${server.address().port}`,
		state,
		async close() {
			server.closeAllConnections();
			await new Promise((ok) => server.close(ok));
		},
	};
}
