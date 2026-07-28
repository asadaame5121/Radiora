import { assert } from "jsr:@std/assert@1";

Deno.test("App routes command buttons and global shortcuts through the command service", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	assert(app.includes("commandAvailability(commandContext)"));
	assert(app.includes("dispatchCommand(id, executionContext"));
	assert(app.includes("isEditableTarget(event.target)"));
	assert(app.includes("validateShortcuts(COMMAND_DEFINITIONS"));
	for (
		const id of ["quickCapture", "hoist", "addBookmark", "saveRevision", "createLink", "runQuery"]
	) {
		assert(app.includes(`executeCommand(\"${id}\"`));
	}
});

Deno.test("command palette projects command service state and guards disabled execution", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	assert(app.includes("commandPaletteItems("));
	assert(app.includes('event.key.toLocaleLowerCase() === "k"'));
	assert(app.includes("if (!command?.availability.enabled) return;"));
	assert(app.includes("activeCommandPaletteItem.availability.reason"));
	assert(app.includes("commandPaletteRestoreFocus?.focus()"));
	assert(app.includes("hasSelectedRecoverySnapshot: false"));
	assert(app.includes("hasSelectedRecoverySnapshot: true"));
});
