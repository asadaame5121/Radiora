import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("Link Editor exposes GUI search, type selection, and direction selection", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const inspector = await readFile(
		new URL("../../../src/ui/InspectorView.svelte", import.meta.url),
		"utf8",
	);
	const relationTab = await readFile(
		new URL("../../../src/ui/InspectorRelationTab.svelte", import.meta.url),
		"utf8",
	);
	const editor = await readFile(
		new URL("../../../src/ui/LinkEditor.svelte", import.meta.url),
		"utf8",
	);
	const controller = await readFile(
		new URL("../../../src/ui/link_editor_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const relationLinkController = await readFile(
		new URL("../../../src/ui/relation_link_controller.svelte.ts", import.meta.url),
		"utf8",
	);

	expect(inspector).toMatch(/<InspectorRelationTab/);
	expect(relationTab).toMatch(/<LinkEditor/);
	expect(relationTab).toMatch(/selectedWorkId=\{selectedItem\.workId\}/);
	expect(relationTab).toMatch(/links=\{selectedLinks\}/);
	expect(controller).toMatch(/ports\.onSearch\(\{/);
	expect(controller).toMatch(/limit:\s*SEARCH_LIMIT/);
	expect(/createRpcAdapter/.test(editor)).toBe(false);
	expect(/createRpcAdapter/.test(controller)).toBe(false);
	expect(controller).toMatch(/selectedType = \$state<LinkType>\("LIKE"\)/);
	expect(editor).toMatch(/option value="outgoing"/);
	expect(editor).toMatch(/option value="incoming"/);
	expect(controller).toMatch(/ports\.onConfirm\(\{/);
	expect(controller).toMatch(/ports\.onDelete\(link\)/);
	expect(controller).toMatch(/ports\.onReverse\(link\)/);
	expect(editor).toMatch(/isSymmetricLinkType/);
	expect(editor).toMatch(/currentLinks/);
	expect(app).toMatch(/executeCommand\("createLink", undefined, input\)/);
	expect(app).toMatch(/performAddLink\(payload\.linkInput\) : openLinkEditor\(\)/);
	expect(app).toMatch(/async function reverseLink\(link: OutlineLink\)/);
	expect(relationLinkController).toMatch(/fromEndpoint: link\.to/);
	expect(relationLinkController).toMatch(/toEndpoint: link\.from/);
});

test("Link Editor does not create graph entities or access storage directly", async () => {
	const editor = await readFile(
		new URL("../../../src/ui/LinkEditor.svelte", import.meta.url),
		"utf8",
	);

	expect(
		/api\.(createItem|createOccurrence|quickCapture|placeUnplacedWork|createStub|createLink)\s*\(/.test(
			editor,
		),
	).toBe(false);
	expect(/from "\.\.\/storage\//.test(editor)).toBe(false);
});
