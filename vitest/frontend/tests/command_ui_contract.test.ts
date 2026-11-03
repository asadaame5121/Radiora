import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("App routes command buttons and global shortcuts through the command service", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	expect(app.includes("commandAvailability(commandContext)")).toBeTruthy();
	const execution = await readFile(
		new URL("../../../src/ui/command_execution_controller.ts", import.meta.url),
		"utf8",
	);
	const adapter = await readFile(
		new URL("../../../src/ui/global_keyboard_adapter.ts", import.meta.url),
		"utf8",
	);
	expect(execution.includes("dispatchCommand(id, context")).toBeTruthy();
	expect(adapter.includes("isEditableTarget(event.target)")).toBeTruthy();
	expect(!app.includes('event.shiftKey && event.key.toLocaleLowerCase() === "l"')).toBeTruthy();
	expect(adapter.includes("this.ports.chord.handle(event)")).toBeTruthy();
	expect(app.includes("validateShortcuts(COMMAND_DEFINITIONS")).toBeTruthy();
	expect(adapter.includes('target.addEventListener("keydown", this.handle, true)')).toBeTruthy();
	expect(adapter.includes('target.removeEventListener("keydown", this.handle, true)')).toBeTruthy();
	for (const id of ["quickCapture", "hoist", "addBookmark", "saveRevision", "createLink"]) {
		expect(app.includes(`executeCommand("${id}"`)).toBeTruthy();
	}
});

test("command palette projects command service state and guards disabled execution", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const palette = await readFile(
		new URL("../../../src/ui/CommandPaletteDialog.svelte", import.meta.url),
		"utf8",
	);
	expect(app.includes("commandPaletteItems(")).toBeTruthy();
	const adapter = await readFile(
		new URL("../../../src/ui/global_keyboard_adapter.ts", import.meta.url),
		"utf8",
	);
	expect(adapter.includes('event.key.toLowerCase() === "k"')).toBeTruthy();
	expect(app.includes("if (!command?.availability.enabled) return;")).toBeTruthy();
	expect(palette.includes("command.availability.reason")).toBeTruthy();
	expect(app.includes("await paletteFocus.restore()")).toBeTruthy();
	expect(app.includes("hasSelectedRecoverySnapshot: false")).toBeTruthy();
	const execution = await readFile(
		new URL("../../../src/ui/command_execution_controller.ts", import.meta.url),
		"utf8",
	);
	expect(execution.includes("hasSelectedRecoverySnapshot: true")).toBeTruthy();
});

test("command palette is shortcut-only and closes through the dialog overlay", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const palette = await readFile(
		new URL("../../../src/ui/CommandPaletteDialog.svelte", import.meta.url),
		"utf8",
	);
	expect(app.includes("<CommandPaletteDialog")).toBeTruthy();
	expect(palette.includes("<Dialog.Overlay>")).toBeTruthy();
	expect(palette.includes("onOpenChange={handleOpenChange}")).toBeTruthy();
	expect(palette.includes("if (!nextOpen) void onClose()")).toBeTruthy();
	expect(
		!app.includes("onclick={() => openCommandPalette()}>{vocabulary.commandPalette}"),
	).toBeTruthy();
});

test("branch rewrite and link commands remain keyboard-first and confirmation gated", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const bindings = await readFile(
		new URL("../../../src/shared/bindings.ts", import.meta.url),
		"utf8",
	);
	const desktop = await readFile(
		new URL("../../../src/desktop/register_bindings.ts", import.meta.url),
		"utf8",
	);
	const confirmation = await readFile(
		new URL("../../../src/ui/ConfirmationDialog.svelte", import.meta.url),
		"utf8",
	);
	const rewrite = await readFile(
		new URL("../../../src/ui/branch_rewrite_controller.ts", import.meta.url),
		"utf8",
	);
	const inspectorLayout = await readFile(
		new URL("../../../src/ui/inspector_layout_adapter.ts", import.meta.url),
		"utf8",
	);

	expect(app.includes("createBranch: requestRewriteAsNewBranch")).toBeTruthy();
	expect(app.includes('action: "rewrite"')).toBeTruthy();
	expect(confirmation.includes("rewriteBranchName.trim()")).toBeTruthy();
	expect(
		app.includes(
			"await branchRewrite.confirmRewrite(confirmation, confirmationController.rewriteBranchName)",
		),
	).toBeTruthy();
	expect(rewrite.includes("api.rewriteAsNewBranch(")).toBeTruthy();
	expect(rewrite.includes("branchId: result.branch.id")).toBeTruthy();
	expect(
		rewrite.includes(
			'this.ports.navigation.navigate({ view: "outline", occurrenceId: placement.id }, origin)',
		),
	).toBeTruthy();
	expect(rewrite.includes('"confirmed"')).toBeTruthy();
	expect(confirmation.includes("rewriteInput?.focus()")).toBeTruthy();
	expect(confirmation.includes('event.key === "Enter" && rewriteBranchName.trim()')).toBeTruthy();
	expect(app.includes("createLink: (payload)")).toBeTruthy();
	expect(app.includes("performAddLink(payload.linkInput) : openLinkEditor()")).toBeTruthy();
	expect(app.includes("await inspectorLayout.openRelationEditor()")).toBeTruthy();
	expect(
		inspectorLayout.includes(
			'element.querySelector<HTMLInputElement>(".link-editor input[type=search]")?.focus()',
		),
	).toBeTruthy();
	expect(bindings.includes("rewriteAsNewBranch(")).toBeTruthy();
	expect(
		desktop.includes("context.rewriteAsNewBranch(sourceBranchId, newBranchName, confirmation)"),
	).toBeTruthy();
});
