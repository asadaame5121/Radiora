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
		id: "openToday",
		label: "今日の一覧を開く",
		shortcut: "G T",
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
		commands: [commands[0], commands[2]],
		vocabulary: DEFAULT_UI_VOCABULARY,
		query: "",
		onClose: fn(),
		onExecute: fn(),
	},
} satisfies Meta<typeof CommandPaletteDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = await body.findByRole("combobox");
		await userEvent.type(input, "{ArrowDown}{Enter}");
		await expect(args.onExecute).toHaveBeenCalledOnce();
	},
};

export const Filtering: Story = {
	args: { query: "クイック", commands: [commands[0]] },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		expect(await body.findByRole("option", { name: "クイック入力 Ctrl+K" })).toBeVisible();
		expect(body.queryByRole("option", { name: "今日の一覧を開く G T" })).not.toBeInTheDocument();
	},
};

export const ArrowLoop: Story = {
	args: { commands: [commands[0], commands[1]] },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = await body.findByRole("combobox");
		input.focus();
		await userEvent.keyboard("{ArrowUp}");
		await expect(await body.findByRole("option", { name: "今日の一覧を開く G T" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await userEvent.keyboard("{ArrowDown}");
		await expect(await body.findByRole("option", { name: "クイック入力 Ctrl+K" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	},
};

export const DisabledSkip: Story = {
	args: { commands: [commands[0], commands[2], commands[1]] },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.keyboard("{ArrowDown}");
		await expect(await body.findByRole("option", { name: "今日の一覧を開く G T" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(await body.findByRole("option", { name: "ゴミ箱へ移す" })).toBeDisabled();
	},
};

export const EnterExecutes: Story = {
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		(await body.findByRole("combobox")).focus();
		await userEvent.keyboard("{Enter}");
		await expect(args.onExecute).toHaveBeenCalledOnce();
	},
};

export const EscapeCloses: Story = {
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		(await body.findByRole("combobox")).focus();
		await userEvent.keyboard("{Escape}");
		await expect(args.onClose).toHaveBeenCalledOnce();
	},
};

export const Empty: Story = {
	args: { commands: [] },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await expect(await body.findByRole("status")).toHaveTextContent(
			"一致するコマンドはありません。",
		);
	},
};
