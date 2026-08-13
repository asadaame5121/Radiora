import { assert, assertFalse, assertMatch } from "jsr:@std/assert@1";

Deno.test("Link Editor exposes GUI search, type selection, and direction selection", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const editor = await Deno.readTextFile(
		new URL("../src/ui/LinkEditor.svelte", import.meta.url),
	);

	assertMatch(app, /<LinkEditor/);
	assertMatch(app, /selectedWorkId=\{selectedItem\.workId\}/);
	assertMatch(app, /links=\{selectedLinks\}/);
	assertMatch(editor, /api\.searchItems\(\{/);
	assertMatch(editor, /selectedType = \$state<LinkType>\("LIKE"\)/);
	assertMatch(editor, /option value="outgoing"/);
	assertMatch(editor, /option value="incoming"/);
	assertMatch(editor, /await onConfirm\(\{/);
	assertMatch(editor, /await onDelete\(link\)/);
	assertMatch(editor, /await onReverse\(link\)/);
	assertMatch(editor, /relationTypeDefinitions: readonly RelationTypeDefinition\[\]/);
	assertMatch(editor, /definitionByName\.get\(type\)\?\.direction === "symmetric"/);
	assertMatch(editor, /isSymmetric\(link\.type\)/);
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
