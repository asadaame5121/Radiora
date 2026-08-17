import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import StartupCacheStatus from "../src/ui/StartupCacheStatus.svelte";

const meta = {
	title: "Feedback/StartupCacheStatus",
	component: StartupCacheStatus,
	args: {
		startup: { phase: "starting", message: "最新データを同期しています。" },
		onRetry: fn(),
		onReload: fn(),
	},
} satisfies Meta<typeof StartupCacheStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Syncing: Story = {};

export const Failed: Story = {
	args: { startup: { phase: "failed", message: "起動に失敗しました。" } },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "再試行" }));
		await expect(args.onRetry).toHaveBeenCalledOnce();
	},
};

export const StaleReady: Story = {
	args: { startup: { phase: "ready", message: "前回の内容を表示しています。" } },
};
