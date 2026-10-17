import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { DEFAULT_UI_VOCABULARY } from "../src/shared/ui_vocabulary.ts";
import CommandPaletteDialogHarness from "./CommandPaletteDialogHarness.svelte";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

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
	component: CommandPaletteDialogHarness,
	args: {
		commands: [commands[0], commands[2]],
		vocabulary: DEFAULT_UI_VOCABULARY,
		onClose: fn(),
		onExecute: fn(),
	},
} satisfies Meta<typeof CommandPaletteDialogHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = await body.findByRole("combobox");
		await expect(input).toHaveFocus();
		await userEvent.type(input, "{ArrowDown}{Enter}");
		await expect(args.onExecute).toHaveBeenCalledOnce();
		await expect(args.onExecute).toHaveBeenCalledWith(commands[0]);
	},
};

export const Filtering: Story = {
	args: { initialQuery: "クイック", commands: [commands[0]] },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await expect(await body.findByRole("combobox")).toHaveValue("クイック");
		expect(await body.findByRole("option", { name: "クイック入力 Ctrl+K" })).toBeVisible();
		expect(body.queryByRole("option", { name: "今日の一覧を開く G T" })).not.toBeInTheDocument();
	},
};

export const QueryBinding: Story = {
	args: { initialQuery: "initial" },
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = await body.findByRole("combobox");
		await expect(input).toHaveValue("initial");
		await expect(body.getByLabelText("Current query")).toHaveTextContent("initial");
		await expect(args.onExecute).not.toHaveBeenCalled();
		await expect(args.onClose).not.toHaveBeenCalled();
		await userEvent.clear(input);
		await waitFor(() => expect(body.getByLabelText("Current query")).toHaveTextContent(/^$/));
		await userEvent.type(input, "today");
		await expect(input).toHaveValue("today");
		await expect(body.getByLabelText("Current query")).toHaveTextContent("today");
	},
};

export const ArrowLoop: Story = {
	args: { commands: [commands[0], commands[1]] },
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = await body.findByRole("combobox");
		input.focus();
		await expect(input).toHaveFocus();
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
		await userEvent.keyboard("{Enter}");
		await expect(args.onExecute).toHaveBeenCalledWith(commands[0]);
		await expect(args.onExecute).toHaveBeenCalledOnce();
	},
};

export const DisabledSkip: Story = {
	args: { commands: [commands[0], commands[2], commands[1]] },
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = await body.findByRole("combobox");
		input.focus();
		await expect(input).toHaveFocus();
		await userEvent.keyboard("{ArrowDown}");
		await expect(await body.findByRole("option", { name: "今日の一覧を開く G T" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(await body.findByRole("option", { name: "ゴミ箱へ移す" })).toBeDisabled();
		await userEvent.keyboard("{Enter}");
		await expect(args.onExecute).toHaveBeenCalledWith(commands[1]);
		await expect(args.onExecute).toHaveBeenCalledOnce();
	},
};

export const EnterExecutes: Story = {
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = await body.findByRole("combobox");
		input.focus();
		await expect(input).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		await expect(args.onExecute).toHaveBeenCalledOnce();
		await expect(args.onExecute).toHaveBeenCalledWith(commands[0]);
	},
};

export const EscapeCloses: Story = {
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = await body.findByRole("combobox");
		input.focus();
		await expect(input).toHaveFocus();
		await userEvent.keyboard("{Escape}");
		await expect(args.onClose).toHaveBeenCalledOnce();
		await waitFor(() =>
			expect(body.queryByRole("dialog", { name: DEFAULT_UI_VOCABULARY.commandPalette })).not
				.toBeInTheDocument()
		);
	},
};

async function clickBackdropOutsideDialog(
	canvasElement: HTMLElement,
): Promise<void> {
	const document = canvasElement.ownerDocument;
	const backdrop = document.body.querySelector<HTMLElement>(".command-palette");
	const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
	if (!backdrop || !dialog) throw new Error("Command palette was not rendered");

	const backdropBounds = backdrop.getBoundingClientRect();
	const dialogBounds = dialog.getBoundingClientRect();
	const point = [
		{ x: backdropBounds.left + 1, y: backdropBounds.top + 1 },
		{ x: backdropBounds.right - 1, y: backdropBounds.top + 1 },
		{ x: backdropBounds.left + 1, y: backdropBounds.bottom - 1 },
		{ x: backdropBounds.right - 1, y: backdropBounds.bottom - 1 },
	].find(({ x, y }) =>
		x < dialogBounds.left || x > dialogBounds.right || y < dialogBounds.top ||
		y > dialogBounds.bottom
	);
	if (!point) throw new Error("No clickable backdrop area outside the dialog");
	const hitTarget = document.elementFromPoint(point.x, point.y);
	if (!hitTarget || !backdrop.contains(hitTarget)) {
		throw new Error(
			`Outside point (${point.x}, ${point.y}) hit ${hitTarget?.tagName ?? "nothing"}`,
		);
	}

	await userEvent.pointer({
		target: hitTarget,
		coords: point,
		keys: "[MouseLeft]",
	});
}

export const OutsidePointerCloses: Story = {
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		await body.findByRole("dialog", { name: DEFAULT_UI_VOCABULARY.commandPalette });
		const input = await body.findByRole("combobox");
		await expect(input).toHaveFocus();
		await userEvent.click(input);
		await clickBackdropOutsideDialog(canvasElement);
		await waitFor(() => expect(args.onClose).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(body.queryByRole("dialog", { name: DEFAULT_UI_VOCABULARY.commandPalette })).not
				.toBeInTheDocument()
		);
	},
};

export const DisabledReasonDoesNotExecute: Story = {
	args: { commands: [commands[2]] },
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		const disabled = await body.findByRole("option", { name: "ゴミ箱へ移す" });
		await expect(disabled).toBeDisabled();
		await expect(disabled).toHaveAttribute("title", "項目を選択してください");
		await userEvent.click(disabled);
		const input = await body.findByRole("combobox");
		input.focus();
		await expect(input).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		await expect(args.onExecute).not.toHaveBeenCalled();
	},
};

export const DisabledOnlyEnterDoesNotExecute: Story = {
	args: { commands: [commands[2]] },
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = await body.findByRole("combobox");
		input.focus();
		await expect(input).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		await expect(args.onExecute).not.toHaveBeenCalled();
	},
};

export const Empty: Story = {
	args: { commands: [] },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await expect(body.getByText("一致するコマンドはありません。")).toBeVisible();
	},
};
