import { test, expect } from "pi-ui-testing/recording-fixtures";
test.use({
	uiEnvironment: {
		schema_version: "1.0",
		environment_id: "f46a32da-2eac-43ca-86b8-2fa5eca5385c",
		deployment_version: "live-unversioned",
		role: "configured account; business role not yet verified",
		base_url: "http://192.168.90.224:8238/pms/OperationContract",
		identity: { selector: 'button:has-text("查询")', text: "查询" },
		initial_state: { selector: 'button:has-text("查询")', text: "查询" },
		auth: {
			kind: "storage-state-env",
			reference: "PI_UI_DATA_SPACE_C36128DC8B901250F6E42F19C5242DBE4F944B0C38E90B3775A4FE2EE085B1FD",
		},
		isolation: "context",
		timeout_ms: 20000,
	},
	uiOwner: {
		task_id: "pms-operation-contract-new-20261029",
		kind: "recording",
		id: "pms-operation-contract-observe-v10",
	},
	uiProjectRoot: process.cwd(),
});
test("PMS managed recording seed: verify configured account and query entry", async ({ page }) => {
	const matched = await page.evaluate(async () => {
		let token = localStorage.getItem("token");
		try {
			const parsed = JSON.parse(token || "null");
			if (typeof parsed === "string") token = parsed;
		} catch {}
		if (!token) return false;
		const response = await fetch("/api/base-service/account-profile", {
			headers: { token, "x-parent-client-code": "pms", "x-client-code": "pms" },
		});
		const profile = await response.json();
		return response.ok && profile.code === 200 && profile.data?.username === "pms_admin";
	});
	expect(matched, "same-browser configured account identity").toBe(true);
	await expect(page.getByRole("button", { name: "查询", exact: true })).toBeVisible();
});
