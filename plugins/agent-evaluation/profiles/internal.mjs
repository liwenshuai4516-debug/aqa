import { F03 } from "../evaluators/data-space.mjs";
import { EvaluationRegistry } from "../registry.mjs";
import { piEvidenceAdapter } from "../adapters/pi.mjs";
import { basicEvaluators } from "../evaluators/basic.mjs";
import { F08 } from "../evaluators/metrics.mjs";
import { F09 } from "../evaluators/verification.mjs";
export const internalEvaluators = [...basicEvaluators, F08, F09, F03];
/** Exact configs are frozen at registration. Empty checks never invent business expectations. */
export function internalProfile(configs = {}, { id = "internal", version = "1" } = {}) {
	const defaults = {
		F01: { checks: [] },
		F02: { checks: [] },
		F03: { checks: [] },
		F04: { checks: [] },
		F05: { checks: [] },
		F06: {},
		F07: { pollingToolNames: [], repairToolNames: ["edit", "write"] },
		F08: { prices: [], childWaitToolNames: [], checks: [] },
		F09: { checks: [] },
	};
	return {
		id,
		version,
		taskTypes: ["agent-task", "client-software"],
		rules: internalEvaluators.map((rule) => ({
			id: rule.manifest.id,
			version: rule.manifest.version,
			config: configs[rule.manifest.id] ?? defaults[rule.manifest.id],
		})),
		required: internalEvaluators.map((rule) => ({ id: rule.manifest.id, version: rule.manifest.version })),
		aggregation: "contract-v1",
	};
}
export function createInternalRegistry(configs = {}, options = {}) {
	const registry = new EvaluationRegistry();
	registry.registerAdapter(piEvidenceAdapter);
	registry.registerEvaluators(internalEvaluators);
	const profile = internalProfile(configs, options);
	// Keep the published internal@1 identity immutable for exact historical re-scoring.
	// Product requests freeze expanded rules under their existing content-derived profile ID.
	if (profile.id === "internal" && profile.version === "1") {
		profile.rules = profile.rules.filter((r) => !["F09", "F03"].includes(r.id));
		profile.required = profile.required.filter((r) => !["F09", "F03"].includes(r.id));
	}
	registry.registerProfile(profile);
	return registry;
}
