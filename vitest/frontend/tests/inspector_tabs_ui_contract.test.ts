import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
const inspector = await readFile(
	new URL("../../../src/ui/InspectorView.svelte", import.meta.url),
	"utf8",
);
const history = await readFile(
	new URL("../../../src/ui/InspectorHistoryTab.svelte", import.meta.url),
	"utf8",
);

test("Inspector uses horizontal automatic Bits Tabs for the three tab screens", () => {
	expect(inspector).toMatch(/import \{ Tabs \} from "bits-ui"/);
	expect(inspector).toMatch(/<Tabs\.Root/);
	expect(inspector).toMatch(/orientation="horizontal"/);
	expect(inspector).toMatch(/activationMode="automatic"/);
	expect(inspector).toMatch(/<Tabs\.List aria-label="詳細表示">/);
	expect(inspector).toMatch(/<Tabs\.Trigger value="overview">/);
	expect(inspector).toMatch(/<Tabs\.Trigger value="relation">/);
	expect(inspector).toMatch(/<Tabs\.Trigger value="history">/);
	expect(inspector).toMatch(/<Tabs\.Content value="overview">/);
	expect(inspector).toMatch(/<Tabs\.Content value="relation">/);
	expect(inspector).toMatch(/<Tabs\.Content value="history">/);
});

test("Inspector forwards Bits tab props and keeps active state controlled by Layout", () => {
	expect(inspector).toMatch(/<nav \{\.\.\.props\} class="aside-tabs" aria-label="詳細表示">/);
	expect(inspector).toMatch(
		/<button \{\.\.\.triggerProps\} type="button" class=\{tabValue === "overview" \? "active" : ""\}>概要<\/button>/,
	);
	expect(inspector).toMatch(/value=\{tabValue\}/);
	expect(inspector).toMatch(/onValueChange=\{handleTabChange\}/);
	expect(
		!inspector.includes("onkeydown"),
		"Inspector does not replace Bits keyboard handling",
	).toBeTruthy();
});

test("Inspector falls back to overview for the deprecated query mode", () => {
	expect(!inspector.includes("<InspectorQueryPanel")).toBeTruthy();
	expect(inspector).toMatch(/props.asideMode === "query" \? "overview" : props.asideMode/);
});

test("App delegates Inspector state and callbacks to the extracted View", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	expect(app).toMatch(/<InspectorView/);
	expect(app).toMatch(/onAsideModeChange=\{\(mode\) => layout\.setAsideMode\(mode\)\}/);
	expect(app).toMatch(/onStartResize=\{inspectorLayout\.startResize\}/);
	expect(app).toMatch(/onConnectLayout=\{\(element\) => inspectorLayout\.connect\(element\)\}/);
	expect(inspector).toMatch(/return props\.onConnectLayout\(inspectorElement\)/);
	expect(app).toMatch(/onUpdateSelectedHeading=\{updateSelectedHeading\}/);
	expect(app).toMatch(/onResolveEmergence=\{resolveEmergence\}/);
	expect(app).toMatch(/onSelectRevision=\{setSelectedOccurrenceRevision\}/);
});

test("Inspector history switches a placement between current text and a fixed revision", () => {
	expect(history).toMatch(/この\{vocabulary\.occurrence\}で表示する/);
	expect(history).toMatch(/<option value="">現在の本稿<\/option>/);
	expect(history).toMatch(/onSelectRevision\(event\.currentTarget\.value \|\| null\)/);
});
