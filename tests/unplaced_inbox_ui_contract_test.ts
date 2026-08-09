import { assertMatch, assertNotMatch } from "jsr:@std/assert@1";

Deno.test("Unplaced Inbox renders in a feature view while mutations stay in its controller", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const view = await Deno.readTextFile(
		new URL("../src/ui/UnplacedInboxView.svelte", import.meta.url),
	);
	const controller = await Deno.readTextFile(
		new URL("../src/ui/work_controller.svelte.ts", import.meta.url),
	);

	assertMatch(app, /viewMode === "unplaced"/);
	assertMatch(app, /<UnplacedInboxView/);
	assertMatch(controller, /ports\.api\.updateUnplacedWorkText/);
	assertMatch(controller, /ports\.api\.placeUnplacedWork/);
	assertMatch(controller, /ports\.api\.createLink/);
	assertMatch(view, /matchesOutlineFilter/);
	assertMatch(view, /onUpdateText/);
	assertMatch(view, /onPlace/);
	assertMatch(view, /onLink/);
	assertNotMatch(view, /\bapi\./);
	assertNotMatch(app, /api\.(updateUnplacedWorkText|placeUnplacedWork)/);
});
