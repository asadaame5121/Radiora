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
		revisionSelector: { mode: "branch", branchId: `b-${id}` },
		createdAt: "now",
		updatedAt: "now",
	};
}

function adaptedPorts() {
	return {
		captureRequest: () => () => true,
		pendingEmpty: { track: vi.fn(), forget: vi.fn() },
		clearTemporaryExpansion: vi.fn(),
		selection: { current: (): string | null => null, clear: vi.fn() },
	};
}

function fixture(items: OutlineItem[]) {
	let generation = 0;
	const events: string[] = [];
	const api = {
		moveItem: vi.fn(async () => undefined),
		setCollapsed: vi.fn(async () => {
			events.push("collapse");
		}),
		updateItemText: vi.fn(async (_id: string, _text: string) => {
			events.push("update");
		}),
		createItem: vi.fn(async () => {
			events.push("create");
			return createItem("new", null, 15, "");
		}),
		deleteItem: vi.fn(async () => {
			events.push("delete");
		}),
	};
	const reload = vi.fn(async (_focusId?: string, _current?: () => boolean) => {
		events.push("reload");
		return true;
	});
	const ports = {
		...adaptedPorts(),
		api,
		getItems: () => items,
		getItemById: (id: string) => items.find((item) => item.id === id),
		reload,
		flushAutosave: vi.fn(async () => {
			events.push("flush");
		}),
		reportError: vi.fn(),
		pendingEmpty: {
			track: vi.fn((_id: string) => events.push("track")),
			forget: vi.fn((_id: string) => events.push("forget")),
		},
		clearTemporaryExpansion: vi.fn((_id: string) => events.push("clear-expansion")),
		selection: {
			current: vi.fn((): string | null => null),
			clear: vi.fn(() => events.push("clear-selection")),
		},
		captureRequest: () => {
			const request = generation;
			return () => generation === request;
		},
	};
	return {
		controller: new OutlineOperationsController(ports),
		ports,
		events,
		invalidate: () => generation++,
	};
}

function keyEvent(key: string, modifiers: Partial<{
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	isComposing: boolean;
	keyCode: number;
}> = {}) {
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		isComposing: false,
		keyCode: 0,
		preventDefault: vi.fn(),
		...modifiers,
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
			...adaptedPorts(),
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
			...adaptedPorts(),
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
		expect(reload).toHaveBeenCalledWith("2", expect.any(Function));
	});

	it("outdents an item to become its parent's sibling", async () => {
		const parent = createItem("p1", null, 10);
		const child = createItem("c1", "p1", 5);
		const items = [parent, child];
		const moveItem = vi.fn().mockResolvedValue(undefined);
		const reload = vi.fn().mockResolvedValue(undefined);
		const controller = new OutlineOperationsController({
			...adaptedPorts(),
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
		expect(reload).toHaveBeenCalledWith("c1", expect.any(Function));
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
			...adaptedPorts(),
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
			...adaptedPorts(),
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

	it("splits row at cursor position and loads created item", async () => {
		const item = createItem("1", null, 10, "Hello World");
		const updateItemText = vi.fn().mockResolvedValue({ ...item, text: "Hello " });
		const createdItem = createItem("new", null, 15, "World");
		const createItemApi = vi.fn().mockResolvedValue(createdItem);
		const reload = vi.fn().mockResolvedValue(undefined);
		const flushAutosave = vi.fn().mockResolvedValue(undefined);

		const controller = new OutlineOperationsController({
			...adaptedPorts(),
			api: {
				moveItem: vi.fn(),
				setCollapsed: vi.fn(),
				updateItemText,
				createItem: createItemApi,
				deleteItem: vi.fn(),
			},
			getItems: () => [item],
			getItemById: () => item,
			reload,
			flushAutosave,
			reportError: vi.fn(),
		});

		await controller.splitRow(item, () => ({ start: 6, end: 6 }));

		expect(flushAutosave).toHaveBeenCalledWith(item.workId);
		expect(updateItemText).toHaveBeenCalledWith("1", "Hello ");
		expect(createItemApi).toHaveBeenCalledWith({
			text: "World",
			parentId: null,
			afterId: "1",
		});
		expect(reload).toHaveBeenCalledWith("new", expect.any(Function));
	});

	it("deletes empty row and focuses previous sibling", async () => {
		const prev = createItem("prev", null, 5, "Previous");
		const current = createItem("curr", null, 10, "");
		const deleteItem = vi.fn().mockResolvedValue(undefined);
		const reload = vi.fn().mockResolvedValue(undefined);
		const flushAutosave = vi.fn().mockResolvedValue(undefined);

		const controller = new OutlineOperationsController({
			...adaptedPorts(),
			api: {
				moveItem: vi.fn(),
				setCollapsed: vi.fn(),
				updateItemText: vi.fn(),
				createItem: vi.fn(),
				deleteItem,
			},
			getItems: () => [prev, current],
			getItemById: (id) => (id === "prev" ? prev : current),
			reload,
			flushAutosave,
			reportError: vi.fn(),
		});

		const result = await controller.deleteEmptyRow(current);

		expect(result).toBe(true);
		expect(flushAutosave).toHaveBeenCalledWith(current.workId);
		expect(deleteItem).toHaveBeenCalledWith("curr");
		expect(reload).toHaveBeenCalledWith("prev", expect.any(Function));
	});

	it("checks whether an empty row can be deleted based on content and previous sibling", () => {
		const first = createItem("first", null, 1, "");
		const prev = createItem("prev", null, 5, "Previous");
		const current = createItem("curr", null, 10, "");
		const nonEmpty = createItem("nonEmpty", null, 15, "Non Empty");

		const controller = new OutlineOperationsController({
			...adaptedPorts(),
			api: {
				moveItem: vi.fn(),
				setCollapsed: vi.fn(),
				updateItemText: vi.fn(),
				createItem: vi.fn(),
				deleteItem: vi.fn(),
			},
			getItems: () => [first, prev, current, nonEmpty],
			getItemById: vi.fn(),
			reload: vi.fn(),
			flushAutosave: vi.fn(),
			reportError: vi.fn(),
		});

		expect(controller.canDeleteEmptyRow(current)).toBe(true);
		expect(controller.canDeleteEmptyRow(nonEmpty)).toBe(false);
		expect(controller.canDeleteEmptyRow(first)).toBe(false);
	});
});

describe("OutlineOperationsController - current ownership contracts", () => {
	it.each(["row", "other", null])(
		"deletes and clears only the deleted selection (selected: %s)",
		async (selected) => {
			const item = createItem("row", null, 10);
			const { controller, ports, events } = fixture([item]);
			ports.selection.current.mockReturnValue(selected);
			await controller.remove(item.id);
			expect(ports.flushAutosave).toHaveBeenCalledWith(item.workId);
			expect(ports.api.deleteItem).toHaveBeenCalledWith(item.id);
			expect(ports.pendingEmpty.forget).toHaveBeenCalledWith(item.id);
			expect(ports.reload).toHaveBeenCalledWith();
			expect(ports.selection.clear).toHaveBeenCalledTimes(selected === item.id ? 1 : 0);
			expect(events).toEqual(
				selected === item.id
					? ["flush", "delete", "forget", "clear-selection", "reload"]
					: ["flush", "delete", "forget", "reload"],
			);
		},
	);

	it.each(["row", "other"])(
		"corrects persisted deletion after receipt expiry without clearing a new selection (%s)",
		async (selectedAfterDelete) => {
			const item = createItem("row", null, 10);
			const { controller, ports, invalidate, events } = fixture([item]);
			ports.selection.current.mockReturnValue(item.id);
			let release: () => void = () => {
				throw new Error("Delete has not started");
			};
			ports.api.deleteItem.mockImplementation(() =>
				new Promise<void>((resolve) => {
					events.push("delete");
					release = resolve;
				})
			);
			const removal = controller.remove(item.id);
			await vi.waitFor(() => expect(ports.api.deleteItem).toHaveBeenCalled());
			invalidate();
			ports.selection.current.mockReturnValue(selectedAfterDelete);
			release();
			await removal;
			expect(ports.pendingEmpty.forget).toHaveBeenCalledWith(item.id);
			expect(ports.selection.clear).toHaveBeenCalledTimes(selectedAfterDelete === item.id ? 1 : 0);
			expect(ports.reload).toHaveBeenCalledWith();
		},
	);

	it("preserves selection and pending records when remove persistence fails", async () => {
		const item = createItem("row", null, 10);
		const { controller, ports } = fixture([item]);
		ports.selection.current.mockReturnValue(item.id);
		const cause = new Error("Delete failed");
		ports.api.deleteItem.mockRejectedValue(cause);
		await expect(controller.remove(item.id)).rejects.toBe(cause);
		expect(ports.selection.clear).not.toHaveBeenCalled();
		expect(ports.pendingEmpty.forget).not.toHaveBeenCalled();
		expect(ports.reload).not.toHaveBeenCalled();
	});

	it("records an empty split after persistence and before reload", async () => {
		const item = createItem("row", null, 10, "body");
		const { controller, ports, events } = fixture([item]);
		await controller.splitRow(item, () => ({ start: 4, end: 4 }));
		expect(events).toEqual(["flush", "update", "create", "track", "reload"]);
		expect(ports.pendingEmpty.track).toHaveBeenCalledWith("new");
	});

	it("reads the selection after autosave and excludes selected text from the split", async () => {
		const item = createItem("row", null, 10, "Hello World");
		const { controller, ports } = fixture([item]);
		let selection = { start: 0, end: 0 };
		ports.flushAutosave.mockImplementation(async () => {
			selection = { start: 5, end: 6 };
		});
		await controller.splitRow(item, () => selection);
		expect(ports.api.updateItemText).toHaveBeenCalledWith("row", "Hello");
		expect(ports.api.createItem).toHaveBeenCalledWith({
			text: "World",
			parentId: null,
			afterId: "row",
		});
		expect(ports.pendingEmpty.track).not.toHaveBeenCalled();
	});

	it.each(["split", "delete"])(
		"autosave failure prevents %s writes and preserves pending records",
		async (operation) => {
			const item = createItem("row", null, 10, operation === "split" ? "body" : "");
			const { controller, ports } = fixture([createItem("prev", null, 5), item]);
			const cause = new Error("save failed");
			ports.flushAutosave.mockRejectedValue(cause);
			if (operation === "split") await controller.splitRow(item, () => ({ start: 2, end: 2 }));
			else await controller.deleteEmptyRow(item);
			expect(ports.reportError).toHaveBeenCalledWith(cause);
			expect(ports.api.updateItemText).not.toHaveBeenCalled();
			expect(ports.api.createItem).not.toHaveBeenCalled();
			expect(ports.api.deleteItem).not.toHaveBeenCalled();
			expect(ports.pendingEmpty.forget).not.toHaveBeenCalled();
			expect(ports.reload).not.toHaveBeenCalled();
		},
	);

	it("forgets an empty row only after deletion succeeds, before reload", async () => {
		const item = createItem("row", null, 10, "");
		const { controller, ports, events } = fixture([createItem("prev", null, 5), item]);
		await controller.deleteEmptyRow(item);
		expect(events).toEqual(["flush", "delete", "forget", "reload"]);
		expect(ports.pendingEmpty.forget).toHaveBeenCalledWith("row");
	});

	it("a failed delete reports the original error and retains the pending record", async () => {
		const item = createItem("row", null, 10, "");
		const { controller, ports } = fixture([createItem("prev", null, 5), item]);
		const cause = new Error("delete failed");
		ports.api.deleteItem.mockRejectedValue(cause);
		await controller.handleKeydown(keyEvent("Backspace"), item, () => ({ start: 0, end: 0 }));
		expect(ports.reportError).toHaveBeenCalledWith(cause);
		expect(ports.pendingEmpty.forget).not.toHaveBeenCalled();
		expect(ports.reload).not.toHaveBeenCalled();
	});

	it("a failed creation does not track or reload a nonexistent row", async () => {
		const item = createItem("row", null, 10);
		const { controller, ports } = fixture([item]);
		const cause = new Error("create failed");
		ports.api.createItem.mockRejectedValue(cause);
		await controller.handleKeydown(keyEvent("Enter"), item, () => ({ start: 4, end: 4 }));
		expect(ports.reportError).toHaveBeenCalledWith(cause);
		expect(ports.pendingEmpty.track).not.toHaveBeenCalled();
		expect(ports.reload).not.toHaveBeenCalled();
	});

	it("selection invalidation keeps the persisted split but expires its reload focus authority", async () => {
		const item = createItem("row", null, 10);
		const { controller, ports, invalidate } = fixture([item]);
		ports.api.createItem.mockImplementation(async () => {
			invalidate();
			return createItem("new", null, 15, "");
		});
		await controller.splitRow(item, () => ({ start: 4, end: 4 }));
		expect(ports.pendingEmpty.track).toHaveBeenCalledWith("new");
		const current = ports.reload.mock.calls[0][1];
		expect(current?.()).toBe(false);
	});

	it("clears temporary expansion before persisting collapse and leaves other owners to reload", async () => {
		const item = createItem("row", null, 10);
		const { controller, events } = fixture([item]);
		await controller.toggle(item);
		expect(events).toEqual(["clear-expansion", "collapse", "reload"]);
	});

	it("propagates collapse failure to the caller without reloading", async () => {
		const item = createItem("row", null, 10);
		const { controller, ports } = fixture([item]);
		const cause = new Error("collapse failed");
		ports.api.setCollapsed.mockRejectedValue(cause);
		await expect(controller.toggle(item)).rejects.toBe(cause);
		expect(ports.reportError).not.toHaveBeenCalled();
		expect(ports.reload).not.toHaveBeenCalled();
	});

	it.each([
		{ isComposing: true },
		{ keyCode: 229 },
		{ ctrlKey: true },
		{ metaKey: true },
		{ shiftKey: true },
		{ altKey: true },
	])("does not split for a composing or modified Enter: %j", async (modifiers) => {
		const item = createItem("row", null, 10);
		const { controller, ports } = fixture([item]);
		const event = keyEvent("Enter", modifiers);
		await controller.handleKeydown(event, item, () => ({ start: 4, end: 4 }));
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(ports.flushAutosave).not.toHaveBeenCalled();
	});

	it("consumes plain Enter on an empty row without creating an occurrence", async () => {
		const item = createItem("row", null, 10, "");
		const { controller, ports } = fixture([item]);
		const event = keyEvent("Enter");
		await controller.handleKeydown(event, item, () => ({ start: 0, end: 0 }));
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(ports.api.createItem).not.toHaveBeenCalled();
	});

	it.each([
		{ key: "Tab", modifiers: {}, id: "row", parentId: "prev", afterId: "child" },
		{ key: "Tab", modifiers: { shiftKey: true }, id: "child", parentId: null, afterId: "prev" },
		{ key: "ArrowUp", modifiers: { altKey: true }, id: "row", parentId: null, afterId: null },
		{ key: "ArrowDown", modifiers: { altKey: true }, id: "prev", parentId: null, afterId: "row" },
	])("routes $key to the existing structural operation for $id", async (input) => {
		const items = [
			createItem("prev", null, 5),
			createItem("row", null, 10),
			createItem("child", "prev", 5),
		];
		const { controller, ports } = fixture(items);
		const target = items.find((item) => item.id === input.id);
		if (!target) throw new Error("Missing test row");
		const event = keyEvent(input.key, input.modifiers);
		await controller.handleKeydown(event, target, () => ({ start: 0, end: 0 }));
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(ports.api.moveItem).toHaveBeenCalledWith({
			id: input.id,
			parentId: input.parentId,
			afterId: input.afterId,
		});
	});

	it("does not publish an old mutation error after its selection request expires", async () => {
		const item = createItem("row", null, 10);
		const { controller, ports, invalidate } = fixture([item]);
		ports.api.createItem.mockImplementation(async () => {
			invalidate();
			throw new Error("Old mutation failed");
		});
		await controller.handleKeydown(keyEvent("Enter"), item, () => ({ start: 4, end: 4 }));
		expect(ports.reportError).not.toHaveBeenCalled();
		expect(ports.reload).not.toHaveBeenCalled();
	});
});

it("tracks a root and preserves its request receipt across creation", async () => {
	const { controller, ports, invalidate } = fixture([createItem("last", null, 20)]);
	await controller.createRoot();
	expect(ports.api.createItem).toHaveBeenCalledWith({ text: "", parentId: null, afterId: "last" });
	expect(ports.pendingEmpty.track).toHaveBeenCalledWith("new");
	const receipt = ports.reload.mock.calls[0][1];
	expect(receipt?.()).toBe(true);
	invalidate();
	expect(receipt?.()).toBe(false);
});
it("keeps a row and pending record when draft flush fails", async () => {
	const { controller, ports } = fixture([createItem("a", null, 10)]);
	ports.flushAutosave.mockRejectedValueOnce(new Error("save failed"));
	await controller.remove("a");
	expect(ports.api.deleteItem).not.toHaveBeenCalled();
	expect(ports.pendingEmpty.forget).not.toHaveBeenCalled();
	expect(ports.reportError).toHaveBeenCalled();
});
