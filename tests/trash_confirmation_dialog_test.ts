import { assert, assertFalse } from "jsr:@std/assert@1";

Deno.test("trash actions use one accessible in-app confirmation dialog", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const controller = await Deno.readTextFile(
		new URL("../src/ui/confirmation_controller.svelte.ts", import.meta.url),
	);
	const dialog = await Deno.readTextFile(
		new URL("../src/ui/ConfirmationDialog.svelte", import.meta.url),
	);

	assertFalse(/\bconfirm\s*\(/.test(app));
	assert(controller.includes("export type PendingConfirmation ="));
	assert(controller.includes("if (pending) return false;"));
	assert(app.includes("confirmationController.request(confirmation)"));
	assert(dialog.includes("dialog.showModal()"));
	assert(dialog.includes('aria-labelledby="confirmation-title"'));
	assert(dialog.includes('aria-describedby="confirmation-description"'));
	assert(dialog.includes("oncancel={preventCloseWhileSubmitting}"));
	assert(app.includes("await api.trashWork(confirmation.occurrenceId)"));
	assert(app.includes("await api.purgeWork(confirmation.workId)"));
});
