// Read-only inventory of the frozen source and current checkout. No application startup.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { parsers } from "prettier/plugins/typescript";

const currentRoot = process.cwd();
const sourceRoot = "/Users/liyingjun/Desktop/SW-QA/pi-web-ui-main";
const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");
const digest = (text) => crypto.createHash("sha256").update(text).digest("hex");
const ast = (root, file) => parsers.typescript.parse(read(root, file));
const walk = (node, fn) => {
	if (!node || typeof node !== "object") return;
	if (typeof node.type === "string") fn(node);
	for (const [key, value] of Object.entries(node)) {
		if (["loc", "range", "tokens", "comments"].includes(key)) continue;
		if (Array.isArray(value)) value.forEach((child) => walk(child, fn));
		else if (value && typeof value === "object") walk(value, fn);
	}
};
const literal = (node) => {
	while (node && ["TSAsExpression", "ParenthesizedExpression"].includes(node.type)) node = node.expression;
	return node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
};
async function pureExports(root, file) {
	const output = stripTypeScriptTypes(read(root, file));
	if (/^import\s/m.test(output)) throw new Error(`Unexpected runtime import: ${file}`);
	return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}
async function protocol(root) {
	const source = await ast(root, "server/protocol.ts");
	const result = {};
	for (const name of ["ClientMessage", "ServerMessage"]) {
		const node = source.body
			.map((s) => s.declaration ?? s)
			.find((s) => s.type === "TSTypeAliasDeclaration" && s.id.name === name);
		if (!node || node.typeAnnotation.type !== "TSUnionType") throw new Error(`Missing union ${name}`);
		const tags = [];
		for (const member of node.typeAnnotation.types) {
			if (member.type !== "TSTypeLiteral") throw new Error(`${name}: unexpected member ${member.type}`);
			const prop = member.members.find((p) => p.key?.name === "type");
			const tag = prop?.typeAnnotation?.typeAnnotation;
			if (!tag) throw new Error(`${name}: missing discriminator`);
			for (const item of tag.type === "TSUnionType" ? tag.types : [tag]) {
				const value = item.type === "TSLiteralType" ? literal(item.literal) : undefined;
				if (!value) throw new Error(`${name}: nonliteral discriminator`);
				tags.push(value);
			}
		}
		result[name] = [...new Set(tags)].sort();
	}
	return result;
}
async function inventory(root) {
	const tools = await pureExports(root, "server/tool-manager.ts");
	const uiAst = await ast(root, "web/src/ui-slots.ts");
	let uiItems;
	const valueOf = (node) => {
		if (node.type === "Literal") return node.value;
		if (node.type === "ArrayExpression") return node.elements.map(valueOf);
		if (node.type === "ObjectExpression")
			return Object.fromEntries(
				node.properties.map((p) => {
					if (p.type !== "Property" || p.computed) throw new Error("Nonliteral UI property");
					return [p.key.name ?? p.key.value, valueOf(p.value)];
				}),
			);
		throw new Error(`Nonliteral UI value: ${node.type}`);
	};
	walk(uiAst, (node) => {
		if (node.type === "VariableDeclarator" && node.id.name === "BUILTIN_UI_ITEMS") uiItems = valueOf(node.init);
	});
	if (!uiItems?.length) throw new Error("Missing built-in UI items");
	const settings = [];
	walk(await ast(root, "web/src/components/SettingsModal.tsx"), (node) => {
		if (node.type !== "VariableDeclarator" || node.id.name !== "tabs" || !node.init) return;
		walk(node.init, (entry) => {
			if (entry.type === "Property" && entry.key.name === "id") {
				const id = literal(entry.value);
				if (id) settings.push(id);
			}
		});
	});
	const catalog = JSON.parse(read(root, "plugins/catalog.json"));
	const manifests = fs
		.readdirSync(path.join(root, "plugins"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, "plugins", entry.name, "manifest.json")))
		.map((entry) => {
			const value = JSON.parse(read(root, `plugins/${entry.name}/manifest.json`));
			return { directory: entry.name, id: value.id, name: value.name, version: value.version };
		})
		.sort((a, b) => a.directory.localeCompare(b.directory));
	const files = [
		"server/tool-manager.ts",
		"server/protocol.ts",
		"web/src/ui-slots.ts",
		"web/src/components/SettingsModal.tsx",
		"plugins/catalog.json",
	];
	return {
		hashes: Object.fromEntries(files.map((file) => [file, digest(read(root, file))])),
		tools: tools.AGENT_TOOL_CATALOG,
		coreTools: tools.CORE_BUILTIN_TOOL_NAMES,
		uiItems,
		settingsTabs: [...new Set(settings)].sort(),
		protocol: await protocol(root),
		catalog: catalog.map(({ id, name, description, source }) => ({ id, name, description, source })),
		manifests,
	};
}
const source = await inventory(sourceRoot);
const current = await inventory(currentRoot);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const comparison = Object.fromEntries(Object.keys(source).map((key) => [key, equal(source[key], current[key])]));
const output = process.argv[2];
if (!output) throw new Error("Supply a new evidence output path");
fs.writeFileSync(output, JSON.stringify({ sourceRoot, currentRoot, comparison, source, current }, null, 2) + "\n", {
	flag: "wx",
});
console.log(
	JSON.stringify({
		comparison,
		counts: Object.fromEntries(
			Object.entries(current).map(([key, value]) => [
				key,
				Array.isArray(value) ? value.length : Object.keys(value).length,
			]),
		),
	}),
);
