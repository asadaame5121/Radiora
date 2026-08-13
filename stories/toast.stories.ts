import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import Toast from "../src/ui/Toast.svelte";

const meta = {
	title: "Feedback/Toast",
	component: Toast,
	args: {
		title: "保存しました",
		message: "作業中の本文を保存しました。",
		durationMs: 600_000,
		onDismiss: fn(),
	},
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "閉じる" }));
		await expect(args.onDismiss).toHaveBeenCalledOnce();
	},
};

export const LongMessage: Story = {
	args: { message: "長い処理結果でも内容を読み取れるよう、幅を超えた文章を折り返して表示します。" },
};
