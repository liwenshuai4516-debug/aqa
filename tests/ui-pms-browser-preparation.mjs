/** Read-only preparation of the selected desktop project's temporary browser session.
 * No recording, business runner, model call, raw response/DOM capture or store write.
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, cp, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { authState, sha256 } from "pi-ui-testing";
import { CHROME_PATH } from "./lib/chrome.mjs";
import { preparePmsSession } from "./lib/pms-private-session.mjs";

assert.ok(process.argv.includes("--refresh"), "Explicit --refresh required for the configured login request");
const repo = fileURLToPath(new URL("..", import.meta.url));
const output = join(repo, "tests/scratch/ui-pms-browser-preparation", String(Date.now()));
await mkdir(output, { recursive: true });
for (const [source, name] of [
	[fileURLToPath(import.meta.url), "harness.mjs"],
	[join(repo, "tests/lib/pms-private-session.mjs"), "adapter.mjs"],
])
	await cp(source, join(output, name));
const systemId = "e2f5d42d-2781-4e68-a452-4c87c7d1d346",
	envId = "f46a32da-2eac-43ca-86b8-2fa5eca5385c";
const file = join(homedir(), "Library/Application Support/Pi Agent Desktop/data/data-space/store.json");
const before = await readFile(file),
	store = JSON.parse(before),
	env = store.envs.find((e) => e.id === envId && e.systemId === systemId);
assert.ok(env);
const target = new URL("/pms/OperationContract", env.baseUrl);
const plan = {
	systemId,
	envId,
	revision: store.revision,
	target: target.href,
	mode: "read-only-browser-preparation",
	responseCapture: false,
	screenshots: false,
	trace: false,
	allowedBrowserMethods: ["GET", "HEAD"],
	foreignRequests: "blocked",
	role: "unknown",
	data: "unknown",
	modelCalls: 0,
	formalTests: 0,
	nativeCaseImports: 0,
	dataSpaceStoreWrites: 0,
};
const sourceDeclarations = [];
for (const name of ["app", "auth", "permission", "login", "tenant"]) {
	const path = join(
		repo,
		"tests/scratch/ui-real-target-admission/source-only/qa/ui/scopes/public-source",
		name + ".js.json",
	);
	const source = JSON.parse(await readFile(path, "utf8"));
	sourceDeclarations.push({ name, url: source.url, sha256: source.sha256 });
	await cp(path, join(output, name + ".source.json"));
}
plan.publicSourceDeclarations = sourceDeclarations;
await writeFile(join(output, "plan.json"), JSON.stringify(plan, null, 2));
const result = {
	createdAt: new Date().toISOString(),
	status: "blocked",
	plan,
	browserLaunches: 0,
	contexts: [],
	limitations: [
		"Target-specific test harness, not installed Agent or Desktop tool integration",
		"GET/HEAD restriction may block application read APIs using POST",
		"No recording, approved asset or formal test execution",
		"Server account match does not establish business role or owned data readiness",
	],
};
let session, browser;
const privateValues = [];
try {
	session = await preparePmsSession({ store, systemId, envId, refresh: true });
	const state = await authState({ auth: session.auth });
	const privateState = JSON.parse(await readFile(state, "utf8"));
	privateValues.push(
		state,
		...privateState.origins.flatMap((origin) =>
			origin.localStorage.filter((item) => item.name === "token").map((item) => item.value),
		),
	);

	browser = await chromium.launch({ headless: true, ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}) });
	result.browserLaunches++;
	for (const authenticated of [true, false]) {
		const context = await browser.newContext({
			...(authenticated ? { storageState: state } : {}),
			serviceWorkers: "block",
			acceptDownloads: false,
		});
		const observation = {
			authenticatedReference: authenticated,
			browserErrors: 0,
			httpErrors: 0,
			permittedReadRequests: 0,
			blockedNonReadMethods: 0,
			publicSourceComparisons: [],
			blockedForeignRequests: 0,
		};
		result.contexts.push(observation);
		const sourceChecks = [];
		try {
			await context.route("**/*", async (route) => {
				const req = route.request(),
					url = new URL(req.url());
				if (url.origin !== target.origin) {
					observation.blockedForeignRequests++;
					return route.abort("blockedbyclient");
				}
				if (!["GET", "HEAD"].includes(req.method())) {
					observation.blockedNonReadMethods++;
					return route.abort("blockedbyclient");
				}
				observation.permittedReadRequests++;
				return route.continue();
			});
			const page = await context.newPage();
			page.on("pageerror", () => observation.browserErrors++);
			page.on("response", (response) => {
				if (response.status() >= 400) observation.httpErrors++;
				const declaration = sourceDeclarations.find((source) => source.url === response.url());
				if (declaration)
					sourceChecks.push(
						(async () => {
							try {
								const actual = sha256(await response.body());
								observation.publicSourceComparisons.push({
									name: declaration.name,
									expectedSha256: declaration.sha256,
									actualSha256: actual,
									matched: actual === declaration.sha256,
								});
							} catch {
								observation.publicSourceComparisons.push({
									name: declaration.name,
									matched: false,
									reason: "source-body-unavailable",
								});
							}
						})(),
					);
			});
			await page.goto(target.href, { waitUntil: "networkidle", timeout: 20000 });
			observation.atTargetRoute =
				new URL(page.url()).origin === target.origin && new URL(page.url()).pathname === target.pathname;
			observation.atLoginRoute = /\/(?:login|signin)(?:\/|$)/i.test(new URL(page.url()).pathname);
			observation.accessDeniedRoute = /\/(?:401|403)(?:\/|$)/.test(new URL(page.url()).pathname);
			// Only fixed public labels become evidence. No page text, records, personal names or errors are serialized.
			observation.publicControls = {};
			for (const label of ["查询", "搜索", "新增", "保存草稿", "登录", "经营合同"])
				observation.publicControls[label] = await page.getByText(label, { exact: true }).count();
			if (authenticated) {
				const expected = env.params.find((p) => p.key === "账号")?.value;
				observation.identityProbe = await page.evaluate(async (expectedAccount) => {
					let token = localStorage.getItem("token");
					try {
						const parsed = JSON.parse(token);
						if (typeof parsed === "string") token = parsed;
					} catch {
						/* Deployed reader also accepts raw token strings. */
					}
					if (!token) return { state: "not-ready", reason: "browser-token-absent" };
					try {
						const response = await fetch("/api/base-service/account-profile", {
							method: "GET",
							redirect: "error",
							headers: { token, "x-parent-client-code": "pms", "x-client-code": "pms" },
							signal: AbortSignal.timeout(10000),
						});
						const profile = await response.json();
						return {
							state:
								response.ok && profile.code === 200 && profile.data?.username === expectedAccount
									? "matched"
									: "not-ready",
							reason: "same-browser-profile-account-comparison",
						};
					} catch {
						return { state: "unknown", reason: "profile-request-failed" };
					}
				}, expected);
			}
			observation.status = "observed";
		} catch {
			observation.status = "blocked";
			observation.reason = "navigation-or-observation-failed";
		} finally {
			await Promise.all(sourceChecks);
			await context.close();
			observation.contextClosed = true;
		}
	}
	const [authenticated, anonymous] = result.contexts;
	result.preparation = session.receipt;
	result.status =
		authenticated.atTargetRoute && authenticated.identityProbe?.state === "matched" && anonymous.atLoginRoute
			? "browser-account-verified-role-data-pending"
			: "browser-admission-blocked";
} catch (error) {
	result.blocker = /^PMS private preparation blocked: [a-z-]+$/.test(error.message)
		? error.code
		: "browser-preparation-failed";
} finally {
	await browser?.close();
	result.browserClosed = !!browser;
	if (session) {
		const state = process.env[session.auth.reference];
		await session.dispose();
		await assert.rejects(access(state), { code: "ENOENT" });
		await assert.rejects(access(dirname(state)), { code: "ENOENT" });
		assert.equal(process.env[session.auth.reference], undefined);
		result.privateStateRemoved = true;
	}
	result.storeUnchanged = sha256(before) === sha256(await readFile(file));
	result.knownTokenAndPathAbsent = true;
	const serialized = JSON.stringify(result);
	assert.ok(
		privateValues.every((value) =>
			[value, encodeURIComponent(value), Buffer.from(value).toString("base64")].every(
				(secret) => !serialized.includes(secret),
			),
		),
		"Private evidence detected; public output suppressed",
	);
	result.harnessSha256 = sha256(await readFile(join(output, "harness.mjs")));
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify({ output, ...result }, null, 2));
assert.equal(result.storeUnchanged, true, "Selected Data Space changed concurrently; reconcile before continuing");

assert.equal(
	result.status,
	"browser-account-verified-role-data-pending",
	"Browser preparation blocked; see sanitized evidence",
);
