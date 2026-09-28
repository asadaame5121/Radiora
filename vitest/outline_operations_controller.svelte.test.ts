import { describe, expect, it, vi } from "vitest";
import type { OutlineItem } from "../src/domain/models.ts";
import { OutlineOperationsController } from "../src/ui/outline_operations_controller.svelte.ts";

function createItem(
	id: string,
	parentId: string | null,
	orderKey: number,
	text = "item",
): OutlineItem {
	return {
		id,
		parentId,
		orderKey,
		workId: `w-${id}`,
		text,
		collapsed: false,
		completed: false,
		depth: 0,
		createdAt: "now",
		updatedAt: "now",
	};
}

describe("OutlineOperationsController - structure operations", () => {
	it("finds ordered siblings for an item", () => {
		const items = [
			createItem("1", null, 20),
			createItem("2", null, 10),
			createItem("3", "other", 5),
		];
		const controller = new OutlineOperationsController({
			api: {
				moveItem: vi.fn(),
				setCollapsed: vi.fn(),
				updateItemText: vi.fn(),
				createItem: vi.fn(),
				deleteItem: vi.fn(),
			},
			getItems: () => items,
			getItemById: (id) => items.find((i) => i.id === id),
			reload: vi.fn(),
			flushAutosave: vi.fn(),
			reportError: vi.fn(),
		});

		const siblings = controller.siblingsOf(items[0]);
		expect(siblings.map((s) => s.id)).toEqual(["2", "1"]);
	});

	it("indents an item under its previous sibling", async () => {
		const items = [
			createItem("1", null, 10),
			createItem("2", null, 20),
			createItem("child", "1", 5),
		];
		const moveItem = vi.fn().mockResolvedValue(undefined);
		const reload = vi.fn().mockResolvedValue(undefined);
		const controller = new OutlineOperationsController({
			api: {
				moveItem,
				setCollapsed: vi.fn(),
				updateItemText: vi.fn(),
				createItem: vi.fn(),
				deleteItem: vi.fn(),
			},
			getItems: () => items,
			getItemById: (id) => items.find((i) => i.id === id),
			reload,
			flushAutosave: vi.fn(),
			reportError: vi.fn(),
		});

		await controller.indent(items[1]);
		expect(moveItem).toHaveBeenCalledWith({
			id: "2",
			parentId: "1",
			afterId: "child",
		});
		expect(reload).toHaveBeenCalledWith("2");
	});

	it("outdents an item to become its parent's sibling", async () => {
		const parent = createItem("p1", null, 10);
		const child = createItem("c1", "p1", 5);
		const items = [parent, child];
		const moveItem = vi.fn().mockResolvedValue(undefined);
		const reload = vi.fn().mockResolvedValue(undefined);
		const controller = new OutlineOperationsController({
			api: {
				moveItem,
				setCollapsed: vi.fn(),
				updateItemText: vi.fn(),
				createItem: vi.fn(),
				deleteItem: vi.fn(),
			},
			getItems: () => items,
			getItemById: (id) => items.find((i) => i.id === id),
			reload,
			flushAutosave: vi.fn(),
			reportError: vi.fn(),
		});

		await controller.outdent(child);
		expect(moveItem).toHaveBeenCalledWith({
			id: "c1",
			parentId: null,
			afterId: "p1",
		});
		expect(reload).toHaveBeenCalledWith("c1");
	});

	it("moves sibling up and down", async () => {
		const items = [
			createItem("1", null, 10),
			createItem("2", null, 20),
			createItem("3", null, 30),
		];
		const moveItem = vi.fn().mockResolvedValue(undefined);
		const reload = vi.fn().mockResolvedValue(undefined);
		const controller = new OutlineOperationsController({
			api: {
				moveItem,
				setCollapsed: vi.fn(),
				updateItemText: vi.fn(),
				createItem: vi.fn(),
				deleteItem: vi.fn(),
			},
			getItems: () => items,
			getItemById: (id) => items.find((i) => i.id === id),
			reload,
			flushAutosave: vi.fn(),
			reportError: vi.fn(),
		});

		await controller.moveSibling(items[1], -1);
		expect(moveItem).toHaveBeenCalledWith({
			id: "2",
			parentId: null,
			afterId: null,
		});

		await controller.moveSibling(items[1], 1);
		expect(moveItem).toHaveBeenCalledWith({
			id: "2",
			parentId: null,
			afterId: "3",
		});
	});

	it("toggles item collapsed state", async () => {
		const item = createItem("1", null, 10);
		item.collapsed = false;
		const setCollapsed = vi.fn().mockResolvedValue(undefined);
		const reload = vi.fn().mockResolvedValue(undefined);
		const controller = new OutlineOperationsController({
			api: {
				moveItem: vi.fn(),
				setCollapsed,
				updateItemText: vi.fn(),
				createItem: vi.fn(),
				deleteItem: vi.fn(),
			},
			getItems: () => [item],
			getItemById: () => item,
			reload,
			flushAutosave: vi.fn(),
			reportError: vi.fn(),
		});

		await controller.toggle(item);
		expect(setCollapsed).toHaveBeenCalledWith("1", true);
		expect(reload).toHaveBeenCalledWith();
	});
});
