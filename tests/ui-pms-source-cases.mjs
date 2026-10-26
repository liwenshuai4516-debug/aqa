/** Source-grounded, non-executable PMS case drafts; native save-cases only, no browser/model. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ArtifactStore } from "pi-ui-testing";
const root = resolve("tests/scratch/ui-real-target-admission/source-only");
const output = resolve("tests/scratch/ui-pms-source-cases", String(Date.now()));
await mkdir(output, { recursive: true });
await cp(fileURLToPath(import.meta.url), join(output, "harness.mjs"));
const store = new ArtifactStore(root),
	source = JSON.parse(await readFile(join(root, "qa/ui/scopes/operation-contract-source-admission/manifest.json")));
const artifact = (kind, id, data) => ({ schema_version: "1.0", kind, id, created_at: new Date().toISOString(), data });
const scope = artifact("scope", "pms-source-case-drafts-v2", {
	...source.data,
	project_id: "e2f5d42d-2781-4e68-a452-4c87c7d1d346",
	environment_id: "f46a32da-2eac-43ca-86b8-2fa5eca5385c",
	role: "configured account identity checked; business role unknown",
	base_url: "http://192.168.90.224:8238",
	goal: "Prepare and import three source-grounded drafts for the selected desktop project; no recorded script, design approval, diagnostic or execution.",
	allowed_actions: [
		"Read frozen public source",
		"Save source-only native cases",
		"Import drafts into the selected Data Space project",
	],
});
const scopeRef = await store.put(scope);
const dataRulesRef = await store.putFile(
	"qa/ui/cases/pms-source-case-drafts-v2/data-rules.json",
	JSON.stringify(
		{
			readiness: "design-only",
			preparedData: [],
			rules: [
				"No business data created or server mutation executed",
				"Future draft checks require owned synthetic form data, entity type and verified cleanup",
				"Future state checks require isolated rows without conflicting higher-precedence status fields",
				"Never emit account credentials, token or storage-state contents",
			],
			gaps: [
				"Business role unknown",
				"Owned data preparation/cleanup unverified",
				"Real normal/error diagnostic targets unavailable",
				"No MCP recording or verified locator",
			],
		},
		null,
		2,
	),
);
const common = {
	module_id: "operation-contract",
	priority: "P1",
	browser_project: "chromium",
	cleanup: "Not executed. Future owned fixtures require verified cleanup; do not delete existing business data.",
};
const rows = [
	{
		id: "authentication",
		title: "源码草稿：成功登录后的私有认证状态",
		source: "public-login-js",
		preconditions: [
			"Private adapter and same-browser account match exist; generalized recording bridge still pending",
			"Future authorized successful login and single-tenant initialization; no credentials in case text",
		],
		action: "在后续受控浏览器会话中复用私有登录配置，核对登录成功后的认证状态存在；只记录布尔值，不记录 token。",
		target: "private browser token presence after the declared successful login initialization",
		expected: true,
	},
	{
		id: "drafts",
		title: "源码草稿：账号与业务类型的草稿命名空间",
		source: "public-app-js",
		preconditions: [
			"Source function hre constructs pms-business-drafts:${username}:${entityType}",
			"Actual OperationContract draft interaction, two owned account/entity inputs and cleanup remain unprepared",
		],
		action:
			"准备隔离且归属明确的账号/业务类型组合；在后续受控草稿交互中核对存储命名空间分别包含该账号和该业务类型。当前不创建草稿。",
		target: "declared draft namespace varies with account and entity type",
		expected: { accountScoped: true, entityTypeScoped: true },
	},
	{
		id: "contract-state",
		title: "源码草稿：经营合同状态显示映射",
		source: "public-app-js",
		preconditions: [
			"Source function RS maps contractStatus SIGNED to 已完成 before other branches",
			"DRAFT row must have no SIGNED or TERMINATED contractStatus; role and isolated controlled rows unprepared",
		],
		action: "在后续隔离受控列表中分别提供无冲突的 DRAFT 和 SIGNED 记录，核对各自状态文本；当前不修改真实合同状态。",
		target: "state labels of isolated DRAFT and SIGNED contract rows",
		expected: { DRAFT: "草稿", SIGNED: "已完成" },
	},
];
const cases = artifact("cases", "pms-source-case-drafts-v2", {
	scope_ref: scopeRef,
	sources: scope.data.sources,
	data_rules_ref: dataRulesRef,
	gaps: [
		"Source declarations are not confirmed business requirements",
		"Source-only draft: no recording, script bindings, static candidate check, independent design approval, diagnostics or execution",
		"Business role, isolated test data and cleanup unverified",
	],
	cases: rows.map((r) => ({
		...common,
		case_id: "PMS-source-" + r.id,
		feature_id: r.id,
		scenario_id: r.id + "-source",
		title: r.title,
		preconditions: ["未评审、未执行；仅由公开源码声明生成，不能用于正式运行。", ...r.preconditions],
		steps: [{ step_id: "S-" + r.id, action: r.action, assertion_ids: ["A-" + r.id] }],
		assertions: [
			{
				assertion_id: "A-" + r.id,
				step_id: "S-" + r.id,
				source_id: r.source,
				oracle_type: "declaration",
				target: r.target,
				comparison: "toEqual",
				expected: r.expected,
				observation: "Future controlled UI state; not observed or executed by this draft generator",
				evidence_required: true,
			},
		],
		data_row_id: "unprepared-" + r.id,
	})),
});
const definitions = new Map(),
	installed = dirname(fileURLToPath(import.meta.resolve("pi-ui-testing")));
const { registerDesignTools } = await import(pathToFileURL(join(installed, "design-extension.js")));
registerDesignTools({ registerTool: (tool) => definitions.set(tool.name, tool) });
const saved = await definitions
	.get("ui_case_design")
	.execute(
		"pms-source-case-drafts-v2-save",
		{ request: { operation: "save-cases", cases } },
		new AbortController().signal,
		undefined,
		{ cwd: root },
	);
assert.equal(saved.details.status, "completed", "Native cases registration failed");
const ref = saved.details.artifact_refs[0];
await store.load(ref);
const result = {
	status: "SOURCE_ONLY_NOT_REVIEWED_NOT_EXECUTABLE",
	root,
	casesRef: ref,
	scopeRef,
	dataRulesRef,
	caseCount: 3,
	modelCalls: 0,
	businessExecutions: 0,
	tool: saved,
};
await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, ...result }, null, 2));
