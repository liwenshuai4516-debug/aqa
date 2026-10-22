/**
 * data-space「引入到 AI 对话」纯逻辑单测 —— 走真实源码（client/brief.mjs），零端口零 token。
 *
 * 覆盖：
 *   - 档位自动切换（≤3 条卡片、更多清单）与手动档位优先；
 *   - 卡片档内容：路径 / 类型 / 优先级 / 前置条件 / 逐条「操作 → 预期」/ 关联数据；
 *   - 清单档：按功能分组、标题里的 `|` 转义、条数上限与「其余请分批」提示；
 *   - 末尾指令五选一（「不加指令」不留尾巴）；
 *   - 脱敏：口令 / token 打成 ***，关掉后原样输出；数据集只带名称不带取值；
 *   - 机器可读锚点带 revision 与用例 id；
 *   - 去重：markIntroduced 后同 revision 算已引入，revision 一变自动失效；
 *   - 注入：宿主 compose() 成功 → 走输入框并切到对话；不支持时退回剪贴板；都失败则如实返回。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, applyStore } from "../../plugins/data-space/client/state.mjs";
import {
	BRIEF_LIMITS,
	buildBrief,
	composeBrief,
	fmtChars,
	introducedCount,
	isIntroduced,
	markIntroduced,
	maskSecrets,
	resolveFormat,
} from "../../plugins/data-space/client/brief.mjs";

const stamp = "2026-10-20T02:00:00.000Z";

/** 用例形数据（字段与 store 一致；测试只关心引入文本用得到的那几个）。 */
type Case = Record<string, unknown>;

const store = (cases: Case[]) => ({
	revision: 49,
	updatedAt: stamp,
	systems: [{ id: "s1", name: "项目管理系统", code: "PMS", color: "blue", note: "", createdAt: stamp }],
	modules: [{ id: "m1", systemId: "s1", name: "合同管理", note: "", createdAt: stamp }],
	features: [
		{ id: "f1", moduleId: "m1", name: "经营合同", note: "", createdAt: stamp },
		{ id: "f2", moduleId: "m1", name: "合同变更", note: "", createdAt: stamp },
	],
	cases,
	datasets: [
		{
			id: "d1",
			featureId: "f1",
			name: "经营合同-新建参数",
			env: "测试环境",
			tags: [],
			note: "",
			records: [{ id: "r1", key: "password", value: "p@ssw0rd", remark: "" }],
			createdAt: stamp,
			updatedAt: stamp,
		},
	],
});

const makeCase = (i: number, over: Partial<Case> = {}): Case => ({
	id: `c${i}`,
	featureId: "f1",
	code: `PMS-00${i}`,
	title: `用例标题 ${i}`,
	priority: "P1",
	type: i % 2 === 0 ? "UI" : "接口",
	status: "已评审",
	owner: "张工",
	tags: [],
	preconditions: "",
	steps: [{ id: `st${i}`, action: `操作 ${i}`, expect: `预期 ${i}` }],
	datasetIds: ["d1"],
	note: "",
	createdAt: stamp,
	updatedAt: stamp,
	...over,
});

beforeEach(() => {
	applyStore(store([makeCase(1), makeCase(2), makeCase(3), makeCase(4)]));
	S.introduced = new Map();
});

afterEach(() => {
	delete (globalThis as Record<string, unknown>).__piWebUiHost;
});

describe("档位", () => {
	it("自动档：≤3 条走卡片，更多走清单", () => {
		expect(resolveFormat("auto", 1)).toBe("card");
		expect(resolveFormat("auto", 3)).toBe("card");
		expect(resolveFormat("auto", 4)).toBe("list");
		expect(resolveFormat("auto", 0)).toBe("card");
	});

	it("手动档位优先于自动", () => {
		expect(resolveFormat("list", 1)).toBe("list");
		expect(resolveFormat("card", 40)).toBe("card");
	});

	it("上限常量可被界面展示：卡片 20 / 清单 200 / 引用 200", () => {
		expect(BRIEF_LIMITS.card).toBe(20);
		expect(BRIEF_LIMITS.list).toBe(200);
		expect(BRIEF_LIMITS.ref).toBe(200);
	});
});

describe("卡片档", () => {
	it("带上路径、元信息、逐条步骤与预期、关联数据", () => {
		const out = buildBrief({ cases: [makeCase(1)], label: "项目管理系统 / 合同管理 / 经营合同" });
		expect(out.format).toBe("card");
		expect(out.count).toBe(1);
		expect(out.text).toContain("### 数据空间 · 用例引入");
		expect(out.text).toContain("- 范围：项目管理系统 / 合同管理 / 经营合同");
		expect(out.text).toContain("#### 用例 PMS-001 · 用例标题 1");
		expect(out.text).toContain("- 路径：项目管理系统 / 合同管理 / 经营合同");
		expect(out.text).toContain("类型：接口 · 优先级：P1 · 状态：已评审 · 负责人：张工");
		expect(out.text).toContain("  1. 操作 1");
		expect(out.text).toContain("     - 预期：预期 1");
		expect(out.text).toContain("- 关联数据：经营合同-新建参数");
	});

	it("没步骤时明确写「未填步骤」，不留空行", () => {
		const out = buildBrief({ cases: [makeCase(1, { steps: [] })] });
		expect(out.text).toContain("- 步骤：（未填步骤）");
	});

	it("多行前置条件压成一行，保持可读", () => {
		const out = buildBrief({ cases: [makeCase(1, { preconditions: "已登录\n有合同新建权限" })] });
		expect(out.text).toContain("- 前置条件：已登录；有合同新建权限");
	});
});

describe("引用档", () => {
	it("只带编号与标题，不带步骤，并指向工具取明细", () => {
		const cases = [makeCase(1), makeCase(2)];
		applyStore(store(cases));
		S.introduced = new Map();
		const out = buildBrief({ cases, format: "ref" });
		expect(out.format).toBe("ref");
		expect(out.text).toContain("引用档");
		expect(out.text).toContain("#### 项目管理系统 / 合同管理 / 经营合同（2 条）");
		expect(out.text).toContain("- PMS-001 · 用例标题 1（接口 · P1 · 已评审）");
		expect(out.text).toContain("data_space_cases");
		// 明细交给工具，正文不带步骤 / 关联数据取值
		expect(out.text).not.toContain("预期 1");
		expect(out.text).not.toContain("p@ssw0rd");
		// 锚点仍然在，后续回写结果靠它
		expect(out.text).toContain("<!-- data-space: revision=49 cases=");
	});

	it("空用例时返回空文本（不报错）", () => {
		const out = buildBrief({ cases: [], format: "ref" });
		expect(out.text).toBe("");
		expect(out.count).toBe(0);
	});
});

describe("清单档", () => {
	it("按功能分组出表格，标题里的竖线被转义", () => {
		const cases = [makeCase(1, { title: "A | B" }), makeCase(2), makeCase(3, { featureId: "f2", title: "变更-撤销" })];
		applyStore(store(cases));
		S.introduced = new Map();
		const out = buildBrief({ cases, format: "list" });
		expect(out.format).toBe("list");
		expect(out.text).toContain("#### 项目管理系统 / 合同管理 / 经营合同（2 条）");
		expect(out.text).toContain("#### 项目管理系统 / 合同管理 / 合同变更（1 条）");
		expect(out.text).toContain("| A \\| B |");
		expect(out.text).toContain("| --- | --- | --- | --- | --- | --- |");
		// 清单档不带步骤正文
		expect(out.text).not.toContain("预期 1");
	});

	it("超过上限时截断并提示分批", () => {
		const many = Array.from({ length: BRIEF_LIMITS.list + 5 }, (_, i) => makeCase(i + 1, { id: `x${i}` }));
		const out = buildBrief({ cases: many, format: "list" });
		expect(out.count).toBe(BRIEF_LIMITS.list);
		expect(out.cut).toBe(5);
		expect(out.text).toContain(`本次只带前 ${BRIEF_LIMITS.list} 条，其余请分批引入`);
	});

	it("卡片档上限更低（20 条）", () => {
		const many = Array.from({ length: 25 }, (_, i) => makeCase(i + 1, { id: `y${i}` }));
		const out = buildBrief({ cases: many, format: "card" });
		expect(out.count).toBe(BRIEF_LIMITS.card);
		expect(out.cut).toBe(5);
	});
});

describe("末尾指令与锚点", () => {
	it("默认追加「执行测试」指令", () => {
		const out = buildBrief({ cases: [makeCase(1)] });
		expect(out.intent).toBe("run");
		expect(
			out.text
				.trimEnd()
				.endsWith(
					"失败时说明根因假设。执行完把结论用 data_space_record_result 回写（可以把末尾锚点整段传进去定位这批用例）。",
				),
		).toBe(true);
	});

	it("五种指令可切换，「不加指令」不留尾巴", () => {
		const review = buildBrief({ cases: [makeCase(1)], intent: "review" });
		expect(review.text).toContain("请评审上述用例");
		const none = buildBrief({ cases: [makeCase(1)], intent: "none" });
		expect(none.intent).toBe("none");
		expect(none.text).not.toContain("请按上述用例依次执行");
		expect(none.text.trimEnd().endsWith("-->")).toBe(true);
	});

	it("未知指令回落到默认，不抛错", () => {
		expect(buildBrief({ cases: [makeCase(1)], intent: "nope" }).intent).toBe("run");
	});

	it("锚点带 revision 与全部用例 id", () => {
		const out = buildBrief({ cases: [makeCase(1), makeCase(2)], format: "list" });
		expect(out.text).toContain("<!-- data-space: revision=49 cases=c1,c2 -->");
	});

	it("字数为正且随内容增长", () => {
		const one = buildBrief({ cases: [makeCase(1)] });
		const two = buildBrief({ cases: [makeCase(1), makeCase(2)] });
		expect(one.chars).toBe(one.text.length);
		expect(two.chars).toBeGreaterThan(one.chars);
		expect(fmtChars(999)).toBe("999");
		expect(fmtChars(1300)).toBe("1.3k");
	});

	it("空范围产出空文本，不产出半截标题", () => {
		const out = buildBrief({ cases: [] });
		expect(out.text).toBe("");
		expect(out.count).toBe(0);
	});
});

describe("脱敏", () => {
	it("键值型口令与 Bearer 令牌被打成 ***", () => {
		expect(maskSecrets("password: p@ssw0rd")).toBe("password: ***");
		expect(maskSecrets("密码：123456")).toBe("密码：***");
		expect(maskSecrets("Authorization: Bearer abcdefghijkl")).toContain("***");
	});

	it("默认脱敏，关掉后原样输出", () => {
		const c = makeCase(1, { steps: [{ id: "s", action: "用 token: abc123 登录", expect: "登录成功" }] });
		expect(buildBrief({ cases: [c] }).text).toContain("用 token: *** 登录");
		expect(buildBrief({ cases: [c], redact: false }).text).toContain("用 token: abc123 登录");
	});

	it("数据集只带名称，记录取值不进文本", () => {
		const out = buildBrief({ cases: [makeCase(1)] });
		expect(out.text).toContain("经营合同-新建参数");
		expect(out.text).not.toContain("p@ssw0rd");
	});
});

describe("去重", () => {
	it("标记后同 revision 算已引入，revision 变化后失效", () => {
		const list = [makeCase(1), makeCase(2)];
		expect(introducedCount(list)).toBe(0);
		markIntroduced(list, S.revision);
		expect(isIntroduced(list[0])).toBe(true);
		expect(introducedCount(list)).toBe(2);

		applyStore({ ...store(list), revision: 50 });
		expect(isIntroduced(list[0])).toBe(false);
		expect(introducedCount(list)).toBe(0);
	});

	it("引入记录带时间戳，可给悬浮提示用", () => {
		const c = makeCase(1);
		markIntroduced([c], S.revision);
		expect(S.introduced.get(c.id)?.at).toBeGreaterThan(0);
	});
});

describe("注入", () => {
	const install = (api: Record<string, unknown>) => {
		(globalThis as Record<string, unknown>).__piWebUiHost = api;
	};

	it("宿主支持 compose 时放入输入框并切到对话", async () => {
		const compose = vi.fn(() => true);
		const setView = vi.fn();
		install({ compose, setView });
		const res = await composeBrief("hello");
		expect(res).toEqual({ ok: true, via: "composer" });
		expect(compose).toHaveBeenCalledWith({ text: "hello" });
		expect(setView).toHaveBeenCalledWith("chat");
	});

	it("compose 拒收（输入框没就绪）时退回剪贴板", async () => {
		install({ compose: () => false });
		const writeText = vi.fn(async () => {});
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		try {
			const res = await composeBrief("hello");
			expect(res.via).toBe("clipboard");
			expect(writeText).toHaveBeenCalledWith("hello");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("宿主不支持且剪贴板不可用时如实返回失败", async () => {
		vi.stubGlobal("navigator", {});
		try {
			expect(await composeBrief("hello")).toEqual({ ok: false, via: "none" });
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("compose 抛错时不把错误抛给调用方", async () => {
		install({
			compose: () => {
				throw new Error("boom");
			},
		});
		const writeText = vi.fn(async () => {});
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		try {
			expect((await composeBrief("hello")).via).toBe("clipboard");
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
