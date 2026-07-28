import { assert, assertFalse } from "jsr:@std/assert@1";

Deno.test("trash actions use one accessible in-app confirmation dialog", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));

	assertFalse(/\bconfirm\s*\(/.test(app));
	assert(app.includes("type PendingConfirmation ="));
	assert(app.includes("if (pendingConfirmation) return;"));
	assert(app.includes("confirmationDialog.showModal()"));
	assert(app.includes('aria-labelledby="confirmation-title"'));
	assert(app.includes('aria-describedby="confirmation-description"'));
	assert(app.includes("oncancel={preventCloseWhileSubmitting}"));
	assert(app.includes("await api.trashWork(confirmation.occurrenceId)"));
	assert(app.includes("await api.purgeWork(confirmation.workId)"));
});
