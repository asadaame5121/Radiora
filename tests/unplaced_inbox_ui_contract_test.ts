import { assertMatch, assertNotMatch } from "jsr:@std/assert@1";

Deno.test("Unplaced Inbox renders in a feature view while mutations stay in App", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const view = await Deno.readTextFile(
		new URL("../src/ui/UnplacedInboxView.svelte", import.meta.url),
	);

	assertMatch(app, /viewMode === "unplaced"/);
	assertMatch(app, /<UnplacedInboxView/);
	assertMatch(app, /api\.updateUnplacedWorkText/);
	assertMatch(app, /api\.placeUnplacedWork/);
	assertMatch(app, /api\.createLink/);
	assertMatch(view, /matchesOutlineFilter/);
	assertMatch(view, /onUpdateText/);
	assertMatch(view, /onPlace/);
	assertMatch(view, /onLink/);
	assertNotMatch(view, /\bapi\./);
});
