import { assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const controller = await Deno.readTextFile(
	new URL("../src/ui/outline_link_selection_controller.svelte.ts", import.meta.url),
);
const bar = await Deno.readTextFile(
	new URL("../src/ui/OutlineLinkSelectionBar.svelte", import.meta.url),
);
const outline = await Deno.readTextFile(new URL("../src/ui/OutlineView.svelte", import.meta.url));
const row = await Deno.readTextFile(new URL("../src/ui/OutlineRowItem.svelte", import.meta.url));

Deno.test("bulk outline link selection owns Work-level selection and partial failure state", () => {
	assertMatch(controller, /selectedWorkIds = \$state<ReadonlySet<string>>/);
	assertMatch(controller, /workId === this\.originWorkId/);
	assertMatch(controller, /for \(const targetWorkId of targetWorkIds\)/);
	assertMatch(controller, /this\.error = errorMessage\(cause\)/);
	assertMatch(controller, /this\.clear\(\);\n\s*\t\t\treturn true;/);
	assertMatch(app, /new OutlineLinkSelectionController/);
	assertMatch(app, /createLink: \(input\) => api\.createLink\(input\)/);
	assertMatch(app, /outlineLinkSelectionController\.cancel\(\)/);
});

Deno.test("selection controls are rendered only in the temporary outline mode", () => {
	assertMatch(outline, /\{#if linkSelection\.active\}[\s\S]*?<OutlineLinkSelectionBar/);
	assertMatch(outline, /linkSelection=\{linkSelection\}/);
	assertMatch(row, /\{#if linkSelection\.active\}/);
	assertMatch(row, /linkSelection\.selectedWorkIds\.has\(row\.item\.workId\)/);
	assertMatch(row, /linkSelectionOrigin/);
	assertMatch(row, /handlers\.toggleLinkSelection\(row\.item\.workId\)/);
	assertMatch(bar, /disabled=\{state\.submitting \|\| state\.selectedWorkCount === 0\}/);
	assertMatch(bar, /isSymmetricLinkType\(state\.selectedType\)/);
});
