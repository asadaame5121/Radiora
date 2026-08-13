import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within } from "storybook/test";
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

export const Trash: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
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
};

export const Submitting: Story = { args: { submitting: true } };
