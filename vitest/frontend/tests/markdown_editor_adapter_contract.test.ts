import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("Markdown editor adapter isolates Overtype and preserves host editing invariants", async () => {
	const boundary = await readFile(
		new URL("../../../src/ui/markdown_editor_adapter.ts", import.meta.url),
		"utf8",
	);
	const adapter = await readFile(
		new URL("../../../src/ui/overtype_markdown_editor_adapter.ts", import.meta.url),
		"utf8",
	);
	const component = await readFile(
		new URL("../../../src/ui/MarkdownEditor.svelte", import.meta.url),
		"utf8",
	);
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const styles = await readFile(new URL("../../../src/ui/styles.css", import.meta.url), "utf8");

	const outlineView = await readFile(
		new URL("../../../src/ui/OutlineView.svelte", import.meta.url),
		"utf8",
	);
	const outlineRowItem = await readFile(
		new URL("../../../src/ui/OutlineRowItem.svelte", import.meta.url),
		"utf8",
	);

	if (/from "overtype"/.test(boundary)) {
		throw new Error("The host MarkdownEditorAdapter boundary must not expose Overtype types");
	}
	expect(adapter).toMatch(/from "overtype"/);
	expect(adapter).toMatch(/autoResize: false/);
	expect(adapter).toMatch(/smartLists: false/);
	expect(adapter).toMatch(/#suppressChange/);
	expect(adapter).toMatch(/#generation/);
	expect(adapter).toMatch(/#compositionGuard/);
	expect(adapter).toMatch(/compositionend/);
	expect(adapter).toMatch(/onBlur/);
	expect(adapter).toMatch(/this\.#options\.onBlur\?\.\(this\.textarea\)/);
	expect(adapter).toMatch(/this\.#instance\.linkTooltip\?\.destroy\?\.\(\)/);
	expect(adapter).toMatch(/for \(const cleanup of this\.#cleanup\.splice\(0\)\) cleanup\(\)/);
	expect(adapter).toMatch(/preview\.setAttribute\("role", "button"\)/);
	expect(adapter).toMatch(/preview\.setAttribute\("tabindex", "0"\)/);
	expect(adapter).toMatch(/preview\.setAttribute\("aria-label"/);
	expect(adapter).toMatch(/event\.key !== "Enter" && event\.key !== " "/);
	expect(adapter).toMatch(/this\.#instance\.focus\(\)/);
	expect(adapter).toMatch(/new TextareaMarkdownEditorAdapter\(options\)/);
	expect(adapter).toMatch(
		/container\.style\.setProperty\("--text", "var\(--radiora-editor-text\)"\)/,
	);
	expect(adapter).toMatch(
		/container\.style\.setProperty\("--text-primary", "var\(--radiora-editor-text\)"\)/,
	);
	expect(adapter).toMatch(/this\.textarea\.removeAttribute\("placeholder"\)/);
	expect(component).toMatch(/\$effect\(\(\) =>/);
	expect(component).toMatch(/current\.setValue\(next\)/);
	expect(component).toMatch(/adapter\?\.destroy\(\)/);
	expect(component).toMatch(/let mode = \$state<MarkdownEditorMode>\("preview"\)/);
	expect(component).toMatch(/changeMode\("plain"\)/);
	expect(component).toMatch(/changeMode\("preview"\)/);
	expect(component).toMatch(/adapter\?\.focus\(\)/);
	expect(app).toMatch(/compositionGuard \|\| event\.isComposing \|\| event\.keyCode === 229/);
	expect(outlineView).toMatch(
		/role="tree"[\s\S]*?aria-label=\{`\$\{vocabulary\.work\}のアウトライン`\}[\s\S]*?tabindex="0"/,
	);
	expect(component).toMatch(/\.markdown-editor-host :global\(\.overtype-container\) \{/);
	expect(component).toMatch(
		/\.markdown-editor-host :global\(\.overtype-input::placeholder\) \{[\s\S]*?color: transparent !important;/,
	);
	expect(component).toMatch(/--radiora-editor-text: var\(--text\)/);
	expect(component).toMatch(/--preview-text-default: var\(--radiora-editor-text\)/);
	expect(component).toMatch(/color: var\(--radiora-editor-text\)/);
});

test("Markdown editor keeps native replacement, autosave, completion, and resolver paths", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const outlineRowItem = await readFile(
		new URL("../../../src/ui/OutlineRowItem.svelte", import.meta.url),
		"utf8",
	);
	const controller = await readFile(
		new URL("../../../src/ui/editor_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const completion = await readFile(
		new URL("../../../src/ui/editor_completion_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const adapter = await readFile(
		new URL("../../../src/ui/overtype_markdown_editor_adapter.ts", import.meta.url),
		"utf8",
	);

	expect(outlineRowItem).toMatch(/<MarkdownEditor/);
	expect(outlineRowItem).toMatch(/onChange=.*handlers\.updateLocalText/);
	expect(outlineRowItem).toMatch(/onSelectionChange=.*handlers\.updateEditorSelection/);
	expect(completion).toMatch(/textarea\.setRangeText\(/);
	expect(completion).toMatch(/inputType: "insertReplacementText"/);
	expect(controller).toMatch(
		/autosave\.queue\(item\.workId, item\.revisionSelector\.branchId, id, text\)/,
	);
	expect(controller).toMatch(/updateInternalReferenceCompletion\(id, textarea\)/);
	expect(controller).toMatch(/resolveInternalReferences\(markdown\)/);
	expect(adapter).toMatch(/recoverRadioraDestination/);
	expect(adapter).toMatch(/\.url-part/);
	expect(adapter).toMatch(/event\.stopImmediatePropagation\(\)/);
});

test("Overtype imports stay inside the UI adapter implementation", async () => {
	const files = [
		"../../../src/domain/models.ts",
		"../../../src/shared/bindings.ts",
		"../../../src/storage/graph_store.ts",
		"../../../src/ui/markdown_editor_adapter.ts",
	];
	for (const file of files) {
		const source = await readFile(new URL(file, import.meta.url), "utf8");
		if (/from ["']overtype["']/.test(source)) {
			throw new Error(`Overtype leaked across the adapter boundary: ${file}`);
		}
	}
});
