import { assert, assertMatch, assertNotMatch } from "jsr:@std/assert@1";

Deno.test("tags are a global cloud view that projects tagged items", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const view = await Deno.readTextFile(new URL("../src/ui/TagBrowserView.svelte", import.meta.url));
	const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));

	assertMatch(app, /\| "tags"/);
	assertMatch(app, /onclick=\{openTags\}>\{vocabulary\.tag\}管理/);
	assertNotMatch(app, /disabled=\{!selectedItem\}>\{vocabulary\.tag\}管理/);
	assertMatch(app, /api\.listScopedTags\(\)/);
	assertMatch(app, /<TagBrowserView/);
	assertMatch(view, /const tagCloud = \$derived\.by/);
	assertMatch(view, /selectedTagNodeIds/);
	assertMatch(view, /onclick=\{\(\) => \(selectedTag = tag\.name\)\}/);
	assertMatch(view, /onclick=\{\(\) => onOpenTagNode\(workId\)\}/);
	assertMatch(app, /selectOccurrence\(item\.id\)/);
	assertMatch(app, /viewMode === "tags"/);
	assertMatch(styles, /\.tag-browser__cloud/);
	assertMatch(styles, /\.tag-browser__results/);
});
