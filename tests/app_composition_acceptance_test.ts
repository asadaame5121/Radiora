import { assertEquals } from "jsr:@std/assert@1";
import ts from "typescript";

// Structural acceptance gates complement the browser tests. They enforce only the
// Issue's forbidden responsibilities, without prescribing future owner/module names.
const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const script = app.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
if (script === undefined) throw new Error("App's instance script was not found");
const source = ts.createSourceFile("App.ts", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function collect(predicate: (node: ts.Node) => boolean): string[] {
	const matches: string[] = [];
	function visit(node: ts.Node): void {
		if (predicate(node)) matches.push(node.getText(source));
		ts.forEachChild(node, visit);
	}
	visit(source);
	return matches;
}

function callsIdentifier(node: ts.Node, name: string): node is ts.CallExpression {
	return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
}

Deno.test("#312 App delegates preference writing instead of owning the layout storage writer", () => {
	assertEquals(collect((node) => callsIdentifier(node, "saveUiLayoutPreference")), []);
});

Deno.test("#312 resize gesture listeners belong to the Layout View lifetime, not App", () => {
	assertEquals(collect((node) => {
		if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
		if (node.expression.name.text !== "addEventListener") return false;
		const event = node.arguments[0];
		return event !== undefined && ts.isStringLiteral(event) && /^pointer(move|up|cancel)$/.test(event.text);
	}), []);
});

Deno.test("#313 App does not own dialog license result, error, loading or open state", () => {
	assertEquals(collect((node) =>
		ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /license/i.test(node.name.text) &&
		node.initializer !== undefined && callsIdentifier(node.initializer, "$state")
	), []);
});

Deno.test("#313 App delegates license acquisition instead of fetching dialog data", () => {
	assertEquals(collect((node) => callsIdentifier(node, "fetchLicenseIndex") || callsIdentifier(node, "fetch")), []);
});

Deno.test("#314 App API connections are single-expression port delegation, not feature workflows", () => {
	assertEquals(collect((node) => {
		if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
		if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "api") return false;
		// Operation logging observes the composition root; it neither loads nor mutates feature state.
		if (["recordViewChange", "recordClientOperation"].includes(node.expression.name.text)) return false;
		return !(ts.isArrowFunction(node.parent) && node.parent.body === node);
	}), []);
});

Deno.test("#314 App has no format-specific file reading or download procedure", () => {
	assertEquals(collect((node) => {
		if (callsIdentifier(node, "Blob")) return true;
		if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Blob") return true;
		if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
		const target = node.expression.expression;
		return (ts.isIdentifier(target) && target.text === "file" && node.expression.name.text === "text") ||
			(ts.isIdentifier(target) && target.text === "URL" && ["createObjectURL", "revokeObjectURL"].includes(node.expression.name.text));
	}), []);
});
