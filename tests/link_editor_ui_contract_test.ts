import { assertFalse, assertMatch } from "jsr:@std/assert@1";

Deno.test("Link Editor exposes GUI search, type selection, and direction selection", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const inspector = await Deno.readTextFile(
		new URL("../src/ui/InspectorView.svelte", import.meta.url),
	);
	const relationTab = await Deno.readTextFile(
		new URL("../src/ui/InspectorRelationTab.svelte", import.meta.url),
	);
	const editor = await Deno.readTextFile(
		new URL("../src/ui/LinkEditor.svelte", import.meta.url),
	);
	const controller = await Deno.readTextFile(
		new URL("../src/ui/link_editor_controller.svelte.ts", import.meta.url),
	);

	assertMatch(inspector, /<InspectorRelationTab/);
	assertMatch(relationTab, /<LinkEditor/);
	assertMatch(relationTab, /selectedWorkId=\{selectedItem\.workId\}/);
	assertMatch(relationTab, /links=\{selectedLinks\}/);
	assertMatch(controller, /ports\.onSearch\(\{/);
	assertMatch(controller, /limit:\s*SEARCH_LIMIT/);
	assertFalse(/createRpcAdapter/.test(editor));
	assertFalse(/createRpcAdapter/.test(controller));
	assertMatch(controller, /selectedType = \$state<LinkType>\("LIKE"\)/);
	assertMatch(editor, /option value="outgoing"/);
	assertMatch(editor, /option value="incoming"/);
	assertMatch(controller, /ports\.onConfirm\(\{/);
	assertMatch(controller, /ports\.onDelete\(link\)/);
	assertMatch(controller, /ports\.onReverse\(link\)/);
	assertMatch(editor, /isSymmetricLinkType/);
	assertMatch(editor, /currentLinks/);
	assertMatch(app, /executeCommand\("createLink", undefined, input\)/);
	assertMatch(app, /else await openLinkEditor\(\)/);
	assertMatch(app, /async function reverseLink\(link: OutlineLink\)/);
	assertMatch(app, /fromEndpoint: link\.to/);
	assertMatch(app, /toEndpoint: link\.from/);
});

Deno.test("Link Editor does not create graph entities or access storage directly", async () => {
	const editor = await Deno.readTextFile(
		new URL("../src/ui/LinkEditor.svelte", import.meta.url),
	);

	assertFalse(
		/api\.(createItem|createOccurrence|quickCapture|placeUnplacedWork|createStub|createLink)\s*\(/
			.test(
				editor,
			),
	);
	assertFalse(/from "\.\.\/storage\//.test(editor));
});
