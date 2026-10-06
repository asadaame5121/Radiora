import { assert } from "jsr:@std/assert@1";

Deno.test("App routes command buttons and global shortcuts through the command service", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	assert(app.includes("commandAvailability(commandContext)"));
	const execution = await Deno.readTextFile(
		new URL("../src/ui/command_execution_controller.ts", import.meta.url),
	);
	const adapter = await Deno.readTextFile(
		new URL("../src/ui/global_keyboard_adapter.ts", import.meta.url),
	);
	assert(execution.includes("dispatchCommand(id, context"));
	assert(adapter.includes("isEditableTarget(event.target)"));
	assert(!app.includes('event.shiftKey && event.key.toLocaleLowerCase() === "l"'));
	assert(adapter.includes("this.ports.chord.handle(event)"));
	assert(app.includes("validateShortcuts(COMMAND_DEFINITIONS"));
	assert(adapter.includes('target.addEventListener("keydown", this.handle, true)'));
	assert(adapter.includes('target.removeEventListener("keydown", this.handle, true)'));
	for (
		const id of [
			"quickCapture",
			"hoist",
			"addBookmark",
			"saveRevision",
			"createLink",
		]
	) {
		assert(app.includes(`executeCommand("${id}"`));
	}
});

Deno.test("command palette projects command service state and guards disabled execution", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const palette = await Deno.readTextFile(
		new URL("../src/ui/CommandPaletteDialog.svelte", import.meta.url),
	);
	assert(app.includes("commandPaletteItems("));
	const adapter = await Deno.readTextFile(
		new URL("../src/ui/global_keyboard_adapter.ts", import.meta.url),
	);
	assert(adapter.includes('event.key.toLowerCase() === "k"'));
	assert(app.includes("if (!command?.availability.enabled) return;"));
	assert(palette.includes("command.availability.reason"));
	assert(app.includes("await paletteFocus.restore()"));
	assert(app.includes("hasSelectedRecoverySnapshot: false"));
	const execution = await Deno.readTextFile(
		new URL("../src/ui/command_execution_controller.ts", import.meta.url),
	);
	assert(execution.includes("hasSelectedRecoverySnapshot: true"));
});

Deno.test("command palette is shortcut-only and closes through the dialog overlay", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const palette = await Deno.readTextFile(
		new URL("../src/ui/CommandPaletteDialog.svelte", import.meta.url),
	);
	assert(app.includes("<CommandPaletteDialog"));
	assert(palette.includes("<Dialog.Overlay>"));
	assert(palette.includes("onOpenChange={handleOpenChange}"));
	assert(palette.includes("if (!nextOpen) void onClose()"));
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
	const confirmation = await Deno.readTextFile(
		new URL("../src/ui/ConfirmationDialog.svelte", import.meta.url),
	);
	const rewrite = await Deno.readTextFile(
		new URL("../src/ui/branch_rewrite_controller.ts", import.meta.url),
	);
	const inspectorLayout = await Deno.readTextFile(
		new URL("../src/ui/inspector_layout_adapter.ts", import.meta.url),
	);

	assert(app.includes("createBranch: requestRewriteAsNewBranch"));
	assert(app.includes('action: "rewrite"'));
	assert(confirmation.includes("rewriteBranchName.trim()"));
	assert(
		app.includes(
			"await branchRewrite.confirmRewrite(confirmation, confirmationController.rewriteBranchName)",
		),
	);
	assert(rewrite.includes("api.rewriteAsNewBranch("));
	assert(rewrite.includes("branchId: result.branch.id"));
	assert(
		rewrite.includes(
			'this.ports.navigation.navigate({ view: "outline", occurrenceId: placement.id }, origin)',
		),
	);
	assert(rewrite.includes('"confirmed"'));
	assert(confirmation.includes("rewriteInput?.focus()"));
	assert(confirmation.includes('event.key === "Enter" && rewriteBranchName.trim()'));
	assert(app.includes("createLink: (payload)"));
	assert(app.includes("performAddLink(payload.linkInput) : openLinkEditor()"));
	assert(app.includes("await inspectorLayout.openRelationEditor()"));
	assert(
		inspectorLayout.includes(
			'element.querySelector<HTMLInputElement>(".link-editor input[type=search]")?.focus()',
		),
	);
	assert(bindings.includes("rewriteAsNewBranch("));
	assert(
		desktop.includes("context.rewriteAsNewBranch(sourceBranchId, newBranchName, confirmation)"),
	);
});
