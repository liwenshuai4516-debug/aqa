import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname, relative, isAbsolute } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Source preparation only: importing this module never binds a socket.
// There is no proxy, upstream client, persistent store or business write endpoint.
export async function createFixtureServer(settingsPath) {
	const absolute = resolve(settingsPath);
	const rel = relative(here, absolute);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith("../"))
		throw new Error("Settings must stay in this claimed directory");
	const settings = JSON.parse(await readFile(absolute, "utf8"));
	if (
		settings.host !== "127.0.0.1" ||
		!Number.isInteger(settings.port) ||
		settings.port < 8900 ||
		settings.port > 65535
	)
		throw new Error("Loopback and port >=8900 required");
	if (
		settings.status !== "prepared-for-independent-review" ||
		!settings.currentSourceRefs?.length ||
		settings.department?.kind !== "controlled-synthetic" ||
		!settings.department?.label ||
		settings.department.label === "全部" ||
		!settings.department?.id ||
		!settings.unsupportedMessage
	)
		throw new Error("Unresolved source/data/settings: draft must not start");
	if (settings.basePath !== "/pms/OperationContract" || !settings.queryEndpoint?.startsWith("/api/"))
		throw new Error("Unexpected route");
	const html = await readFile(new URL("./fixture.html", import.meta.url), "utf8");
	const client = await readFile(new URL("./fixture-client.mjs", import.meta.url), "utf8");
	const publicSettings = JSON.stringify(settings).replaceAll("<", "\\u003c");
	const server = http.createServer((request, response) => {
		const headers = {
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"X-PMS-Diagnostic-Fixture": "r4-draft-controlled-error-copy",
			"Content-Security-Policy":
				"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
		};
		const send = (code, type, body) => {
			response.writeHead(code, { ...headers, "Content-Type": type });
			response.end(request.method === "HEAD" ? undefined : body);
		};
		if (!["GET", "HEAD"].includes(request.method)) {
			response.setHeader("Allow", "GET, HEAD");
			return send(405, "text/plain; charset=utf-8", "Read-only fixture");
		}
		// No request URL, headers, tokens or body are recorded.
		const url = new URL(request.url, `http://127.0.0.1:${settings.port}`);
		if (request.headers.host !== `127.0.0.1:${settings.port}`) return send(421, "text/plain", "Wrong fixture origin");
		if (url.pathname === settings.basePath || url.pathname === settings.basePath + "/")
			return send(200, "text/html; charset=utf-8", html);
		if (url.pathname === "/fixture-client.mjs") return send(200, "text/javascript; charset=utf-8", client);
		if (url.pathname === "/fixture-settings.json") return send(200, "application/json", publicSettings);
		if (url.pathname === "/api/base-service/account-profile")
			return send(
				200,
				"application/json",
				JSON.stringify({ code: 200, data: { username: settings.account }, diagnostic: "isolated-synthetic-profile" }),
			);
		if (url.pathname === settings.queryEndpoint) {
			// Synthetic rows only. Query mutation occurs in the client request serializer,
			// making the observed Response.request URL actually wrong, not a mocked oracle.
			return send(
				200,
				"application/json",
				JSON.stringify({
					code: 200,
					data: {
						records: [
							{ id: "fixture-row-1", bizName: "隔离只读合同", bizCode: "FIXTURE-001", contractStatus: "DRAFT" },
						],
						total: 1,
						pageNum: Number(url.searchParams.get("pageNum") || "1"),
						pageSize: settings.pageSize,
					},
				}),
			);
		}
		return send(404, "text/plain; charset=utf-8", "Unknown fixture route");
	});
	return { server, settings };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	if (process.argv[2] !== "--start-after-independent-approval" || !process.argv[3]) {
		throw new Error("Preparation only. Main session may start after approval with an explicit reviewed settings path.");
	}
	const { server, settings } = await createFixtureServer(process.argv[3]);
	server.listen(settings.port, settings.host, () => {
		console.log(
			`Controlled fixture started at http://${settings.host}:${settings.port}${settings.basePath}; pid=${process.pid}`,
		);
	});
	const close = () =>
		server.close((error) => {
			process.exitCode = error ? 1 : 0;
		});
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
}
