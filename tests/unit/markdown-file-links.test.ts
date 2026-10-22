import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "../../web/src/components/Markdown.js";
import { fileLinkPath } from "../../web/src/file-link.js";

const render = (text: string) => renderToStaticMarkup(createElement(MarkdownBody, { text }));

describe("Markdown local file previews", () => {
	it.each([
		"[测试工作流](/Users/example/project/.pi/skills/api-test-workflow/SKILL.md)",
		"[测试工作流](./.pi/skills/api-test-workflow/SKILL.md)",
		"[设计](docs/design.md)",
		"查看 @src/App.tsx",
		"[文件](pi-file://docs%2Fdesign.md)",
	])("routes local links to the preview instead of page navigation: %s", (text) => {
		expect(render(text)).toContain('class="file-pill"');
	});

	it.each(["https://example.com/a.md", "mailto:test@example.com", "tel:123", "#section", "//example.com/a.md"])(
		"preserves non-file destinations: %s",
		(href) => expect(render(`[链接](${href})`)).not.toContain('class="file-pill"'),
	);

	it.each(["javascript:alert(1)", "data:text/html,test", "vscode://file/test.md"])(
		"does not allow unsafe/custom navigation: %s",
		(href) => {
			const html = render(`[链接](${href})`);
			expect(html).not.toContain(href);
			expect(html).not.toContain('class="file-pill"');
		},
	);
});

describe("file link paths", () => {
	it.each([
		["./.pi/skills/api-test-workflow/SKILL.md", ".pi/skills/api-test-workflow/SKILL.md"],
		["./docs/../docs/design.md:12:3", "docs/design.md"],
		["/Users/example/测试%20目录/SKILL.md#L10-L20", "/Users/example/测试 目录/SKILL.md"],
		["file:///Users/example/readme.md", "/Users/example/readme.md"],
		["file:///C:/project/test.md", "C:/project/test.md"],
		["C:/project/test.md:12", "C:/project/test.md"],
		["pi-file://docs%2Fa%23b.md", "docs/a#b.md"],
		["../outside.md", "../outside.md"],
		[".gitignore", ".gitignore"],
	])("normalizes %s for response matching", (href, expected) => expect(fileLinkPath(href)).toBe(expected));

	it.each([
		"https://example.com/a.md",
		"//host/a.md",
		"file://host/a.md",
		"javascript:alert(1)",
		"#heading",
		"docs/",
		"pi-file://%00bad.md",
		"pi-file://%ZZ",
		"pi-file://%2F%2Fhost%2Fa.md",
	])("rejects nonlocal or invalid paths: %s", (href) => expect(fileLinkPath(href)).toBeNull());

	it("retains the raw HTML sanitizer while allowing internal previews", () => {
		const html = renderToStaticMarkup(
			createElement(MarkdownBody, {
				text: '查看 @src/App.tsx <a href="javascript:alert(1)">bad</a><script>bad()</script>',
				rawHtml: true,
			}),
		);
		expect(html).toContain('class="file-pill"');
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("<script");
	});
});
