import { afterEach, expect, it, vi } from "vitest";
import { S } from "../../plugins/data-space/client/state.mjs";
import { automationModalHtml } from "../../plugins/data-space/client/modal-automation.mjs";
import { casesHtml } from "../../plugins/data-space/client/views.mjs";
const initial = { ...S };
afterEach(() => {
	Object.assign(S, initial);
	vi.unstubAllGlobals();
});
function setup() {
	const source = {
		workspace: "/synthetic",
		engine: "ui",
		projectId: "p",
		envId: "e",
		lineageId: "asset",
		featureId: "f",
		nativeCaseId: "C1",
		revision: "v1",
		intakeRevision: 2,
	};
	const original = {
		id: "old",
		code: "OLD",
		title: "Original version",
		featureId: "f",
		type: "UI",
		status: "草稿",
		nativeSource: source,
	};
	const current = {
		...original,
		id: "new",
		code: "NEW",
		title: "New revision",
		nativeSource: { ...source, revision: "v2", intakeRevision: 3 },
	};
	Object.assign(S, {
		systems: [{ id: "p", name: "Synthetic" }],
		modules: [{ id: "m", systemId: "p" }],
		features: [{ id: "f", moduleId: "m" }],
		cases: [original, current],
		sel: { systemId: "", moduleId: "", featureId: "" },
		caseVersion: "recent",
		caseQ: "",
		priority: "all",
		status: "all",
		caseType: "all",
		runs: [],
		runIndex: new Map(),
	});
	return { original, current };
}
it("defaults to the most recently imported revision and offers all versions without deleting rows", () => {
	setup();
	const before = JSON.stringify(S.cases);
	expect(casesHtml()).toContain("New revision");
	expect(casesHtml()).not.toContain("Original version");
	S.caseVersion = "all";
	expect(casesHtml()).toContain("Original version");
	expect(casesHtml()).toContain("New revision");
	expect(JSON.stringify(S.cases)).toBe(before);
});
it("does not merge unrelated projects, environments, assets, workspaces or native cases", () => {
	const { original, current } = setup();
	for (const field of ["workspace", "projectId", "envId", "lineageId", "nativeCaseId"]) {
		Object.assign(S, {
			cases: [original, { ...current, nativeSource: { ...current.nativeSource, [field]: "another" } }],
		});
		expect(casesHtml()).toContain("Original version");
		expect(casesHtml()).toContain("New revision");
	}
});
it("retains manual, legacy and API rows whose revision relationships are unknown", () => {
	const { original, current } = setup();
	Object.assign(S, {
		cases: [
			{ ...original, nativeSource: null },
			{ ...current, nativeSource: { assetRef: "digest", revision: "revision-without-lineage" } },
		],
	});
	expect(casesHtml()).toContain("Original version");
	expect(casesHtml()).toContain("New revision");
});
it("does not promote a historical match to recent when search excludes the newer row", () => {
	setup();
	S.caseQ = "Original version";
	expect(casesHtml()).not.toContain('data-act="edit-case" data-id="old"');
	S.caseVersion = "all";
	expect(casesHtml()).toContain('data-act="edit-case" data-id="old"');
});

it("keeps tied intake versions and moved destinations visible without guessing semantic order", () => {
	const { original, current } = setup();
	current.nativeSource.intakeRevision = original.nativeSource.intakeRevision;
	Object.assign(S, { cases: [original, current] });
	expect(casesHtml()).toContain("Original version");
	current.nativeSource.intakeRevision++;
	current.featureId = "another-feature";
	expect(casesHtml()).toContain("Original version");
});
it("escapes revision labels and localizes the new version controls", () => {
	const { current } = setup();
	current.nativeSource.revision = "<script>untrusted</script>";
	const html = casesHtml();
	expect(html).not.toContain("<script>");
	expect(html).toContain("&lt;script&gt;");
	vi.stubGlobal("document", { documentElement: { lang: "en" } });
	expect(casesHtml()).toContain("Latest imported revisions");
	expect(casesHtml()).toContain("All revisions (including history)");
});

it("keeps historical native source and parent-run evidence available in the existing modal", () => {
	setup();
	Object.assign(S, {
		automationModal: { caseId: "old", title: "Original version", engine: "ui" },
		runs: [
			{
				caseId: "old",
				verdict: "失败",
				automation: {
					runId: "child-run",
					parentRunId: "parent-run",
					revision: "v1",
					evidence: [{ path: "original-report.json", sha256: "a".repeat(64) }],
				},
			},
		],
	});
	const html = automationModalHtml();
	expect(html).toContain("原生来源与修订");
	expect(html).toContain("parent-run");
	expect(html).toContain("original-report.json");
	expect(html).toContain("v1");
});
