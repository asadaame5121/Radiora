import { assert, assertMatch } from "jsr:@std/assert@1";

const inspector = await Deno.readTextFile(
	new URL("../src/ui/InspectorView.svelte", import.meta.url),
);
const queryPanel = await Deno.readTextFile(
	new URL("../src/ui/InspectorQueryPanel.svelte", import.meta.url),
);

Deno.test("Inspector uses horizontal automatic Bits Tabs for the three tab screens", () => {
	assertMatch(inspector, /import \{ Tabs \} from "bits-ui"/);
	assertMatch(inspector, /<Tabs\.Root/);
	assertMatch(inspector, /orientation="horizontal"/);
	assertMatch(inspector, /activationMode="automatic"/);
	assertMatch(inspector, /<Tabs\.List aria-label="詳細表示">/);
	assertMatch(inspector, /<Tabs\.Trigger value="overview">/);
	assertMatch(inspector, /<Tabs\.Trigger value="relation">/);
	assertMatch(inspector, /<Tabs\.Trigger value="history">/);
	assertMatch(inspector, /<Tabs\.Content value="overview">/);
	assertMatch(inspector, /<Tabs\.Content value="relation">/);
	assertMatch(inspector, /<Tabs\.Content value="history">/);
});

Deno.test("Inspector forwards Bits tab props and keeps active state controlled by App", () => {
	assertMatch(inspector, /<nav \{\.\.\.props\} class="aside-tabs" aria-label="詳細表示">/);
	assertMatch(
		inspector,
		/<button \{\.\.\.triggerProps\} type="button" class=\{tabValue === "overview" \? "active" : ""\}>概要<\/button>/,
	);
	assertMatch(inspector, /value=\{tabValue\}/);
	assertMatch(inspector, /onValueChange=\{handleTabChange\}/);
	assert(!inspector.includes("onkeydown"), "Inspector does not replace Bits keyboard handling");
});

Deno.test("Inspector keeps query mode outside the Tabs model", () => {
	const queryBranch = inspector.search(
		/\{#if (?:props\.)?selectedItem && (?:props\.)?asideMode === "query"\}/,
	);
	const tabsRoot = inspector.indexOf("<Tabs.Root");
	assert(queryBranch >= 0, "query branch exists");
	assert(tabsRoot > queryBranch, "Tabs are rendered after the query branch");
	assertMatch(inspector, /<InspectorQueryPanel/);
	assertMatch(queryPanel, /<div class="query-panel">/);
});

Deno.test("App delegates Inspector state and callbacks to the extracted View", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	assertMatch(app, /<InspectorView/);
	assertMatch(app, /onAsideModeChange=\{\(mode\) => asideMode = mode\}/);
	assertMatch(app, /onStartResize=\{startInspectorResize\}/);
	assertMatch(app, /onUpdateSelectedHeading=\{updateSelectedHeading\}/);
	assertMatch(app, /onResolveEmergence=\{resolveEmergence\}/);
});
