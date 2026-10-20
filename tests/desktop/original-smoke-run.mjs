// Run the original aggregator with an independent fallback agent/data/DSH home.
// Individual tests can still create their own isolated fixtures and mock keys.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const fixture = mkdtempSync("/tmp/pi-smoke-isolated-");
for (const name of ["agent", "data", "dsh"]) mkdirSync(join(fixture, name));
writeFileSync(join(fixture, "agent", "auth.json"), "{}\n");
writeFileSync(join(fixture, "agent", "models.json"), '{"providers":{}}\n');
const env = {
	...process.env,
	PI_CODING_AGENT_DIR: join(fixture, "agent"),
	PI_WEB_DATA_DIR: join(fixture, "data"),
	DSH_HOME: join(fixture, "dsh"),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
};
const removedCredentialEnvironmentNames = [];
for (const key of Object.keys(env)) {
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_)/.test(key)
	) {
		removedCredentialEnvironmentNames.push(key);
		delete env[key];
	}
}
const args = process.argv.slice(2);
const child = spawn(process.execPath, [resolve("tests/run-smoke.mjs"), ...args], {
	env,
	stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
const [code, signal] = await once(child, "exit");
const result = {
	fixture,
	aggregator: "tests/run-smoke.mjs",
	args,
	code,
	signal,
	removedCredentialEnvironmentNames,
	externalDshRuntime: env.PI_WEB_DSH_RUNTIME ?? null,
	isolation: "empty fallback auth/models, independent agent/data/DSH home; original tests and assertions are unchanged",
};
writeFileSync("docs/desktop-delivery/evidence/T21-isolated-smoke.json", JSON.stringify(result, null, 2));
process.exitCode = code ?? 1;
