import { assert } from "jsr:@std/assert@1";

Deno.test("Quick Capture and unplaced inbox remain reachable and expose required actions", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
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
		assert(app.includes(`api.${method}(`));
	}
	assert(app.includes("vocabulary.quickCapture"));
	assert(app.includes("vocabulary.unplacedInbox"));
	assert(app.includes("#タグ"));
	assert(app.includes("Rootへ配置"));
	assert(app.includes("selectedId"));
	assert(app.includes("unplacedLinkDirections"));
	assert(app.includes("api.createLink({"));
});
