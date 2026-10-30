// P0-only replaceable read-only inputs. No department ID fixture or business writes.
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
} as const;
