import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import WorkingCopySaveStatus from "../src/ui/WorkingCopySaveStatus.svelte";

const meta = {
	title: "Feedback/WorkingCopySaveStatus",
	component: WorkingCopySaveStatus,
	args: {
		status: { workId: "work-1", branchId: "branch-1", phase: "saved" },
		onRetry: fn(),
	},
} satisfies Meta<typeof WorkingCopySaveStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Saved: Story = {};
export const Unsaved: Story = {
	args: { status: { workId: "work-1", branchId: "branch-1", phase: "unsaved" } },
};
export const Saving: Story = {
	args: { status: { workId: "work-1", branchId: "branch-1", phase: "saving" } },
};
export const Failed: Story = {
	args: {
		status: {
			workId: "work-1",
			branchId: "branch-1",
			phase: "failed",
			error: "保存先へ書き込めませんでした。",
		},
	},
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "再試行" }));
		await expect(args.onRetry).toHaveBeenCalledOnce();
	},
};
