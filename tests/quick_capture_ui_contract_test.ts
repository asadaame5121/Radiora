import { assert } from "jsr:@std/assert@1";

Deno.test("Quick Capture and unplaced inbox remain reachable and expose required actions", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const options = await Deno.readTextFile(new URL("../src/ui/OptionsView.svelte", import.meta.url));
	const unplaced = await Deno.readTextFile(
		new URL("../src/ui/UnplacedInboxView.svelte", import.meta.url),
	);
	const controller = await Deno.readTextFile(
		new URL("../src/ui/work_controller.svelte.ts", import.meta.url),
	);
	const bindings = await Deno.readTextFile(
		new URL("../src/shared/bindings.ts", import.meta.url),
	);

	for (
		const method of [
			"quickCapture",
			"listUnplacedWorks",
			"updateUnplacedWorkText",
			"placeUnplacedWork",
		]
	) {
		assert(bindings.includes(`${method}(`));
		assert(controller.includes(`ports.api.${method}(`));
	}
	assert(app.includes("vocabulary.quickCapture"));
	assert(app.includes("loadQuickCapturePreference()"));
	assert(app.includes("saveQuickCapturePreference"));
	assert(options.includes("quickCapturePreference.destination"));
	assert(controller.includes("ports.api.createItem({"));
	assert(options.includes("vocabulary.quickCaptureDestinationRoot"));
	assert(unplaced.includes("vocabulary.unplacedInbox"));
	assert(unplaced.includes("#タグ"));
	assert(unplaced.includes("Rootへ配置"));
	assert(unplaced.includes("selectedId"));
	assert(unplaced.includes("unplacedLinkDirections"));
	assert(controller.includes("ports.api.createLink({"));
});
