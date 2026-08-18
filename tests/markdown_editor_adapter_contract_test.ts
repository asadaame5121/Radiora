import { assertMatch } from "jsr:@std/assert@1";

Deno.test("Markdown editor adapter isolates Overtype and preserves host editing invariants", async () => {
	const boundary = await Deno.readTextFile(
		new URL("../src/ui/markdown_editor_adapter.ts", import.meta.url),
	);
	const adapter = await Deno.readTextFile(
		new URL("../src/ui/overtype_markdown_editor_adapter.ts", import.meta.url),
	);
	const component = await Deno.readTextFile(
		new URL("../src/ui/MarkdownEditor.svelte", import.meta.url),
	);
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));

	if (/from "overtype"/.test(boundary)) {
		throw new Error("The host MarkdownEditorAdapter boundary must not expose Overtype types");
	}
	assertMatch(adapter, /from "overtype"/);
	assertMatch(adapter, /autoResize: false/);
	assertMatch(adapter, /smartLists: false/);
	assertMatch(adapter, /#suppressChange/);
	assertMatch(adapter, /#generation/);
	assertMatch(adapter, /#compositionGuard/);
	assertMatch(adapter, /compositionend/);
	assertMatch(adapter, /onBlur/);
	assertMatch(adapter, /this\.#options\.onBlur\?\.\(this\.textarea\)/);
	assertMatch(adapter, /this\.#instance\.linkTooltip\?\.destroy\?\.\(\)/);
	assertMatch(adapter, /for \(const cleanup of this\.#cleanup\.splice\(0\)\) cleanup\(\)/);
	assertMatch(adapter, /preview\.setAttribute\("role", "button"\)/);
	assertMatch(adapter, /preview\.setAttribute\("tabindex", "0"\)/);
	assertMatch(adapter, /preview\.setAttribute\("aria-label"/);
	assertMatch(adapter, /event\.key !== "Enter" && event\.key !== " "/);
	assertMatch(adapter, /this\.#instance\.focus\(\)/);
	assertMatch(adapter, /new TextareaMarkdownEditorAdapter\(options\)/);
	assertMatch(component, /\$effect\(\(\) =>/);
	assertMatch(component, /current\.setValue\(next\)/);
	assertMatch(component, /adapter\?\.destroy\(\)/);
	assertMatch(component, /let mode = \$state<MarkdownEditorMode>\("preview"\)/);
	assertMatch(component, /changeMode\("plain"\)/);
	assertMatch(component, /changeMode\("preview"\)/);
	assertMatch(component, /adapter\?\.focus\(\)/);
	assertMatch(app, /compositionGuard \|\| event\.isComposing \|\| event\.keyCode === 229/);
	assertMatch(
		app,
		/role="tree" aria-label=\{`\$\{vocabulary\.work\}のアウトライン`\} tabindex="0"/,
	);
	assertMatch(component, /\.markdown-editor-host :global\(\.overtype-container\) \{/);
	assertMatch(component, /--preview-text-default: var\(--text\)/);
});

Deno.test("Markdown editor keeps native replacement, autosave, completion, and resolver paths", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const controller = await Deno.readTextFile(
		new URL("../src/ui/editor_controller.svelte.ts", import.meta.url),
	);
	const adapter = await Deno.readTextFile(
		new URL("../src/ui/overtype_markdown_editor_adapter.ts", import.meta.url),
	);

	assertMatch(app, /<MarkdownEditor/);
	assertMatch(app, /onChange=.*updateLocalText/);
	assertMatch(app, /onSelectionChange=.*updateEditorSelection/);
	assertMatch(controller, /textarea\.setRangeText\(/);
	assertMatch(controller, /inputType: "insertReplacementText"/);
	assertMatch(
		controller,
		/autosave\.queue\(item\.workId, item\.revisionSelector\.branchId, id, text\)/,
	);
	assertMatch(controller, /updateInternalReferenceCompletion\(id, textarea\)/);
	assertMatch(controller, /resolveInternalReferences\(markdown\)/);
	assertMatch(adapter, /recoverRadioraDestination/);
	assertMatch(adapter, /\.url-part/);
	assertMatch(adapter, /event\.stopImmediatePropagation\(\)/);
});

Deno.test("Overtype imports stay inside the UI adapter implementation", async () => {
	const files = [
		"../src/domain/models.ts",
		"../src/shared/bindings.ts",
		"../src/storage/graph_store.ts",
		"../src/ui/markdown_editor_adapter.ts",
	];
	for (const file of files) {
		const source = await Deno.readTextFile(new URL(file, import.meta.url));
		if (/from ["']overtype["']/.test(source)) {
			throw new Error(`Overtype leaked across the adapter boundary: ${file}`);
		}
	}
});
