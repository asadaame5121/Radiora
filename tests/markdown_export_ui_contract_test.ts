import { assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

Deno.test("Markdown export flushes edits, renders the active snapshot, and downloads UTF-8 Markdown", () => {
	assertMatch(
		app,
		/async function performMarkdownExport\(\): Promise<void> \{[\s\S]*?await autosave\.flush\(\);[\s\S]*?renderOutlineSnapshotMarkdown\(snapshot\)/,
	);
	assertMatch(app, /new Blob\(\[markdown\], \{ type: "text\/markdown;charset=utf-8" \}\)/);
	assertMatch(app, /anchor\.download = `radiora-\$\{localDateValue\(new Date\(\)\)\}\.md`/);
	assertMatch(
		app,
		/document\.body\.append\(anchor\);[\s\S]*?anchor\.click\(\);[\s\S]*?anchor\.remove\(\);/,
	);
	assertMatch(app, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/);
	assertMatch(app, /case "exportMarkdown": await performMarkdownExport\(\)/);
});

Deno.test("Markdown export has a visible command button and success notification", () => {
	assertMatch(app, /onclick=\{exportMarkdown\}/);
	assertMatch(app, /disabled=\{!commands\.exportMarkdown\.enabled\}/);
	assertMatch(app, /<small class="markdown-export-notice" role="status">/);
	assertMatch(app, /Markdownをエクスポートしました。/);
	assertMatch(app, /Markdownをエクスポートできませんでした/);
});
