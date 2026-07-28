import { assert } from "jsr:@std/assert@1";

Deno.test("App routes command buttons and global shortcuts through the command service", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	assert(app.includes("commandAvailability(commandContext)"));
	assert(app.includes("dispatchCommand(id, commandContext"));
	assert(app.includes("isEditableTarget(event.target)"));
	assert(app.includes("validateShortcuts(COMMAND_DEFINITIONS"));
	for (
		const id of ["quickCapture", "hoist", "addBookmark", "saveRevision", "createLink", "runQuery"]
	) {
		assert(app.includes(`executeCommand(\"${id}\"`));
	}
});
