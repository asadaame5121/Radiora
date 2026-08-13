import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { DEFAULT_UI_VOCABULARY } from "../src/shared/ui_vocabulary.ts";
import CommandPaletteDialog from "../src/ui/CommandPaletteDialog.svelte";
import { expect, fn, userEvent, within } from "storybook/test";

const commands = [
	{
		id: "quickCapture",
		label: "クイック入力",
		shortcut: "Ctrl+K",
		availability: { enabled: true },
	},
	{
		id: "trashWork",
		label: "ゴミ箱へ移す",
		availability: { enabled: false, reason: "項目を選択してください" },
	},
] as const;

const meta = {
	title: "Navigation/CommandPalette",
	component: CommandPaletteDialog,
	args: {
		open: true,
		commands,
		vocabulary: DEFAULT_UI_VOCABULARY,
		query: "",
		activeIndex: -1,
		onClose: fn(),
		onExecute: fn(),
	},
} satisfies Meta<typeof CommandPaletteDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByRole("textbox");
		await userEvent.type(input, "{ArrowDown}{Enter}");
		await expect(args.onExecute).toHaveBeenCalledOnce();
	},
};

export const Empty: Story = { args: { commands: [] } };
