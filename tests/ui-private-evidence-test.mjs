/** U02 privacy regression against the native diagnostic capture; synthetic cookie only. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yauzl from "yauzl";
import { RuntimeAdmissionService, UiRunService, collectResults, sha256, traceEvidence } from "pi-ui-testing";
import { prepareDiagnostic, validCode } from "./fixtures/data-space/ui-design-fixture.mjs";
import { artifact } from "./fixtures/data-space/ui-artifacts.mjs";

const output = new URL("./scratch/ui-private-evidence/" + Date.now() + "/", import.meta.url);
await mkdir(output, { recursive: true });
const privateDir = await mkdtemp(join(tmpdir(), "u02-private-evidence-"));
const privatePath = join(privateDir, "state.json");
const reference = "PI_UI_U02_CAPTURE_AUTH";
assert.equal(process.env[reference], undefined, "Do not overwrite an existing private reference");
const secret = "synthetic+/" + randomBytes(24).toString("base64");
const cleanup = [],
	result = { status: "FAIL", actualModelCalls: 0, businessRequests: 0, leaks: [], checks: [] };
const containsPrivate = (bytes) =>
	[
		secret,
		privatePath,
		encodeURI(secret),
		encodeURI(privatePath),
		encodeURIComponent(secret),
		encodeURIComponent(privatePath),
		Buffer.from(secret).toString("base64"),
		Buffer.from(secret).toString("base64url"),
	].some((value) => bytes.includes(Buffer.from(value)));
async function inspectZip(bytes, name) {
	const archive = await new Promise((resolve, reject) =>
		yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => (error ? reject(error) : resolve(zip))),
	);
	await new Promise((resolve, reject) => {
		archive.on("error", reject);
		archive.on("end", resolve);
		archive.on("entry", (entry) => {
			assert.doesNotMatch(entry.fileName, /^resources\//, "Private binary resources must not be published");
			if (entry.fileName.endsWith("/")) return archive.readEntry();
			archive.openReadStream(entry, (error, stream) => {
				if (error) return reject(error);
				const chunks = [];
				stream.on("error", reject);
				stream.on("data", (chunk) => chunks.push(chunk));
				stream.on("end", () => {
					if (containsPrivate(Buffer.concat(chunks))) result.leaks.push(name + "!" + entry.fileName);
					archive.readEntry();
				});
			});
		});
		archive.readEntry();
	});
}
async function inspect(directory, relative = "qa") {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name),
			name = relative + "/" + entry.name;
		if (entry.isDirectory()) await inspect(path, name);
		else if (entry.isFile()) {
			assert.doesNotMatch(entry.name, /\.(png|jpe?g|webm)$/, "Public capture must not contain private images/video");
			const bytes = await readFile(path);
			if (containsPrivate(bytes)) result.leaks.push(name);
			if (entry.name.endsWith(".zip")) await inspectZip(bytes, name);
			if (entry.name.endsWith(".json")) {
				const inspectBodies = (value) => {
					if (!value || typeof value !== "object") return;
					if (value.contentType && typeof value.body === "string" && containsPrivate(Buffer.from(value.body, "base64")))
						result.leaks.push(name + "!attachment-body");
					for (const child of Object.values(value)) inspectBodies(child);
				};
				inspectBodies(JSON.parse(bytes.toString()));
			}
		}
	}
}
try {
	await writeFile(
		privatePath,
		JSON.stringify({
			cookies: [
				{
					name: "qa_private",
					value: secret,
					domain: "127.0.0.1",
					path: "/",
					expires: -1,
					httpOnly: true,
					secure: false,
					sameSite: "Lax",
				},
			],
			origins: [],
		}),
		{ mode: 0o600 },
	);
	process.env[reference] = privatePath;
	const code = validCode
		.replace("test.use({storageState:{cookies:[],origins:[]}});", "")
		.replace(
			"await page.goto('/');",
			`await page.goto('/');
 const cookie=(await page.context().cookies()).find(c=>c.name==='qa_private');
 expect(cookie).toBeTruthy();
 console.log(cookie.value,encodeURIComponent(cookie.value),Buffer.from(cookie.value).toString('base64'));
 console.log(process.env.PI_UI_U02_CAPTURE_AUTH,encodeURI(process.env.PI_UI_U02_CAPTURE_AUTH));
 await page.evaluate(value=>{const p=document.createElement('p');p.textContent=value;document.body.appendChild(p);},cookie.value);`,
		)
		.replace(
			"await page.reload();",
			"await page.reload();await page.evaluate(value=>{const p=document.createElement('p');p.textContent=value;document.body.appendChild(p);},cookie.value);",
		);
	const d = await prepareDiagnostic(
		{ after: (fn) => cleanup.push(fn) },
		{ testCode: code, auth: { kind: "storage-state-env", reference } },
	);
	result.workspace = d.f.root;
	const diagnostic = await new RuntimeAdmissionService(d.f.root, d.f.authority).diagnose(
		d.assetRef,
		d.reviewed.review_ref,
		d.specRef,
		"private-evidence",
	);
	result.diagnostic = diagnostic;
	assert.equal(
		diagnostic.runtime_ready,
		true,
		"Control diagnostics must run with the actual synthetic cookie before checking evidence",
	);
	result.checks.push("Native positive and negative diagnostics consume the synthetic private cookie");
	const original = await d.f.store.load(d.f.taskRef);
	await d.f.store.put(
		artifact(
			"task",
			{
				...original.data,
				intent: "execute",
				stage: "execute",
				completed_stages: ["design-review"],
				input_sha256: sha256("private formal evidence"),
				asset_refs: [d.assetRef],
				run_ids: [],
			},
			"private-formal-task",
		),
	);
	const service = new UiRunService(d.f.root, d.f.authority);
	const request = {
		task_id: "private-formal-task",
		request_id: "private-pass",
		asset_ref: d.assetRef,
		review_ref: d.reviewed.review_ref,
		environment_ref: d.spec.environment_ref,
		config_ref: d.config,
		timeout_ms: 15000,
	};
	const passed = await service.start(request);
	const passedResults = await collectResults(d.f.root, passed.run_ref, "private-pass-results");
	assert.equal(passedResults.data.counts.passed, 1);
	assert.equal(passedResults.details.complete, true);
	result.checks.push("Authenticated passing run preserves its passed result and complete non-visual evidence");
	d.f.fixture.state.discardPersistence = true;
	const failed = await service.start({ ...request, request_id: "private-failure" });
	const failedResults = await collectResults(d.f.root, failed.run_ref, "private-failure-results");
	assert.equal(failedResults.data.counts.failed, 1, "Privacy filtering must retain the product assertion failure");
	assert.equal(
		failedResults.details.complete,
		false,
		"Withheld visual resources cannot be advertised as complete public evidence",
	);
	result.checks.push("Authenticated failing run remains failed and publicly incomplete");
	const trace = failed.run.data.output_refs.find((ref) => ref.path.endsWith("/trace.zip"));
	assert.ok(trace, "Public redacted trace retains action evidence");
	const events = await traceEvidence(d.f.root, failedResults.results_ref, trace);
	assert.equal(events.privacy.redacted, true);
	assert.ok(events.events.length > 0);
	assert.equal(containsPrivate(Buffer.from(JSON.stringify(events))), false);
	result.checks.push("Native trace analysis retains redacted action evidence and explicit privacy limitations");
	const privateCaptures = await readdir(join(d.f.authority, "private-evidence"));
	assert.equal(privateCaptures.length, 4, "Two diagnostic captures and two formal captures remain private");
	for (const name of privateCaptures)
		assert.equal((await stat(join(d.f.authority, "private-evidence", name))).mode & 0o777, 0o700);
	for (const name of privateCaptures) {
		const raw = JSON.parse(await readFile(join(d.f.authority, "private-evidence", name, "process.json"), "utf8"));
		assert.equal(raw.stdout.includes(secret), true, "The private original must retain the actual reflected secret");
	}
	const privateImages = [];
	async function findPrivateImages(path) {
		for (const entry of await readdir(path, { withFileTypes: true })) {
			const child = join(path, entry.name);
			if (entry.isDirectory()) await findPrivateImages(child);
			else if (entry.name.endsWith(".png")) privateImages.push(child);
		}
	}
	await findPrivateImages(join(d.f.authority, "private-evidence"));
	assert.equal(
		privateImages.length,
		1,
		"The formal failure screenshot must remain in the private capture; diagnostics use trace only",
	);
	result.checks.push("Four private captures use mode 0700 and retain actual failure screenshots outside the workspace");
	result.formal = {
		passed: passed.run_ref,
		failed: failed.run_ref,
		failedCounts: failedResults.data.counts,
		failedEvidenceComplete: failedResults.details.complete,
		privateCaptureCount: privateCaptures.length,
	};
	await inspect(join(d.f.root, "qa"));
	assert.equal(containsPrivate(Buffer.from(JSON.stringify(diagnostic))), false, "Tool receipt contains private data");
	assert.equal(result.leaks.length, 0, "Private values or paths reached public evidence; see the saved file names");
	result.checks.push(
		"Public files, decoded attachment bodies and uncompressed ZIP entries contain no supported secret/path forms or media",
	);
	result.status = "PASS";
} catch (error) {
	result.error = error.message;
	process.exitCode = 1;
} finally {
	delete process.env[reference];
	for (const close of cleanup.reverse()) await close();
	await rm(privateDir, { recursive: true, force: true });
	await writeFile(new URL("result.json", output), JSON.stringify(result, null, 2) + "\n");
	console.log(JSON.stringify({ ...result, evidence: output.pathname }, null, 2));
}
