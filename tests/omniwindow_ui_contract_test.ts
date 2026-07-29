import { assert, assertMatch, assertNotMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));
const overtype = await Deno.readTextFile(
	new URL("../src/ui/overtype_markdown_editor_adapter.ts", import.meta.url),
);

Deno.test("Omniwindow shares the quick-capture command value with search", () => {
	assertNotMatch(app, /let searchQuery/);
	assertMatch(app, /bind:value=\{quickCaptureText\}/);
	assertMatch(app, /api\.suggestItems\(quickCaptureText, 8\)/);
	assertMatch(app, /api\.searchItems\(\{ query: quickCaptureText/);
	assertMatch(app, /event\.key === "Enter" && event\.shiftKey/);
	assertMatch(app, /event\.isComposing/);
	assertMatch(app, /const exactMatchIndex = searchEntries\.findIndex/);
	assertMatch(app, /searchRequestId\+\+/);
	assertMatch(app, /searchActiveIndex === searchEntries\.length/);
	assertMatch(app, /executeCommand\("quickCapture"\)/);
	assertMatch(app, /を未配置箱へ作成/);
});

Deno.test("shell keeps global navigation, contextual inspector, and dedicated full-width views separate", () => {
	for (const label of ["作業", "探索", "管理", "アウトライン", "ゴミ箱", "ツール"]) {
		assert(app.includes(label));
	}
	for (const tab of [">概要</button>", ">関係</button>", ">履歴</button>"]) {
		assert(app.includes(tab));
	}
	assertMatch(app, /class:full-workspace=\{dedicatedView\}/);
	assertMatch(app, /\{#if !dedicatedView\}\s*<aside[^>]*class="inspector">/);
	assertMatch(app, /<div class="work-lineage-workspace">/);
	assertMatch(styles, /\.shell > \.top-bar/);
	assertMatch(styles, /\.app-main > \.inspector/);
	assertNotMatch(styles, /^header\s*\{/m);
	assertNotMatch(styles, /^aside\s*\{/m);
});

Deno.test("outline editors use an explicit dark Overtype theme and compact idle rows", () => {
	assertMatch(overtype, /theme: "cave"/);
	assertMatch(styles, /\.markdown-editor-host\s*\{[\s\S]*?height: 34px/);
	assertMatch(styles, /\.row\.selected \.markdown-editor-host/);
	assert(styles.includes("background: transparent !important"));
});
