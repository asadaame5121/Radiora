import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { DEFAULT_UI_VOCABULARY } from "../src/shared/ui_vocabulary.ts";
import ConfirmationDialogHarness from "./ConfirmationDialogHarness.svelte";

const meta = {
	title: "Feedback/ConfirmationDialog",
	component: ConfirmationDialogHarness,
	args: {
		pending: { action: "trash", occurrenceId: "occurrence-1", occurrenceCount: 3 },
		onConfirm: fn(),
		onReset: fn(),
	},
} satisfies Meta<typeof ConfirmationDialogHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

async function clickBackdropOutsideDialog(canvasElement: HTMLElement): Promise<void> {
	const document = canvasElement.ownerDocument;
	const overlay = document.body.querySelector<HTMLElement>(".confirmation-dialog__overlay");
	const dialog = document.body.querySelector<HTMLElement>(".confirmation-dialog");
	if (!overlay || !dialog) throw new Error("Confirmation dialog was not rendered");

	const overlayBounds = overlay.getBoundingClientRect();
	const dialogBounds = dialog.getBoundingClientRect();
	const point = [
		{ x: overlayBounds.left + 1, y: overlayBounds.top + 1 },
		{ x: overlayBounds.right - 1, y: overlayBounds.top + 1 },
		{ x: overlayBounds.left + 1, y: overlayBounds.bottom - 1 },
		{ x: overlayBounds.right - 1, y: overlayBounds.bottom - 1 },
	].find(({ x, y }) =>
		x < dialogBounds.left || x > dialogBounds.right || y < dialogBounds.top ||
		y > dialogBounds.bottom
	);
	if (!point) throw new Error("No clickable backdrop area outside the dialog");

	await userEvent.pointer({
		target: overlay,
		coords: point,
		keys: "[MouseLeft]",
	});
}

export const Trash: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		await userEvent.click(await canvas.findByRole("button", { name: "ゴミ箱へ移す" }));
		await expect(args.onConfirm).toHaveBeenCalledOnce();
	},
};

export const Rewrite: Story = {
	args: {
		pending: {
			action: "rewrite",
			occurrenceId: "occurrence-1",
			workId: "work-1",
			sourceBranchId: "branch-1",
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement.ownerDocument.body);
		await expect(await canvas.findByRole("textbox", { name: `${DEFAULT_UI_VOCABULARY.branch}名` }))
			.toHaveFocus();
	},
};

export const Escape: Story = {
	play: async ({ canvasElement, args }) => {
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(args.onReset).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(canvasElement.ownerDocument.body.querySelector(".confirmation-dialog")).toBeNull()
		);
	},
};

export const OutsideClick: Story = {
	play: async ({ canvasElement, args }) => {
		await clickBackdropOutsideDialog(canvasElement);
		await waitFor(() => expect(args.onReset).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(canvasElement.ownerDocument.body.querySelector(".confirmation-dialog")).toBeNull()
		);
	},
};

export const Submitting: Story = {
	args: { submitting: true },
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		await expect(body.getByRole("button", { name: "キャンセル" })).toBeDisabled();
		await userEvent.keyboard("{Escape}");
		await clickBackdropOutsideDialog(canvasElement);
		await expect(args.onReset).not.toHaveBeenCalled();
		await expect(body.getByRole("button", { name: "キャンセル" })).toBeDisabled();
	},
};

export const FocusRestoration: Story = {
	args: { restoreFocus: true },
	play: async ({ canvasElement }) => {
		await userEvent.keyboard("{Escape}");
		await expect(canvasElement.ownerDocument.body.querySelector(".focus-return-target"))
			.toHaveFocus();
	},
};
