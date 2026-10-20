import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
const root = resolve(process.argv[2] ?? "release/mac-arm64/Pi Agent Desktop.app/Contents/Resources/app");
for (const path of [
	"dist/desktop/main.js",
	"dist/desktop/preload.cjs",
	"dist/desktop/sidecar.js",
	"dist/server/index.js",
	"dist/server/dsh/runtime/launcher.mjs",
	"web/dist/index.html",
	"themes",
	"bin/pi-web-ui.mjs",
	"plugin-sdk/index.mjs",
	"plugins/catalog.json",
	"extensions/webui.ts",
	"locales/ja.json",
	"LICENSE",
	"node_modules/@earendil-works/pi-coding-agent/package.json",
	"node_modules/node-pty/package.json",
	"node_modules/@deepseek-ai/dsh-tools/package.json",
	"node_modules/@deepseek-ai/dsh-attachment/package.json",
	"node_modules/@deepseek-ai/dsh-llm-deepseek/package.json",
]) {
	assert(existsSync(join(root, path)), `Missing package resource: ${path}`);
}
const plugins = readdirSync("plugins").filter((name) => existsSync(join("plugins", name, "manifest.json")));
for (const plugin of plugins) {
	const path = join("plugins", plugin, "manifest.json");
	assert.equal(readFileSync(join(root, path), "utf8"), readFileSync(path, "utf8"), `Plugin ${plugin} manifest differs`);
	for (const path of ["index.mjs", "client/entry.mjs"]) {
		if (existsSync(join("plugins", plugin, path)))
			assert(existsSync(join(root, "plugins", plugin, path)), `Missing plugin ${plugin}/${path}`);
	}
}
const sdk = JSON.parse(readFileSync(join(root, "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8"));
assert.equal(sdk.version, "1.1.0");
assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).main, "dist/desktop/main.js");
const unwantedFeed = join(root, "..", "app-update.yml");
if (existsSync(unwantedFeed))
	assert(!readFileSync(unwantedFeed, "utf8").includes("xing-shuyin"), "Upstream update feed must not ship");
console.log(JSON.stringify({ status: "PASS", root, plugins: plugins.length, sdk: sdk.version }, null, 2));
