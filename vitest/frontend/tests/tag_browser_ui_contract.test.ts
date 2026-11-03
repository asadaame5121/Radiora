import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("tags are a global cloud view that projects tagged items", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const viewMode = await readFile(
		new URL("../../../src/ui/app_view_mode.ts", import.meta.url),
		"utf8",
	);
	const navigation = await readFile(
		new URL("../../../src/ui/PrimaryNavigation.svelte", import.meta.url),
		"utf8",
	);
	const view = await readFile(
		new URL("../../../src/ui/TagBrowserView.svelte", import.meta.url),
		"utf8",
	);
	const styles = await readFile(new URL("../../../src/ui/styles.css", import.meta.url), "utf8");

	expect(viewMode).toMatch(/\| "tags"/);
	expect(navigation).toMatch(/activeView === "tags"/);
	expect(navigation).toMatch(/onclick=\{onOpenTags\}>\{vocabulary\.tag\}管理/);
	expect(navigation).not.toMatch(/disabled=\{!selectedItem\}>\{vocabulary\.tag\}管理/);
	expect(app).toMatch(/api\.listScopedTags\(\)/);
	expect(app).toMatch(/<TagBrowserView/);
	expect(view).toMatch(/const tagCloud = \$derived\.by/);
	expect(view).toMatch(/selectedTagNodeIds/);
	expect(view).toMatch(/onclick=\{\(\) => \(selectedTag = tag\.name\)\}/);
	expect(view).toMatch(/onclick=\{\(\) => onOpenTagNode\(workId\)\}/);
	expect(app).toMatch(/openOutlineOccurrence\(item\.id\)/);
	expect(app).toMatch(/viewMode === "tags"/);
	expect(view).toMatch(/\.tag-browser__cloud/);
	expect(view).toMatch(/\.tag-browser__results/);
});
