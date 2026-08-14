import { assert, assertMatch, assertNotMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const navigation = await Deno.readTextFile(
	new URL("../src/ui/PrimaryNavigation.svelte", import.meta.url),
);
const navigationStyles = navigation.slice(navigation.indexOf("<style>"));
const navigationController = await Deno.readTextFile(
	new URL("../src/ui/navigation_controller.svelte.ts", import.meta.url),
);
const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));
const overtype = await Deno.readTextFile(
	new URL("../src/ui/overtype_markdown_editor_adapter.ts", import.meta.url),
);

Deno.test("Omniwindow shares the quick-capture command value with search", () => {
	assertNotMatch(app, /let searchQuery/);
	assertMatch(app, /bind:value=\{navigationController\.quickCaptureText\}/);
	assertMatch(app, /oninput=\{\(\) => navigationController\.queueSearch\(\)\}/);
	assertMatch(app, /suggestItems: \(prefix, limit\) => api\.suggestItems\(prefix, limit\)/);
	assertMatch(app, /searchItems: \(request\) => api\.searchItems\(request\)/);
	assertMatch(app, /getSelectedId: \(\) => selectedId/);
	assertMatch(app, /reportError: \(cause\) => error = errorMessage\(cause\)/);
	assertMatch(app, /const searchEntries = \$derived\(navigationController\.searchEntries\)/);
	assertMatch(app, /const omniEntryCount = \$derived\(navigationController\.omniEntryCount\)/);
	assertMatch(app, /event\.key === "Enter" && event\.shiftKey/);
	assertMatch(app, /event\.isComposing/);
	assertMatch(app, /const exactMatchIndex = searchEntries\.findIndex/);
	assertMatch(app, /navigationController\.moveSearchActiveIndex\(delta\)/);
	assertMatch(app, /searchActiveIndex === searchEntries\.length/);
	assertMatch(app, /executeCommand\("quickCapture"\)/);
	assertMatch(app, /quickCaptureDestinationLabel/);
	assertMatch(app, /vocabulary\.quickCaptureDestinationRoot/);
	assertMatch(app, /vocabulary\.quickCaptureDestinationUnplaced/);
	assertNotMatch(app, /let suggestTimer/);
	assertNotMatch(app, /let searchTimer/);
	assertNotMatch(app, /let searchRequestId/);

	assertMatch(navigationController, /let quickCaptureText = \$state\(""\)/);
	assertMatch(navigationController, /let suggestions = \$state<Suggestion\[\]>\(\[\]\)/);
	assertMatch(navigationController, /let searchResults = \$state<SearchResult\[\]>\(\[\]\)/);
	assertMatch(navigationController, /let searchActiveIndex = \$state\(-1\)/);
	assertMatch(navigationController, /queueSearch\(\): void/);
	assertMatch(navigationController, /port\.suggestItems\(query, 8\)/);
	assertMatch(navigationController, /port\.searchItems\(\{/);
	assertMatch(navigationController, /const requestId = \+\+searchRequestId/);
	assertMatch(navigationController, /clearOmniwindow\(\): void/);
	assertMatch(navigationController, /get searchEntries\(\)/);
	assertMatch(navigationController, /get omniEntryCount\(\)/);
	assertNotMatch(navigationController, /executeCommand\(/);
	assertNotMatch(navigationController, /selectItem\(/);
});

Deno.test("shell keeps global navigation, contextual inspector, and dedicated full-width views separate", () => {
	for (const label of ["作業", "探索", "管理", "ツール"]) {
		assert(navigation.includes(label));
	}
	for (const label of ["アウトライン", "ゴミ箱"]) {
		assert(app.includes(label));
	}
	for (const tab of [">概要</button>", ">関係</button>", ">履歴</button>"]) {
		assert(app.includes(tab));
	}
	assertMatch(navigation, /<nav class="primary-nav"/);
	assertMatch(navigation, /<button type="button"[^>]*>\{vocabulary\.today\}<\/button>/);
	assertMatch(app, /class:full-workspace=\{dedicatedView\}/);
	assertMatch(app, /\{#if !dedicatedView\}\s*<aside[^>]*class="inspector">/);
	assertMatch(app, /<div class="work-lineage-workspace">/);
	assertMatch(styles, /\.shell > \.top-bar/);
	assertMatch(styles, /\.app-main > \.inspector/);
	assertNotMatch(styles, /^header\s*\{/m);
	assertNotMatch(styles, /^aside\s*\{/m);
});

Deno.test("left and right sidebars are collapsible", () => {
	assertMatch(app, /let navCollapsed = \$state\(initialUiLayoutPreference\.navCollapsed\)/);
	assertMatch(app, /class="shell" class:nav-collapsed=\{navCollapsed\}/);
	assertMatch(app, /<PrimaryNavigation/);
	assertMatch(app, /onToggleCollapse=\{toggleNavigation\}/);
	assertMatch(navigation, /class="primary-nav" class:nav-collapsed=\{collapsed\}/);
	assertMatch(navigation, /class="nav-collapse-toggle"/);
	assertMatch(navigation, /aria-expanded=\{!collapsed\}/);
	assertMatch(navigation, /onclick=\{onToggleCollapse\}/);
	assertMatch(
		app,
		/saveUiLayoutPreference\(\{ navCollapsed, inspectorCollapsed, inspectorWidth \}\)/,
	);
	assertMatch(styles, /\.shell\.nav-collapsed \{\s*grid-template-columns: 42px minmax\(0, 1fr\);/);
	assertMatch(
		navigationStyles,
		/\.primary-nav\.nav-collapsed \.brand,\s*\.primary-nav\.nav-collapsed section \{\s*display: none;/,
	);
	assertMatch(app, /inspector-close/);
	assertMatch(app, /inspectorCollapsed = true/);
	assertMatch(app, /async function toggleInspector/);
	assertMatch(app, /class="inspector-jump"/);
	assertMatch(app, /aria-expanded=\{!inspectorCollapsed\}/);
	assertMatch(app, /onclick=\{toggleInspector\}/);
	assertMatch(styles, /\.inspector-jump \{\s*display: block;/);
});

Deno.test("outline editors use an explicit dark Overtype theme and compact idle rows", () => {
	assertMatch(overtype, /theme: "cave"/);
	assertMatch(styles, /\.markdown-editor-host\s*\{[\s\S]*?height: 34px/);
	assertMatch(styles, /\.row\.selected \.markdown-editor-host/);
	assert(styles.includes("background: transparent !important"));
});
