/** P1-1: local OAS 3.0 import and contract-grounded declarative collection compiler. No execution/approval. */
import Ajv from "ajv";
import SwaggerParser from "@apidevtools/swagger-parser";
import { createHash, randomUUID } from "node:crypto";
import {
	readFileSync,
	realpathSync,
	statSync,
	mkdirSync,
	writeFileSync,
	renameSync,
	existsSync,
	rmSync,
} from "node:fs";
import { isAbsolute, join, relative, dirname, resolve } from "node:path";

export const COMPILER_VERSION = "1";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
const bytes = (value) => JSON.stringify(value, null, 2) + "\n";
const fail = (message) => {
	throw new Error(message);
};
const escapePointer = (value) => value.replaceAll("~", "~0").replaceAll("/", "~1");
const inside = (root, path) => {
	const rel = relative(root, path);
	return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\");
};
const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const COVERED = new Set([
	"type",
	"properties",
	"required",
	"enum",
	"items",
	"nullable",
	"description",
	"title",
	"example",
	"examples",
	"deprecated",
	"readOnly",
	"writeOnly",
	"xml",
	"externalDocs",
]);

// Examples are not used as authoritative assertions and may contain credentials. Preserve a clean source.
export function sanitizeSource(value, parent = "") {
	if (Array.isArray(value)) return value.map((child) => sanitizeSource(child, parent));
	if (typeof value === "string" && /https?:\/\/[^/\s]+:[^/\s]+@/i.test(value)) fail("URL contains inline credentials");
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(
				([key]) =>
					[
						"properties",
						"schemas",
						"paths",
						"responses",
						"content",
						"headers",
						"parameters",
						"requestBodies",
						"securitySchemes",
						"links",
						"callbacks",
						"encoding",
					].includes(parent) || !["example", "examples"].includes(key),
			)
			.map(([key, item]) => {
				if (
					/^(authorization|password|access_token|refresh_token|api_key|apiKey)$/i.test(key) &&
					typeof item === "string"
				)
					fail("Embedded credential-like value must be removed from the source");
				return [key, sanitizeSource(item, key)];
			}),
	);
}
function visit(value, fn, pointer = "#") {
	if (!value || typeof value !== "object") return;
	fn(value, pointer);
	for (const [key, child] of Object.entries(value)) visit(child, fn, pointer + "/" + escapePointer(key));
}

export async function importContract({ projectRoot, sourcePath, operationIds }) {
	const project = realpathSync(projectRoot);
	if (typeof sourcePath !== "string" || !sourcePath.endsWith(".json")) fail("Only local OpenAPI 3.0 JSON is supported");
	const path = realpathSync(resolve(project, sourcePath));
	if (!inside(project, path)) fail("Contract is outside the bound project");
	if (statSync(path).size > 2 * 1024 * 1024) fail("Contract exceeds 2 MiB");
	const rawBytes = readFileSync(path);
	const raw = JSON.parse(rawBytes.toString("utf8"));
	if (!/^3\.0\.\d+$/.test(raw.openapi ?? "")) fail("Only OpenAPI 3.0 is supported; conversion is not implicit");
	visit(raw, (node) => {
		if (node.$ref && (typeof node.$ref !== "string" || !node.$ref.startsWith("#/")))
			fail("Only document-internal references are supported");
	});
	const source = sanitizeSource(raw);
	const resolved = await SwaggerParser.validate(structuredClone(source), {
		resolve: { file: false, http: false },
		dereference: { circular: false },
	});
	if (!Array.isArray(operationIds) || !operationIds.length || new Set(operationIds).size !== operationIds.length)
		fail("Select unique operation IDs");
	const all = new Map();
	for (const [path, item] of Object.entries(resolved.paths))
		for (const [method, operation] of Object.entries(item)) {
			if (!METHODS.has(method) || !operation?.operationId) continue;
			if (all.has(operation.operationId)) fail("Duplicate operationId: " + operation.operationId);
			all.set(operation.operationId, {
				path,
				method,
				operation,
				parameters: [...(item.parameters ?? []), ...(operation.parameters ?? [])],
				source: "#/paths/" + escapePointer(path) + "/" + method,
			});
		}
	const operations = operationIds.map((id) => all.get(id) ?? fail("Operation is missing: " + id));
	const unsupported = [];
	for (const op of operations)
		visit(
			op.operation,
			(node, at) => {
				if (node.type || node.properties || node.allOf || node.anyOf || node.oneOf)
					for (const key of Object.keys(node)) {
						if (!COVERED.has(key) && !key.startsWith("x-"))
							unsupported.push({
								operationId: op.operation.operationId,
								pointer: at,
								keyword: key,
								status: "not-covered",
							});
					}
			},
			op.source,
		);
	return { source, resolved, operations, unsupported, inputSha256: hash(rawBytes), sourceSha256: hash(bytes(source)) };
}

/** Contract-only outlines: missing data/rules remain pending, never guessed executable input. */
export function designCandidates(imported) {
	const candidates = [];
	for (const op of imported.operations)
		for (const status of Object.keys(op.operation.responses)) {
			if (!/^[2-5]\d\d$/.test(status)) continue;
			const schema = op.operation.responses[status].content?.["application/json"]?.schema;
			if (!schema) continue;
			const checks = [];
			const walk = (field, pointer, depth) => {
				if (depth > 8) return;
				checks.push({ kind: "exists", pointer });
				if (field.type && !field.nullable) checks.push({ kind: "type", pointer, value: field.type });
				if (field.enum && !field.nullable) checks.push({ kind: "enum", pointer, value: field.enum });
				for (const name of field.required ?? [])
					if (field.properties?.[name]) walk(field.properties[name], pointer + "/" + escapePointer(name), depth + 1);
			};
			walk(schema, "", 0);
			const request = { path: {}, query: {} };
			for (const p of op.parameters) if (p.required && ["path", "query"].includes(p.in)) request[p.in][p.name] = null;
			if (op.operation.requestBody?.required) request.body = null;
			candidates.push({
				id: "candidate-" + hash(op.operation.operationId + ":" + status).slice(0, 12),
				operationId: op.operation.operationId,
				status: Number(status),
				request,
				checks,
				state: "needs-input",
				pending:
					Number(status) >= 400
						? ["request data", "confirmed negative input-to-status rule"]
						: ["request data and business-rule confirmation"],
				basis: op.source + "/responses/" + status,
			});
		}
	return candidates;
}

function responseSchema(op, status) {
	const response = op.operation.responses?.[String(status)];
	if (!response || !Number.isInteger(status) || status < 100 || status > 599)
		fail("Expected status must be explicitly declared by the operation");
	const content = response.content;
	if (!content?.["application/json"]?.schema) fail("A JSON response schema is required for this compiler");
	return content["application/json"].schema;
}
function schemaField(schema, pointer) {
	if (pointer === "") return { schema, required: true };
	if (typeof pointer !== "string" || !pointer.startsWith("/") || /~(?![01])/u.test(pointer))
		fail("Invalid JSON pointer");
	let current = schema;
	let required = true;
	for (const segment of pointer
		.slice(1)
		.split("/")
		.map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"))) {
		if (current.type !== "object" || !Object.hasOwn(current.properties ?? {}, segment))
			fail("Assertion field is absent from the contract");
		required &&= (current.required ?? []).includes(segment);
		current = current.properties[segment];
	}
	return { schema: current, required };
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function compileCheck(check, schema, rules, op, status) {
	if (Object.keys(check).some((key) => !["kind", "pointer", "value", "ruleId"].includes(key)))
		fail("Unsupported assertion field");
	const { schema: field, required } = schemaField(schema, check.pointer);
	const rule = check.ruleId
		? rules.find(
				(r) =>
					r.id === check.ruleId &&
					r.operationId === op.operation.operationId &&
					r.status === status &&
					r.pointer === check.pointer &&
					r.confirmed === true &&
					typeof r.source === "string" &&
					r.source.trim(),
			)
		: null;
	if (check.ruleId && !rule) fail("Assertion business rule is missing or unconfirmed");
	if (check.kind === "exists") {
		if (!required) fail("Optional field existence is not guaranteed");
	} else if (check.kind === "type") {
		if (check.value !== field.type || field.nullable) fail("Type assertion differs from contract or ignores nullable");
	} else if (check.kind === "enum") {
		if (!Array.isArray(field.enum) || !equal(check.value, field.enum) || field.nullable)
			fail("Enum assertion differs from contract");
	} else if (check.kind === "equals") {
		if (!(rule && equal(rule.equals, check.value)) && !(field.enum?.length === 1 && equal(field.enum[0], check.value)))
			fail("Exact expected value has no contract/business basis");
	} else fail("Unsupported assertion kind");
	if (check.kind !== "exists" && !required) fail("Optional fields need conditional assertions, not supported yet");
	return {
		...check,
		basis: rule
			? { kind: "business-rule", id: rule.id, source: rule.source }
			: {
					kind: "contract",
					document: "resolved-source.json",
					source: op.source + "/responses/" + status + "/content/application~1json/schema",
					pointer: check.pointer,
				},
	};
}
function requestFor(op, supplied, baseUrl, negative) {
	const validateInput = (schema, value) => {
		if (!negative && schema && !new Ajv({ strict: false, validateFormats: false }).validate(schema, value))
			fail("Positive input violates the declared request schema");
	};
	if (!supplied || typeof supplied !== "object") fail("Explicit request data is required");
	if (Object.keys(supplied).some((key) => !["path", "query", "body"].includes(key)))
		fail("Unsupported request data key");
	const pathParams = supplied.path ?? {},
		query = supplied.query ?? {};
	for (const [location, values] of [
		["path", pathParams],
		["query", query],
	])
		for (const key of Object.keys(values)) {
			if (!op.parameters.some((p) => p.in === location && p.name === key)) fail("Request parameter is not declared");
			if (!["string", "number", "boolean"].includes(typeof values[key]))
				fail("Only scalar request parameters are supported");
		}
	for (const p of op.parameters) {
		const values = p.in === "path" ? pathParams : query;
		if (Object.hasOwn(values, p.name)) validateInput(p.schema, values[p.name]);
		if (!["path", "query"].includes(p.in)) fail("Header/cookie parameters require a later explicit adapter");
		if (p.required && !Object.hasOwn(p.in === "path" ? pathParams : query, p.name))
			fail("Required request parameter is missing");
		if ((p.style && !["form", "simple"].includes(p.style)) || (p.explode === false && p.in === "query"))
			fail("Unsupported parameter serialization");
	}
	let path = op.path.replace(/\{([^}]+)\}/g, (_m, name) => {
		if (!Object.hasOwn(pathParams, name)) fail("Path parameter data missing");
		return encodeURIComponent(String(pathParams[name]));
	});
	const url = new URL(baseUrl + path);
	for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
	const request = { method: op.method.toUpperCase(), url: url.href, header: [] };
	if (op.operation.requestBody) {
		if (!op.operation.requestBody.content?.["application/json"]) fail("Only JSON request bodies are supported");
		if (op.operation.requestBody.required && !Object.hasOwn(supplied, "body")) fail("Required request body is missing");
		if (Object.hasOwn(supplied, "body")) {
			validateInput(op.operation.requestBody.content["application/json"].schema, supplied.body);
			request.header.push({ key: "Content-Type", value: "application/json" });
			request.body = { mode: "raw", raw: JSON.stringify(supplied.body), options: { raw: { language: "json" } } };
		}
	} else if (Object.hasOwn(supplied, "body")) fail("Request body is not declared");
	return request;
}
const literal = (value) => JSON.stringify(value).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
export function compileSuite({ imported, cases, rules = [], baseUrl, requiredKeywords = [] }) {
	const base = new URL(baseUrl);
	if (
		!["http:", "https:"].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash ||
		base.pathname !== "/"
	)
		fail("An explicit origin without credentials is required");
	if (requiredKeywords.some((key) => imported.unsupported.some((u) => u.keyword === key)))
		fail("A business-critical keyword is not covered");
	if (!Array.isArray(cases) || !cases.length || new Set(cases.map((c) => c.id)).size !== cases.length)
		fail("Cases must have unique IDs");
	const compiled = cases.map((candidate) => {
		if (candidate.state && candidate.state !== "ready") fail("Candidate still needs confirmed input");

		if (
			Object.keys(candidate).some(
				(key) =>
					!["id", "operationId", "request", "status", "checks", "negativeRuleId", "state", "priority"].includes(key),
			)
		)
			fail("Unsupported case field; imported scripts are not accepted");
		// Inspect data for obvious credentials without rewriting the actual request.
		sanitizeSource(candidate.request);
		if (typeof candidate.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id)) fail("Invalid stable case ID");
		const op =
			imported.operations.find((o) => o.operation.operationId === candidate.operationId) ??
			fail("Case operation was not selected");
		if ((op.operation.security ?? imported.resolved.security ?? []).length)
			fail("Authentication requires an approved credential-reference adapter");
		if (!Array.isArray(candidate.checks) || !candidate.checks.length) fail("Each case must have a JSON assertion");
		const schema = responseSchema(op, candidate.status);
		const checks = candidate.checks.map((c) => compileCheck(c, schema, rules, op, candidate.status));
		if (
			candidate.status >= 400 &&
			!rules.some(
				(r) =>
					r.id === candidate.negativeRuleId &&
					r.operationId === candidate.operationId &&
					r.status === candidate.status &&
					r.confirmed &&
					r.source,
			)
		)
			fail("Negative input-to-status behavior requires a confirmed rule");
		const request = requestFor(op, candidate.request, base.origin, candidate.status >= 400);
		const exec = [
			`pm.test(${literal(candidate.id + ":status")}, () => pm.response.to.have.status(${candidate.status}));`,
			"const document = pm.response.json();",
			"const field = (pointer) => pointer === '' ? document : pointer.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((v, k) => v != null && Object.prototype.hasOwnProperty.call(v, k) ? v[k] : undefined, document);",
		];
		for (const [i, check] of checks.entries()) {
			const value = `field(${literal(check.pointer)})`;
			const assertion =
				check.kind === "exists"
					? `pm.expect(${value}).not.to.equal(undefined)`
					: check.kind === "equals"
						? `pm.expect(${value}).to.deep.equal(${literal(check.value)})`
						: check.kind === "enum"
							? `pm.expect(${literal(check.value)}).to.deep.include(${value})`
							: check.value === "integer"
								? `pm.expect(Number.isInteger(${value})).to.equal(true)`
								: check.value === "array"
									? `pm.expect(Array.isArray(${value})).to.equal(true)`
									: `pm.expect(${value}).to.be.a(${literal(check.value)})`;
			exec.push(`pm.test(${literal(candidate.id + ":" + i + ":" + check.kind)}, () => { ${assertion}; });`);
		}
		return {
			...candidate,
			checks,
			basis: op.source,
			executable: {
				name: candidate.id,
				request,
				event: [{ listen: "test", script: { type: "text/javascript", exec } }],
			},
		};
	});
	const collection = {
		info: {
			name: "Contract-grounded API suite",
			schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
		},
		item: compiled.map((c) => c.executable),
	};
	const files = {
		"source.json": bytes(imported.source),
		"resolved-source.json": bytes(imported.resolved),
		"cases.json": bytes(compiled.map(({ executable, ...c }) => c)),
		"rules.json": bytes(rules),
		"collection.json": bytes(collection),
		"review.json": bytes({ schemaVersion: 1, verdict: "pending", artifactHash: hash(bytes(collection)) }),
	};
	const manifest = {
		schemaVersion: 1,
		compilerVersion: COMPILER_VERSION,
		state: "draft",
		inputSha256: imported.inputSha256,
		collectionSha256: hash(files["collection.json"]),
		files: Object.fromEntries(Object.entries(files).map(([p, data]) => [p, hash(data)])),
		unsupported: imported.unsupported,
		sourceSanitization: "examples omitted; credential-like literals rejected; manual data review still required",
	};
	return { files, manifest };
}

/** Publish a new draft only. No overwrite, approval signing or mutable asset index. */
export function saveDraft(projectRoot, outputPath, suite) {
	const project = realpathSync(projectRoot);
	const target = resolve(project, outputPath);
	const parent = realpathSync(dirname(target));
	if (!inside(project, parent) || !inside(project, target)) fail("Output is outside the bound project");
	if (existsSync(target)) fail("Draft already exists; use a new revision path");
	const temp = join(parent, ".api-suite-" + randomUUID());
	mkdirSync(temp, { mode: 0o700 });
	try {
		for (const [name, data] of Object.entries(suite.files)) {
			if (name.includes("/") || name.includes("\\") || name === ".." || hash(data) !== suite.manifest.files[name])
				fail("Invalid draft file/hash");
			writeFileSync(join(temp, name), data, { mode: 0o600, flag: "wx" });
		}
		writeFileSync(join(temp, "manifest.json"), bytes(suite.manifest), { mode: 0o600, flag: "wx" });
		renameSync(temp, target);
		return { path: target, manifestSha256: hash(bytes(suite.manifest)), state: "draft" };
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}
