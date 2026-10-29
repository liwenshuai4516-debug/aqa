// Admission for the explicit single-page protocol, not a sandbox for untrusted project code.
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateRecordingSeed } from "./recording-preflight.mjs";

// Resolve the compiler API from a pinned UI runtime, never from the host's TS 7 CLI package.
// The optional e2e profile is independently locked and may coexist with a legacy root install.
/** @param {(string | URL)[]} [runtimeLocations] */
export function resolveRecordingCompiler(
	runtimeLocations = [
		import.meta.resolve("pi-ui-testing"),
		new URL("../../../../tools/e2e/package.json", import.meta.url),
	],
) {
	for (const location of runtimeLocations) {
		try {
			const runtime = createRequire(location);
			const native = createRequire(runtime.resolve("pi-ui-testing"));
			const expected = native(join(dirname(runtime.resolve("pi-ui-testing")), "../package.json")).dependencies
				.typescript;
			const compiler = native("typescript");
			if (
				compiler.version === expected &&
				typeof compiler.createSourceFile === "function" &&
				compiler.ScriptTarget?.Latest !== undefined
			)
				return compiler;
		} catch {
			// A profile may be absent. Only a fully compatible pinned runtime is accepted.
		}
	}
	throw blocked("compiler-api");
}

const blocked = (check = "admission") =>
	new Error(
		`受管采集 seed 未就绪（${check}）：核对直接 fixture、环境/归属、同一 Chromium 运行时及 trace:off；未执行 seed`,
	);
function literal(node, ts) {
	if (ts.isStringLiteral(node)) return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (node.kind === ts.SyntaxKind.NullKeyword) return null;
	if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => literal(element, ts));
	if (!ts.isObjectLiteralExpression(node)) throw blocked();
	const entries = node.properties.map((property) => {
		if (
			!ts.isPropertyAssignment(property) ||
			!property.name ||
			!(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
		)
			throw blocked();
		return [property.name.text, literal(property.initializer, ts)];
	});
	if (new Set(entries.map(([key]) => key)).size !== entries.length) throw blocked();
	return Object.fromEntries(entries);
}

/** @param {{capture:{seedRef:{path:string},project:string},captureContext:{environment:unknown,sessionId:string},snapshot:{workspace:string,childEnv:Record<string,string>,assertCurrent:()=>Promise<void>}}} prepared */
export async function validatePrivateRecordingSeed({ capture, captureContext, snapshot }) {
	let check = "runtime";
	try {
		await snapshot.assertCurrent();
		const require = createRequire(join(snapshot.workspace, "package.json"));
		const fixtureRequire = createRequire(require.resolve("pi-ui-testing/recording-fixtures"));
		if (
			(await realpath(require.resolve("@playwright/test/package.json"))) !==
			(await realpath(fixtureRequire.resolve("@playwright/test/package.json")))
		)
			throw blocked();
		check = "compiler-api";
		const ts = resolveRecordingCompiler();
		check = "syntax";
		const source = ts.createSourceFile(
			capture.seedRef.path,
			await readFile(join(snapshot.workspace, capture.seedRef.path), "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		if (source.parseDiagnostics.length) throw blocked();
		let imports = 0,
			uses = 0,
			tests = 0;
		for (const statement of source.statements) {
			check = "declaration";
			if (ts.isImportDeclaration(statement)) {
				const names = statement.importClause?.namedBindings;
				if (
					!ts.isStringLiteral(statement.moduleSpecifier) ||
					statement.moduleSpecifier.text !== "pi-ui-testing/recording-fixtures" ||
					statement.importClause?.name ||
					!names ||
					!ts.isNamedImports(names) ||
					!names.elements.some((name) => name.name.text === "test") ||
					names.elements.some((name) => name.propertyName || !["test", "expect"].includes(name.name.text))
				)
					throw blocked();
				imports++;
				continue;
			}
			if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) throw blocked();
			const call = statement.expression;
			if (
				ts.isIdentifier(call.expression) &&
				call.expression.text === "test" &&
				call.arguments.length === 2 &&
				ts.isStringLiteral(call.arguments[0]) &&
				(ts.isArrowFunction(call.arguments[1]) || ts.isFunctionExpression(call.arguments[1]))
			) {
				tests++;
				continue;
			}
			if (
				!ts.isPropertyAccessExpression(call.expression) ||
				call.expression.getText(source) !== "test.use" ||
				call.arguments.length !== 1 ||
				!ts.isObjectLiteralExpression(call.arguments[0])
			)
				throw blocked();
			const properties = call.arguments[0].properties;
			check = "options";
			if (properties.length !== 3 || properties.some((p) => !ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)))
				throw blocked();
			const options = new Map(properties.map((p) => [p.name.text, p.initializer]));
			if (
				options.size !== 3 ||
				!options.has("uiEnvironment") ||
				!options.has("uiOwner") ||
				!options.has("uiProjectRoot") ||
				!isDeepStrictEqual(literal(options.get("uiEnvironment"), ts), captureContext.environment) ||
				options.get("uiProjectRoot").getText(source).replace(/\s/g, "") !== "process.cwd()"
			)
				throw blocked();
			const owner = literal(options.get("uiOwner"), ts);
			if (
				owner.kind !== "recording" ||
				owner.id !== captureContext.sessionId ||
				typeof owner.task_id !== "string" ||
				!owner.task_id ||
				Object.keys(owner).some((key) => !["kind", "id", "task_id"].includes(key))
			)
				throw blocked();
			uses++;
		}
		if (imports !== 1 || uses !== 1 || tests !== 1) throw blocked();
		check = "fixture-usage";
		// Refuse fixture derivation/overrides hidden inside the body as well as at module level.
		const visit = (node) => {
			if (ts.isIdentifier(node) && node.text === "test" && !ts.isImportSpecifier(node.parent)) {
				const parent = node.parent;
				if (ts.isCallExpression(parent) && parent.expression === node) {
					if (!ts.isExpressionStatement(parent.parent) || parent.parent.parent !== source) throw blocked();
				} else if (!(
					ts.isPropertyAccessExpression(parent) &&
					parent.expression === node &&
					["use", "step", "info"].includes(parent.name.text) &&
					ts.isCallExpression(parent.parent) &&
					parent.parent.expression === parent &&
					(parent.name.text !== "use" || parent.parent.parent.parent === source)
				))
					throw blocked();
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
		check = "collection";
		const collected = await validateRecordingSeed(
			snapshot.workspace,
			{ project: capture.project, seedFile: capture.seedRef.path },
			snapshot.childEnv,
		);
		if (collected.project.browserName !== "chromium" || collected.project.trace !== "off") throw blocked();
		await snapshot.assertCurrent();
	} catch {
		throw blocked(check);
	}
}
