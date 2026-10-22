import { apiTestRuntime } from "./lib/api-test-runtime.mjs";
/** Host target/relay acceptance; real plugin/MCP/Newman, explicit review stub, synthetic data. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import {
	mkdtempSync,
	mkdirSync,
	cpSync,
	symlinkSync,
	writeFileSync,
	readFileSync,
	rmSync,
	chmodSync,
	readdirSync,
	lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PluginManager } from "../server/plugins.ts";
import { ClientSession } from "../server/agent/agent-service.ts";
import { ApiTestingRunner } from "../server/api-testing-runner.ts";
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtime = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? apiTestRuntime());
const output = mkdtempSync(join(tmpdir(), "api-testing-target-"));
const checks = [],
	hits = [],
	opened = new Map(),
	harnesses = [],
	servers = [];
const summary = {
	scope: "host-configured manual HTTP target, real plugin/MCP/Newman; explicit review stub; no business requests",
	output,
	checks,
};
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const sha = (x) => createHash("sha256").update(x).digest("hex");
const check = (name, evidence) => {
	checks.push({ name, status: "passed", evidence });
	save();
};
const save = () => writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2));
const listen = async (s) => {
	servers.push(s);
	await new Promise((ok, fail) => {
		s.once("error", fail);
		s.listen(0, "127.0.0.1", ok);
	});
	assert(s.address().port >= 8900);
	return `http://127.0.0.1:${s.address().port}`;
};
const until = async (fn) => {
	const end = Date.now() + 10000;
	while (!fn()) {
		if (Date.now() > end) throw new Error("Own fixture condition timed out");
		await new Promise((ok) => setTimeout(ok, 10));
	}
};
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
const closed = async (origin) => {
	const s = connect(new URL(origin).port, "127.0.0.1");
	await new Promise((ok, fail) => {
		s.once("error", (e) => {
			assert.equal(e.code, "ECONNREFUSED");
			ok();
		});
		s.once("connect", () => {
			s.destroy();
			fail(new Error("Owned relay still accepts connections"));
		});
	});
};
async function boot(name, origin, credential) {
	const base = join(output, name),
		project = join(base, "project"),
		data = join(base, "data"),
		plugin = join(data, "plugins/api-testing");
	mkdirSync(project, { recursive: true });
	cpSync(join(repo, "plugins/api-testing"), plugin, { recursive: true, filter: (p) => !p.includes("node_modules") });
	symlinkSync(join(runtime, "node_modules"), join(plugin, "node_modules"), "dir");
	cpSync(join(repo, "tests/fixtures/api-testing-workflow/contract.json"), join(project, "source.json"));
	const h = {
		base,
		project,
		data,
		plugin,
		runner: new ApiTestingRunner(join(data, "api-testing/runs"), plugin, {
			origin,
			projectRoot: project,
			...(credential ? { tokenFile: join(base, "credential.json") } : {}),
		}),
	};
	if (credential) {
		h.tokenFile = join(base, "credential.json");
		h.writeCredential = (overrides) =>
			writeFileSync(
				h.tokenFile,
				JSON.stringify({
					token: credential,
					origin,
					projectRoot: project,
					expiresAt: new Date(Date.now() + 60000).toISOString(),
					...overrides,
				}),
				{ mode: 0o600 },
			);
		h.writeCredential();
	}
	h.manager = new PluginManager(data, project);
	h.manager.mcpCaller = (...a) => h.runner.call(...a);
	h.manager.apiScheduleProvider = (host) => h.runner.attachScheduler(host);
	h.manager.llmProvider = async (_id, req) => ({
		ok: true,
		model: "explicit-target-review-control-stub",
		text: JSON.stringify({ verdict: "pass", artifactHash: JSON.parse(req.prompt).artifactHash, findings: [] }),
	});
	h.conv = { id: "origin", cwd: project, session: {}, agentPreset: "standard", planMode: false, delegateMode: false };
	h.ctx = {
		clientId: "client",
		convs: new Map([["origin", h.conv]]),
		settingsSvc: { current: { disabledPlugins: [], disabledPluginTools: [] } },
		pluginToolsProvider: () => h.manager.getAgentTools(),
		goalReviewTurnOf: () => false,
	};
	h.identity = {
		clientId: "client",
		conversationId: "origin",
		cwd: project,
		pluginId: "api-testing",
		toolName: "api_test_execute",
	};
	h.invoke = async (params, signal) =>
		JSON.parse(
			(
				await ClientSession.prototype.enabledPluginToolDefs
					.call(h.ctx, "standard", "origin")[0]
					.execute("test", params, signal, undefined)
			).content[0].text,
		);
	h.state = (ref) => json(join(data, "api-testing/runs", ref, "run.json"));
	h.transport = (ref) => json(join(data, "api-testing/runs", ref, "transport.json"));
	h.pid = (ref) => Number(readFileSync(join(data, "api-testing/runs", ref, "pid")));
	harnesses.push(h);
	await h.manager.ensureLoaded();
	return h;
}
let serial = 0;
function approve(h, origin, path = "/ok", expected = 200, script) {
	const bundle = join(h.project, "bundle-" + ++serial);
	mkdirSync(bundle);
	const collection = {
		info: {
			name: "synthetic-hand-reviewed-target",
			schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
		},
		item: [
			{
				name: "target",
				request: { method: "GET", url: origin + path },
				event: [
					{
						listen: "test",
						script: {
							type: "text/javascript",
							exec: [script ?? `pm.test("explicit status",()=>pm.response.to.have.status(${expected}));`],
						},
					},
				],
			},
		],
	};
	const bytes = JSON.stringify(collection);
	writeFileSync(join(bundle, "collection.json"), bytes);
	writeFileSync(join(bundle, "manifest.json"), JSON.stringify({ schemaVersion: 1, collectionSha256: sha(bytes) }));
	writeFileSync(join(bundle, "review.json"), JSON.stringify({ verdict: "pass", artifactHash: sha(bytes) }));
	return {
		ref: h.runner.approveFixture({ identity: h.identity, bundleRoot: bundle, fixtureOrigin: origin }),
		bundle,
		hash: sha(bytes),
	};
}
try {
	const deniedOrigin = await listen(
		createServer((req, res) => {
			hits.push({ target: "denied", url: req.url });
			res.end("unexpected");
		}),
	);
	const origin = await listen(
		createServer((req, res) => {
			hits.push({ target: "allowed", url: req.url, host: req.headers.host });
			opened.set(req.url, req.socket);
			req.socket.once("close", () => opened.delete(req.url));
			if (req.url.startsWith("/hold")) return;
			res.setHeader("content-type", "application/json");
			if (req.url === "/redirect") res.writeHead(302, { Location: deniedOrigin + "/escape" });
			res.end('{"id":"r-2","ok":true}');
		}),
	);
	const h = await boot("a", origin);
	for (const bad of [
		"https://192.0.2.1",
		"http://example.invalid",
		"http://user:secret@192.0.2.1",
		"http://192.0.2.1/path",
	])
		assert.throws(
			() => new ApiTestingRunner(h.data, h.plugin, { origin: bad, projectRoot: h.project }),
			/target requires/,
		);
	check("non-HTTP-DNS-credentials-and-path-configs-rejected");
	const before = hits.length;
	await assert.rejects(
		() => h.invoke({ action: "prepare", baseUrl: "http://192.0.2.1:8238", cases: [{}] }),
		/not configured/,
	);
	const prepared = approve(h, origin);
	assert.throws(
		() =>
			h.runner.approveFixture({
				identity: { ...h.identity, cwd: output },
				bundleRoot: prepared.bundle,
				fixtureOrigin: origin,
			}),
		/another project/,
	);
	assert.equal(hits.length, before);
	check("model-cannot-select-target-or-borrow-another-project-binding");
	const result = await h.invoke({ runRef: prepared.ref });
	assert.equal(result.executionVerdict, "passed");
	assert.equal(result.scope, "configured-http-target");
	const transport = h.transport(prepared.ref),
		input = json(join(h.data, "api-testing/runs", prepared.ref, "input.json"));
	assert.equal(transport.logicalOrigin, origin);
	assert.equal(transport.approvedCollectionHash, prepared.hash);
	assert.equal(transport.effectiveCollectionHash, sha(JSON.stringify(input.collection)));
	assert.equal(sha(readFileSync(join(prepared.bundle, "collection.json"))), prepared.hash);
	assert.notEqual(transport.transportOrigin, origin);
	assert.equal(input.collection.item[0].request.url, transport.transportOrigin + "/ok");
	assert.equal(hits.at(-1).host, new URL(origin).host);
	assert.equal(h.state(prepared.ref).targetOrigin, origin);
	assert(!alive(h.pid(prepared.ref)));
	await closed(transport.transportOrigin);
	check("real-host-relay-preserves-approval-hash-Host-and-durable-transport-map", { runId: prepared.ref, transport });
	const failed = approve(h, origin, "/ok", 201);
	assert.equal((await h.invoke({ runRef: failed.ref })).executionVerdict, "failed");
	await closed(h.transport(failed.ref).transportOrigin);
	check("configured-target-keeps-real-assertion-failure");
	const redirected = approve(h, origin, "/redirect");
	await assert.rejects(() => h.invoke({ runRef: redirected.ref }));
	assert.equal(h.state(redirected.ref).executionVerdict, "unknown");
	assert(!hits.some((r) => r.target === "denied"));
	await closed(h.transport(redirected.ref).transportOrigin);
	await assert.rejects(() => h.invoke({ runRef: redirected.ref }), /already attempted/);
	check("cross-origin-redirect-denied-with-unknown-no-resend-and-relay-closed");
	const b = await boot("b", origin),
		aHold = approve(h, origin, "/hold-a"),
		bHold = approve(b, origin, "/hold-b"),
		ac = new AbortController(),
		bc = new AbortController();
	const ar = h.invoke({ runRef: aHold.ref }, ac.signal).then(
			() => null,
			(e) => e,
		),
		br = b.invoke({ runRef: bHold.ref }, bc.signal).then(
			() => null,
			(e) => e,
		);
	await until(() => opened.has("/hold-a") && opened.has("/hold-b"));
	ac.abort();
	assert(await ar);
	await until(() => !opened.has("/hold-a"));
	assert(opened.has("/hold-b"));
	assert(alive(b.pid(bHold.ref)));
	assert.equal(h.state(aHold.ref).executionVerdict, "unknown");
	await closed(h.transport(aHold.ref).transportOrigin);
	bc.abort();
	assert(await br);
	await until(() => !opened.has("/hold-b"));
	await closed(b.transport(bHold.ref).transportOrigin);
	assert.equal(hits.filter((r) => r.url === "/hold-a").length, 1);
	check("cancel-closes-own-relay-and-upstream-without-killing-other-run");
	const revoked = approve(h, origin, "/hold-revoked"),
		pending = h.invoke({ runRef: revoked.ref }).then(
			() => null,
			(e) => e,
		);
	await until(() => opened.has("/hold-revoked"));
	h.conv.planMode = true;
	assert(await pending);
	h.conv.planMode = false;
	await until(() => !opened.has("/hold-revoked"));
	assert.equal(h.state(revoked.ref).executionVerdict, "unknown");
	await closed(h.transport(revoked.ref).transportOrigin);
	check("live-mode-revocation-reaps-MCP-and-relay");
	const workflow = await h.invoke({
		action: "prepare",
		sourcePath: "source.json",
		operationIds: ["getRecord"],
		baseUrl: origin,
		outputPath: "draft",
		cases: [
			{
				id: "record",
				operationId: "getRecord",
				request: { path: { id: "r-2" } },
				status: 200,
				checks: [{ kind: "type", pointer: "/id", value: "string" }],
			},
		],
	});
	const approved = await h.invoke({ action: "review", runRef: workflow.workflowRef });
	assert.equal(approved.phase, "approved");
	assert.equal((await h.invoke({ action: "asset_run", assetRef: approved.assetRef })).executionVerdict, "passed");
	check("configured-origin-main-workflow-independent-review-control-and-asset-run");
	const schedulesBefore = h.manager.bgTasks().length;
	await assert.rejects(
		() =>
			h.invoke({
				action: "schedule_create",
				assetRef: approved.assetRef,
				intervalMs: 60000,
				authorizationExpiresAt: new Date(Date.now() + 3600000).toISOString(),
			}),
		/not authorized/,
	);
	assert.equal(h.manager.bgTasks().length, schedulesBefore);
	check("configured-target-cannot-enable-unattended-schedule-even-when-loopback");
	await h.runner.dispose();
	h.runner = new ApiTestingRunner(join(h.data, "api-testing/runs"), h.plugin, {
		origin: deniedOrigin,
		projectRoot: h.project,
	});
	await assert.rejects(
		() => h.invoke({ action: "asset_inspect", assetRef: approved.assetRef }),
		/policy|approval|changed/i,
	);
	check("changed-host-target-invalidates-persistent-asset-approval");
	const canaries = ["aqa-token-" + randomUUID(), "aqa-token-" + randomUUID()];
	let expectedToken = canaries[0];
	const authOrigin = await listen(
		createServer((req, res) => {
			hits.push({ target: "authenticated-synthetic", url: req.url, matched: req.headers.token === expectedToken });
			opened.set(req.url, req.socket);
			req.socket.once("close", () => opened.delete(req.url));
			if (req.url === "/hold-token") return;
			res.setHeader("content-type", "application/json");
			if (req.url === "/reflect-redirect")
				res.writeHead(302, { Location: `http://${req.headers.token}.invalid/blocked` });
			else if (req.headers.token !== expectedToken) res.statusCode = 401;
			res.end(JSON.stringify({ id: "r-2", echo: req.url === "/echo" ? req.headers.token : "public" }));
		}),
	);
	const auth = await boot("credential", authOrigin, canaries[0]);
	let secured = approve(auth, authOrigin, "/requires-token");
	assert.equal((await auth.invoke({ runRef: secured.ref })).executionVerdict, "passed");
	assert.equal(json(join(auth.data, "api-testing/runs", secured.ref, "result.json")).credentialUsed, true);
	check("dedicated-token-injected-over-private-MCP-only");
	const initialHits = hits.length;
	for (const bad of [
		{ expiresAt: new Date(0).toISOString() },
		{ projectRoot: output },
		{ origin: deniedOrigin },
		{ token: "bad\ntoken" },
	]) {
		auth.writeCredential(bad);
		const p = approve(auth, authOrigin);
		await assert.rejects(() => auth.invoke({ runRef: p.ref }), /credential/);
	}
	auth.writeCredential();
	chmodSync(auth.tokenFile, 0o644);
	await assert.rejects(() => auth.invoke({ runRef: approve(auth, authOrigin).ref }), /credential/);
	chmodSync(auth.tokenFile, 0o600);
	writeFileSync(auth.tokenFile, '{"token":"' + canaries[0]);
	await assert.rejects(
		() => auth.invoke({ runRef: approve(auth, authOrigin).ref }),
		(e) => {
			assert(!String(e).includes(canaries[0]));
			return /credential/.test(String(e));
		},
	);
	assert.equal(hits.length, initialHits);
	check("expired-mismatched-unsafe-or-malformed-reference-never-sends-and-errors-are-redacted");
	auth.writeCredential();
	const echoed = approve(
		auth,
		authOrigin,
		"/echo",
		200,
		'pm.test("redacted failure",()=>pm.expect(pm.response.json().echo).to.eql("public-marker"));',
	);
	assert.equal((await auth.invoke({ runRef: echoed.ref })).executionVerdict, "failed");
	check("reflected-token-assertion-error-preserves-failure-without-raw-values");
	auth.writeCredential();
	const reflected = approve(auth, authOrigin, "/reflect-redirect");
	await assert.rejects(() => auth.invoke({ runRef: reflected.ref }));
	assert.equal(auth.state(reflected.ref).executionVerdict, "unknown");
	await closed(auth.transport(reflected.ref).transportOrigin);
	check("reflected-token-in-rejected-redirect-host-is-not-logged-or-forwarded");
	auth.writeCredential({ expiresAt: new Date(Date.now() + 600).toISOString() });
	const expiring = approve(auth, authOrigin);
	await assert.rejects(() => auth.invoke({ runRef: expiring.ref }));
	assert.equal(auth.state(expiring.ref).executionVerdict, "unknown");
	check("credential-lease-expiry-cancels-pending-run");
	auth.writeCredential();
	const revokedToken = approve(auth, authOrigin, "/hold-token"),
		pendingToken = auth.invoke({ runRef: revokedToken.ref }).then(
			() => null,
			(e) => e,
		);
	await until(() => opened.has("/hold-token"));
	rmSync(auth.tokenFile);
	assert(await pendingToken);
	await until(() => !opened.has("/hold-token"));
	await closed(auth.transport(revokedToken.ref).transportOrigin);
	assert.equal(auth.state(revokedToken.ref).executionVerdict, "unknown");
	check("credential-removal-revokes-active-relay-and-MCP-without-retry");
	expectedToken = canaries[1];
	auth.writeCredential({ token: expectedToken });
	secured = approve(auth, authOrigin, "/requires-token");
	assert.equal((await auth.invoke({ runRef: secured.ref })).executionVerdict, "passed");
	check("next-explicit-run-uses-rotated-reference-value");
	let promptChecks = 0;
	auth.manager.llmProvider = async (_id, req) => {
		assert(!canaries.some((c) => req.prompt.includes(c)));
		promptChecks++;
		return {
			ok: true,
			model: "explicit-credential-review-control-stub",
			text: JSON.stringify({ verdict: "pass", artifactHash: JSON.parse(req.prompt).artifactHash, findings: [] }),
		};
	};
	const authDraft = await auth.invoke({
		action: "prepare",
		sourcePath: "source.json",
		operationIds: ["getRecord"],
		baseUrl: authOrigin,
		outputPath: "auth-draft",
		cases: [
			{
				id: "record",
				operationId: "getRecord",
				request: { path: { id: "r-2" } },
				status: 200,
				checks: [{ kind: "type", pointer: "/id", value: "string" }],
			},
		],
	});
	const authApproved = await auth.invoke({ action: "review", runRef: authDraft.workflowRef });
	assert.equal(
		(await auth.invoke({ action: "asset_run", assetRef: authApproved.assetRef })).executionVerdict,
		"passed",
	);
	assert.equal(promptChecks, 1);
	check("credential-stays-out-of-independent-review-input-and-persisted-workflow");
	let scannedFiles = 0;
	const scan = (dir) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name),
				info = lstatSync(path);
			if (info.isSymbolicLink() || path === auth.tokenFile) continue;
			if (info.isDirectory()) scan(path);
			else {
				const text = readFileSync(path).toString("utf8").toLowerCase();
				assert(
					!canaries.some((c) => text.includes(c.toLowerCase())),
					"Runtime token leaked outside dedicated reference",
				);
				scannedFiles++;
			}
		}
	};
	scan(output);
	check("collections-inputs-reports-network-diagnostics-and-runtime-snapshots-contain-no-token", {
		scannedFiles,
		excluded: "dedicated synthetic reference only",
	});
	if (process.argv.includes("--public-docs")) {
		const docs = await boot("docs", "http://192.168.90.224:18168"),
			p = approve(docs, "http://192.168.90.224:18168", "/doc.html");
		const r = await docs.invoke({ runRef: p.ref });
		assert.equal(r.executionVerdict, "passed");
		assert.equal(r.scope, "configured-http-target");
		await closed(docs.transport(p.ref).transportOrigin);
		check("configured-host-real-MCP-read-only-public-Swagger-page", { runId: p.ref });
	}
	summary.status = "passed-configured-target-transport-only";
	summary.hits = hits;
	summary.publicDocsRequested = process.argv.includes("--public-docs");
} catch (e) {
	summary.status = "failed";
	summary.error = e.stack;
	process.exitCode = 1;
} finally {
	for (const h of harnesses) {
		h.manager.dispose();
		await h.runner.dispose();
	}
	for (const s of servers) {
		s.closeAllConnections();
		await new Promise((ok) => s.close(ok));
	}
	summary.finishedAt = new Date().toISOString();
	save();
	console.log(JSON.stringify(summary, null, 2));
}
