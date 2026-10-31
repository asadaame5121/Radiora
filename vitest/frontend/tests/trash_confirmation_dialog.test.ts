import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("trash actions use one accessible in-app confirmation dialog", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const controller = await readFile(
		new URL("../../../src/ui/confirmation_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const workController = await readFile(
		new URL("../../../src/ui/work_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const dialog = await readFile(
		new URL("../../../src/ui/ConfirmationDialog.svelte", import.meta.url),
		"utf8",
	);

	expect(/\bconfirm\s*\(/.test(app)).toBe(false);
	expect(controller.includes("export type PendingConfirmation =")).toBeTruthy();
	expect(controller.includes("if (pending) return false;")).toBeTruthy();
	expect(app.includes("confirmationController.request(confirmation)")).toBeTruthy();
	expect(dialog.includes("<Dialog.Root")).toBeTruthy();
	expect(dialog.includes("bind:open")).toBeTruthy();
	expect(dialog.includes('aria-labelledby="confirmation-title"')).toBeTruthy();
	expect(dialog.includes('aria-describedby="confirmation-description"')).toBeTruthy();
	expect(dialog.includes("if (!nextOpen && submitting)")).toBeTruthy();
	expect(app.includes("workController.confirmTrash(confirmation.occurrenceId)")).toBeTruthy();
	expect(app.includes("workController.confirmPurge(confirmation.workId)")).toBeTruthy();
	expect(workController.includes("ports.api.trashWork(occurrenceId)")).toBeTruthy();
	expect(workController.includes("ports.api.purgeWork(workId)")).toBeTruthy();
});
