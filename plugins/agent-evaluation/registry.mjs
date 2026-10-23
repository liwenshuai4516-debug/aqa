/** Trusted, release-owned extensions only. This registry is not a JavaScript sandbox. */
import { Type as T } from "typebox";
import { Check } from "typebox/value";
import { requireValue } from "./schema.mjs";

const id = T.String({ pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$" });
const version = T.String({ pattern: "^[0-9]+(?:\\.[0-9]+){0,2}$", maxLength: 32 });
const text = T.String({ minLength: 1, maxLength: 256 });
const ref = T.Object({ id, version }, { additionalProperties: false });
const subject = T.Union([T.Literal("agent-task"), T.Literal("client-software")]);
const subjects = T.Array(subject, { minItems: 1, maxItems: 2, uniqueItems: true });
const schema = T.Record(T.String(), T.Unknown());
const manifestSchema = T.Object(
	{
		id,
		version,
		method: T.Literal("deterministic"),
		supportedTaskTypes: subjects,
		requiredEvidence: T.Array(text, { maxItems: 100, uniqueItems: true }),
		configSchema: schema,
		outputSchemaVersion: T.Literal(1),
		timeoutMs: T.Integer({ minimum: 1, maximum: 10000 }),
		budget: T.Object({ maxFindings: T.Integer({ minimum: 1, maximum: 1000 }) }, { additionalProperties: false }),
		dependencies: T.Array(ref, { maxItems: 100 }),
	},
	{ additionalProperties: false },
);
const ruleSchema = T.Object({ id, version, config: schema }, { additionalProperties: false });
const profileSchema = T.Object(
	{
		id,
		version,
		taskTypes: subjects,
		rules: T.Array(ruleSchema, { minItems: 1, maxItems: 100 }),
		required: T.Array(ref, { maxItems: 100 }),
		aggregation: T.Literal("contract-v1"),
	},
	{ additionalProperties: false },
);
const key = (value) => `${value.id}@${value.version}`;
export function deepFreeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
const schemaTypes = T.Union(["object", "array", "string", "number", "integer", "boolean", "null"].map(T.Literal));
const nonnegative = T.Integer({ minimum: 0 });
const schemaShape = T.Object(
	{
		type: T.Optional(T.Union([schemaTypes, T.Array(schemaTypes, { minItems: 1, uniqueItems: true })])),
		properties: T.Optional(T.Record(T.String(), T.Unknown())),
		patternProperties: T.Optional(T.Record(T.String(), T.Unknown())),
		required: T.Optional(T.Array(T.String(), { uniqueItems: true })),
		additionalProperties: T.Optional(T.Union([T.Boolean(), schema])),
		items: T.Optional(T.Union([T.Boolean(), schema])),
		anyOf: T.Optional(T.Array(T.Unknown(), { minItems: 1 })),
		allOf: T.Optional(T.Array(T.Unknown(), { minItems: 1 })),
		oneOf: T.Optional(T.Array(T.Unknown(), { minItems: 1 })),
		not: T.Optional(T.Union([T.Boolean(), schema])),
		enum: T.Optional(T.Array(T.Unknown(), { minItems: 1 })),
		const: T.Optional(T.Unknown()),
		minLength: T.Optional(nonnegative),
		maxLength: T.Optional(nonnegative),
		pattern: T.Optional(T.String()),
		minItems: T.Optional(nonnegative),
		maxItems: T.Optional(nonnegative),
		uniqueItems: T.Optional(T.Boolean()),
		minimum: T.Optional(T.Number()),
		maximum: T.Optional(T.Number()),
		exclusiveMinimum: T.Optional(T.Number()),
		exclusiveMaximum: T.Optional(T.Number()),
		multipleOf: T.Optional(T.Number({ exclusiveMinimum: 0 })),
		description: T.Optional(T.String()),
		title: T.Optional(T.String()),
		default: T.Optional(T.Unknown()),
	},
	{ additionalProperties: false },
);
export function validateConfigSchema(value) {
	// Deliberately bounded JSON Schema subset; no external refs, runtime code or silent unknown keywords.
	const raw = JSON.stringify(value);
	requireValue(raw && Buffer.byteLength(raw) <= 65536, "INVALID_INPUT", "Config schema exceeds budget");
	let nodes = 0;
	const visit = (item, depth = 0) => {
		requireValue(depth <= 32 && ++nodes <= 10000, "INVALID_INPUT", "Config schema is too complex");
		if (typeof item === "boolean") return;
		requireValue(
			item && typeof item === "object" && !Object.hasOwn(item, "$ref") && !Object.hasOwn(item, "$id"),
			"INVALID_INPUT",
			"Config schema refs are not supported",
		);
		requireValue(Check(schemaShape, item), "INVALID_INPUT", "Unsupported config schema");
		if (item.pattern) {
			try {
				new RegExp(item.pattern);
			} catch {
				requireValue(false, "INVALID_INPUT", "Invalid config schema pattern");
			}
		}
		for (const child of Object.values(item.properties ?? {})) visit(child, depth + 1);
		for (const [pattern, child] of Object.entries(item.patternProperties ?? {})) {
			try {
				new RegExp(pattern);
			} catch {
				requireValue(false, "INVALID_INPUT", "Invalid config schema pattern");
			}
			visit(child, depth + 1);
		}
		for (const name of ["additionalProperties", "items", "not"])
			if (item[name] !== undefined) visit(item[name], depth + 1);
		for (const name of ["anyOf", "allOf", "oneOf"]) for (const child of item[name] ?? []) visit(child, depth + 1);
	};
	visit(value);
}

function graphOrder(rules) {
	const visiting = new Set(),
		done = new Set(),
		order = [];
	const visit = (item) => {
		const name = key(item.manifest);
		requireValue(!visiting.has(name), "INVALID_INPUT", "Evaluator dependency cycle");
		if (done.has(name)) return;
		visiting.add(name);
		for (const dep of item.manifest.dependencies) {
			const dependency = rules.get(key(dep));
			requireValue(dependency, "INVALID_INPUT", `Missing evaluator dependency: ${key(dep)}`);
			visit(dependency);
		}
		visiting.delete(name);
		done.add(name);
		order.push(name);
	};
	for (const item of rules.values()) visit(item);
	return order;
}

export class EvaluationRegistry {
	#evaluators = new Map();
	#adapters = new Map();
	#profiles = new Map();
	registerEvaluators(implementations) {
		requireValue(
			Array.isArray(implementations) && implementations.length <= 100,
			"INVALID_INPUT",
			"Invalid evaluator batch",
		);
		const next = new Map(this.#evaluators);
		for (const implementation of implementations) {
			requireValue(
				implementation &&
					Check(manifestSchema, implementation.manifest) &&
					typeof implementation.evaluate === "function",
				"INVALID_INPUT",
				"Invalid evaluator manifest",
			);
			const manifest = structuredClone(implementation.manifest),
				name = key(manifest);
			requireValue(!next.has(name), "VERSION_CONFLICT", `Evaluator already registered: ${name}`);
			validateConfigSchema(manifest.configSchema);
			requireValue(
				new Set(manifest.dependencies.map(key)).size === manifest.dependencies.length,
				"INVALID_INPUT",
				"Duplicate evaluator dependency",
			);
			next.set(name, Object.freeze({ manifest: deepFreeze(manifest), evaluate: implementation.evaluate }));
		}
		graphOrder(next);
		this.#evaluators = next;
	}
	registerAdapter(adapter) {
		requireValue(
			adapter &&
				Check(ref, { id: adapter.id, version: adapter.version }) &&
				typeof adapter.collect === "function" &&
				typeof adapter.capabilities === "function",
			"INVALID_INPUT",
			"Invalid evidence adapter",
		);
		const name = key(adapter);
		requireValue(!this.#adapters.has(name), "VERSION_CONFLICT", `Adapter already registered: ${name}`);
		const capabilities = structuredClone(adapter.capabilities());
		requireValue(
			capabilities &&
				typeof capabilities === "object" &&
				!Array.isArray(capabilities) &&
				Object.keys(capabilities).length <= 100 &&
				Object.values(capabilities).every((value) =>
					["supported", "partial", "unsupported", "unknown"].includes(value),
				),
			"INVALID_INPUT",
			"Invalid adapter capabilities",
		);
		this.#adapters.set(
			name,
			Object.freeze({
				id: adapter.id,
				version: adapter.version,
				collect: adapter.collect,
				capabilities: () => structuredClone(capabilities),
			}),
		);
	}
	registerProfile(input) {
		requireValue(Check(profileSchema, input), "INVALID_INPUT", "Invalid evaluation profile");
		const profile = structuredClone(input),
			name = key(profile);
		requireValue(!this.#profiles.has(name), "VERSION_CONFLICT", `Profile already registered: ${name}`);
		const selected = new Set(profile.rules.map(key));
		requireValue(
			selected.size === profile.rules.length && new Set(profile.rules.map((r) => r.id)).size === profile.rules.length,
			"INVALID_INPUT",
			"Duplicate profile rule or multiple versions of one rule",
		);
		requireValue(
			new Set(profile.required.map(key)).size === profile.required.length &&
				profile.required.every((r) => selected.has(key(r))),
			"INVALID_INPUT",
			"Required evaluator is not selected",
		);
		for (const rule of profile.rules) {
			const evaluator = this.evaluator(rule.id, rule.version);
			requireValue(
				profile.taskTypes.every((t) => evaluator.manifest.supportedTaskTypes.includes(t)),
				"INVALID_INPUT",
				"Evaluator does not support profile task type",
			);
			requireValue(
				evaluator.manifest.dependencies.every((dep) => selected.has(key(dep))),
				"INVALID_INPUT",
				"Profile omits an evaluator dependency",
			);
			this.validateConfig(evaluator, rule.config);
		}
		this.#profiles.set(name, deepFreeze(profile));
	}
	evaluator(id, version) {
		const item = this.#evaluators.get(key({ id, version }));
		requireValue(item, "CAPABILITY_UNAVAILABLE", "Evaluator version is not registered");
		return item;
	}
	profile(id, version) {
		const item = this.#profiles.get(key({ id, version }));
		requireValue(item, "CAPABILITY_UNAVAILABLE", "Profile version is not registered");
		return item;
	}
	adapter(id, version) {
		const item = this.#adapters.get(key({ id, version }));
		requireValue(item, "CAPABILITY_UNAVAILABLE", "Adapter version is not registered");
		return item;
	}
	validateConfig(evaluator, config) {
		const raw = JSON.stringify(config);
		requireValue(
			raw && Buffer.byteLength(raw) <= 65536 && Check(evaluator.manifest.configSchema, config),
			"INVALID_INPUT",
			"Invalid evaluator configuration",
		);
	}
	orderedRules(profile) {
		const selected = new Map(profile.rules.map((rule) => [key(rule), rule]));
		return graphOrder(this.#evaluators)
			.filter((name) => selected.has(name))
			.map((name) => selected.get(name));
	}
}
