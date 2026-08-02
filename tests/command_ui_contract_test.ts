import { assert } from "jsr:@std/assert@1";

Deno.test("App routes command buttons and global shortcuts through the command service", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	assert(app.includes("commandAvailability(commandContext)"));
	assert(app.includes("dispatchCommand(id, executionContext"));
	assert(app.includes("isEditableTarget(event.target)"));
	assert(
		app.includes(
			'event.shiftKey && event.key.toLocaleLowerCase() === "l"',
		),
	);
	assert(app.includes('void executeCommand("createLink")'));
	assert(app.includes("validateShortcuts(COMMAND_DEFINITIONS"));
	assert(app.includes('window.addEventListener("keydown", handleGlobalShortcut, true)'));
	assert(app.includes('window.removeEventListener("keydown", handleGlobalShortcut, true)'));
	for (
		const id of [
			"quickCapture",
			"hoist",
			"addBookmark",
			"saveRevision",
			"createLink",
			"runQuery",
		]
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

Deno.test("command palette is shortcut-only and closes from its backdrop", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	assert(app.includes("handleCommandPaletteBackdropClick"));
	assert(app.includes("event.target !== event.currentTarget"));
	assert(app.includes("onclick={handleCommandPaletteBackdropClick}"));
	assert(!app.includes("onclick={() => openCommandPalette()}>{vocabulary.commandPalette}"));
});

Deno.test("branch rewrite and link commands remain keyboard-first and confirmation gated", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const bindings = await Deno.readTextFile(
		new URL("../src/shared/bindings.ts", import.meta.url),
	);
	const desktop = await Deno.readTextFile(
		new URL("../src/desktop/register_bindings.ts", import.meta.url),
	);

	assert(app.includes('case "createBranch": await requestRewriteAsNewBranch()'));
	assert(app.includes('action: "rewrite"'));
	assert(app.includes("rewriteBranchName.trim()"));
	assert(app.includes("api.rewriteAsNewBranch("));
	assert(app.includes('"confirmed"'));
	assert(app.includes('viewMode = "workLineage"'));
	assert(app.includes("rewriteBranchNameInput?.focus()"));
	assert(app.includes('event.key === "Enter" && rewriteBranchName.trim()'));
	assert(app.includes('case "createLink":'));
	assert(app.includes("else await openLinkEditor()"));
	assert(app.includes('".link-editor input[type=search]"'));
	assert(app.includes("input?.focus()"));
	assert(bindings.includes("rewriteAsNewBranch("));
	assert(
		desktop.includes("context.rewriteAsNewBranch(sourceBranchId, newBranchName, confirmation)"),
	);
});
