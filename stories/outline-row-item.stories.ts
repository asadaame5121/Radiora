import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { DEFAULT_UI_VOCABULARY } from "../src/shared/ui_vocabulary.ts";
import type { OutlineRowSource } from "../src/ui/outline_row_types.ts";
import OutlineRowItemHarness from "./OutlineRowItemHarness.svelte";

const item: OutlineRowSource = {
	id: "0193d8a0-0000-7000-8000-000000000001",
	parentId: null,
	text: "読取り専用の行\n2行目 👩‍👩‍👧",
	collapsed: false,
};

const meta = {
	title: "Outline/OutlineRowItem",
	component: OutlineRowItemHarness,
	args: {
		row: { item, depth: 0, hasChildren: false, stash: false },
		selectedId: null,
		draggedId: null,
		vocabulary: DEFAULT_UI_VOCABULARY,
		internalReferenceCompletion: null,
		inlineLinkCompletion: null,
		handlers: { deselectFromBlank: fn(), toggle: fn(), selectOccurrence: fn() },
		helpers: { bodyFor: () => "", titleFor: (row: OutlineRowSource) => row.text },
		onDragStart: fn(),
		onDragEnd: fn(),
	},
} satisfies Meta<typeof OutlineRowItemHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Without editing handlers the row shows its text read-only and is not draggable. */
export const ReadOnly: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const row = canvas.getByRole("treeitem");
		await expect(row).toHaveAttribute("draggable", "false");
		await expect(canvas.queryByRole("textbox")).toBeNull();
		await expect(canvas.getByText(/読取り専用の行/)).toBeVisible();
		await userEvent.click(canvas.getByRole("button", { name: /を選択$/ }));
		await expect(args.handlers.selectOccurrence).toHaveBeenCalledWith(item.id);
	},
};
