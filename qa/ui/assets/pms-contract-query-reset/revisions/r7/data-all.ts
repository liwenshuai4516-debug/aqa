// Source-only draft. No credentials, storage state or business record IDs.
// Preserve all r4 P0 inputs; additions are independently declared query inputs.
export const data = {
	account: process.env.PMS_R4_ACCOUNT ?? "pms_admin",
	role: "configured account; business role not yet verified",
	endpoint: "/api/project-management-backend/v1/web/contract-mgt/operation-contract/page",
	profileEndpoint: "/api/base-service/account-profile",
	nameRaw: process.env.PMS_R4_NAME_RAW ?? "  AQA_OWNED_QUERY_ONLY  ",
	codeRaw: process.env.PMS_R4_CODE_RAW ?? "  AQA_OWNED_CODE_ONLY  ",
	start: process.env.PMS_R4_START ?? "2026-01-01",
	end: process.env.PMS_R4_END ?? "2026-01-31",
	concreteNode: "部门负责人审核",
	projectType: "集成实施类",
	pageSize: "10",
	whitespaceRaw: "   ",
	draftNode: "草稿",
	departmentEndpoint: "/api/base-service/department-tree",
	unsupportedMessage: "当前合同接口不支持项目类型及具体节点筛选，请清空后重试",
	// Engineering observation budget, not a declared business latency/refresh SLA.
	unsupportedWindowMs: 1500,
} as const;

// Public source identity only; no runtime approval or identity assertion.
export const frozenSource = {
	component: "d39d1798e1488f85a4ff4df23ae11cb1ed0bd3baa48795f72daca4b2f5f74ae7",
	bundle: "6c8032c1be5c27ec07eb9d149f37c31980229561d819ff31c0e5ca3759eca9ed",
	asset: "/assets/index-CIpFLfjX.js",
	componentRef: "qa/ui/scopes/pms-contract-deployment-r7-20261030/operation-contract.js",
	deploymentCheckRef: "qa/ui/scopes/pms-contract-deployment-r7-20261030/provenance.json",
	currentSourceDirectory: "qa/ui/scopes/pms-contract-deployment-r7-20261030",
	departmentSourceRef: "qa/ui/scopes/pms-contract-deployment-r7-20261030/department-n1.txt",
	departmentEndpointSourceRef: "qa/ui/scopes/pms-contract-deployment-r7-20261030/department-a0t.txt",
	sharedSourceRef: "qa/ui/scopes/pms-contract-deployment-r7-20261030/shared-source.txt",
	apiSourceRef: "qa/ui/scopes/pms-contract-deployment-r7-20261030/operation-contract-api.txt",
	sharedApiStatus: "confirmed",
} as const;
