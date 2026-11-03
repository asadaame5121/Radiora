import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
const navigation = await readFile(
	new URL("../../../src/ui/PrimaryNavigation.svelte", import.meta.url),
	"utf8",
);
const navigationStyles = navigation.slice(navigation.indexOf("<style>"));
const inspector = await readFile(
	new URL("../../../src/ui/InspectorView.svelte", import.meta.url),
	"utf8",
);
const navigationController = await readFile(
	new URL("../../../src/ui/omni_search_controller.svelte.ts", import.meta.url),
	"utf8",
);
const styles = await readFile(new URL("../../../src/ui/styles.css", import.meta.url), "utf8");
const markdownEditor = await readFile(
	new URL("../../../src/ui/MarkdownEditor.svelte", import.meta.url),
	"utf8",
);
const overtype = await readFile(
	new URL("../../../src/ui/overtype_markdown_editor_adapter.ts", import.meta.url),
	"utf8",
);

const topBar = await readFile(new URL("../../../src/ui/AppTopBar.svelte", import.meta.url), "utf8");

test("Omniwindow shares the quick-capture command value with search", () => {
	expect(app).not.toMatch(/let searchQuery/);
	expect(topBar).toMatch(/value=\{quickCaptureText\}/);
	expect(topBar).toMatch(
		/oninput=\{\(event\) => onQuickCaptureInput\(event\.currentTarget\.value\)\}/,
	);
	expect(app).toMatch(/suggestItems: \(prefix, limit\) => api\.suggestItems\(prefix, limit\)/);
	expect(app).toMatch(/searchItems: \(request\) => api\.searchItems\(request\)/);
	expect(app).toMatch(/getSelectedId: \(\) => selectedId/);
	expect(app).toMatch(/reportError: \(cause\) => error = errorMessage\(cause\)/);
	expect(app).toMatch(/searchEntriesLength=\{omniController\.searchEntries.length\}/);
	expect(app).toMatch(/const omniEntryCount = \$derived\(omniController\.omniEntryCount\)/);
	expect(app).toMatch(/event\.key === "Enter" && event\.shiftKey/);
	expect(app).toMatch(/event\.isComposing/);
	expect(app).toMatch(/omniController\.enterEntry/);
	expect(app).toMatch(/omniController\.moveSearchActiveIndex\(delta\)/);
	expect(topBar).toMatch(/searchActiveIndex === searchEntriesLength/);
	expect(app).toMatch(/executeCommand\("quickCapture"\)/);
	expect(app).toMatch(/quickCaptureDestinationLabel/);
	expect(app).toMatch(/vocabulary\.quickCaptureDestinationRoot/);
	expect(app).toMatch(/vocabulary\.quickCaptureDestinationUnplaced/);
	expect(app).not.toMatch(/let suggestTimer/);
	expect(app).not.toMatch(/let searchTimer/);
	expect(app).not.toMatch(/let searchRequestId/);

	expect(navigationController).toMatch(/private liveQuickCaptureText = \$state\(""\)/);
	expect(navigationController).toMatch(/private liveSuggestions = \$state<Suggestion\[\]>\(\[\]\)/);
	expect(navigationController).toMatch(
		/private liveSearchResults = \$state<SearchResult\[\]>\(\[\]\)/,
	);
	expect(navigationController).toMatch(/private liveSearchActiveIndex = \$state\(-1\)/);
	expect(navigationController).toMatch(/queueSearch\(\): void/);
	expect(navigationController).toMatch(/port\.suggestItems\(query, SUGGESTION_LIMIT\)/);
	expect(navigationController).toMatch(/port\.searchItems\(\{/);
	expect(navigationController).toMatch(/const requestId = \+\+this\.searchRequestId/);
	expect(navigationController).toMatch(/clearOmniwindow\(\): void/);
	expect(navigationController).toMatch(/get searchEntries\(\)/);
	expect(navigationController).toMatch(/get omniEntryCount\(\)/);
	expect(navigationController).not.toMatch(/executeCommand\(/);
	expect(navigationController).not.toMatch(/selectItem\(/);
});

test("shell keeps global navigation, contextual inspector, and dedicated full-width views separate", () => {
	for (const label of ["作業", "探索", "ツール"]) {
		expect(navigation.includes(label)).toBeTruthy();
	}
	expect(topBar.includes("アウトライン")).toBeTruthy();
	expect(navigation).not.toMatch(/>ゴミ箱<\/button>/);
	for (const tab of [">概要</button>", ">関係</button>", ">履歴</button>"]) {
		expect(inspector.includes(tab)).toBeTruthy();
	}
	expect(navigation).toMatch(/<nav class="primary-nav"/);
	expect(navigation).toMatch(/<button type="button"[^>]*>\{vocabulary\.today\}<\/button>/);
	expect(app).toMatch(/class:full-workspace=\{dedicatedView\}/);
	expect(app).toMatch(/\{#if !dedicatedView\}\s*<InspectorView/);
	expect(inspector).toMatch(/<aside bind:this=\{inspectorElement\} class="inspector">/);
	expect(app).toMatch(/<div class="work-lineage-workspace">/);
	expect(topBar).toMatch(/\.top-bar \{/);
	expect(styles).toMatch(/\.app-main > \.inspector/);
	expect(styles).not.toMatch(/^header\s*\{/m);
	expect(styles).not.toMatch(/^aside\s*\{/m);
});

test("left and right sidebars are collapsible", () => {
	expect(app).toMatch(/const navCollapsed = \$derived\(layout\.navCollapsed\)/);
	expect(app).toMatch(/class="shell" class:nav-collapsed=\{navCollapsed\}/);
	expect(app).toMatch(/<PrimaryNavigation/);
	expect(app).toMatch(/onToggleCollapse=\{\(\) => layout\.toggleNavigation\(\)\}/);
	expect(navigation).toMatch(/class="primary-nav" class:nav-collapsed=\{collapsed\}/);
	expect(navigation).toMatch(/class="nav-collapse-toggle"/);
	expect(navigation).toMatch(/aria-expanded=\{!collapsed\}/);
	expect(navigation).toMatch(/onclick=\{onToggleCollapse\}/);
	expect(app).not.toMatch(/saveUiLayoutPreference\(/);
	expect(styles).toMatch(
		/\.shell\.nav-collapsed \{\s*grid-template-columns: 42px minmax\(0, 1fr\);/,
	);
	expect(styles).toMatch(/\.app-main\.inspector-collapsed > \.inspector \{\s*display: none;/);
	expect(styles).toMatch(
		/grid-template-columns: minmax\(420px, 1fr\) var\(--inspector-width, 280px\);/,
	);
	expect(navigationStyles).toMatch(
		/\.primary-nav\.nav-collapsed \.brand,\s*\.primary-nav\.nav-collapsed section \{\s*display: none;/,
	);
	expect(inspector).not.toMatch(/inspector-close/);
	expect(app).toMatch(/onToggleInspector=\{\(\) => inspectorLayout\.toggleInspector\(\)\}/);
	expect(topBar).toMatch(/class="inspector-jump"/);
	expect(topBar).toMatch(/aria-expanded=\{!inspectorCollapsed\}/);
	expect(topBar).toMatch(/onclick=\{onToggleInspector\}/);
	expect(topBar).toMatch(/\{inspectorCollapsed \? "«" : "»"\}/);
	expect(topBar).toMatch(
		/\.inspector-jump \{\s*display: grid;[\s\S]*?width: 36px;[\s\S]*?height: 36px;/,
	);
	expect(navigation).toMatch(
		/\.primary-nav \.nav-collapse-toggle \{[\s\S]*?width: 36px;[\s\S]*?height: 36px;/,
	);
});

test("outline editors use an explicit dark Overtype theme and compact idle rows", () => {
	expect(overtype).toMatch(/theme: "cave"/);
	expect(markdownEditor).toMatch(/\.markdown-editor-host\s*\{[\s\S]*?height: 34px/);
	expect(markdownEditor).toMatch(/:global\(\.row\.selected\) \.markdown-editor-host/);
	expect(markdownEditor.includes("background: transparent !important")).toBeTruthy();
});
