import { afterEach, expect, test, vi } from "vitest";
import type { OutlineSnapshot } from "../src/domain/models.ts";
import { createPendingEmptyItemController } from "../src/ui/pending_empty_item_controller.svelte.ts";

afterEach(() => vi.unstubAllGlobals());

test("an untouched Enter item is removed after restart without a focus change", async () => {
	const saved = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => saved.get(key) ?? null,
		setItem: (key: string, value: string) => saved.set(key, value),
	});
	const snapshot = {
		items: [{ id: "empty", text: "", workId: "work", parentId: null }],
		links: [],
		knots: [],
		stashItemIds: [],
	} as OutlineSnapshot;
	const ports = {
		getSnapshot: () => snapshot,
		flushAutosave: vi.fn().mockResolvedValue(undefined),
		deleteItem: vi.fn().mockResolvedValue(undefined),
		reload: vi.fn().mockResolvedValue(true),
		reportError: vi.fn(),
	};

	createPendingEmptyItemController(ports).track("empty");
	expect(ports.deleteItem).not.toHaveBeenCalled();
	await createPendingEmptyItemController(ports).discardRestored();

	expect(ports.deleteItem).toHaveBeenCalledWith("empty");
	expect(ports.reload).toHaveBeenCalledOnce();
	expect(saved.get("radiora.pendingEmptyItemIds")).toBe("[]");
});

test("typing or adding a child keeps the new item", async () => {
	const saved = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => saved.get(key) ?? null,
		setItem: (key: string, value: string) => saved.set(key, value),
	});
	const snapshot = {
		items: [
			{ id: "typed", text: "", workId: "typed-work", parentId: null },
			{ id: "parent", text: "", workId: "parent-work", parentId: null },
			{ id: "child", text: "child", workId: "child-work", parentId: "parent" },
		],
		links: [],
		knots: [],
		stashItemIds: [],
	} as OutlineSnapshot;
	const ports = {
		getSnapshot: () => snapshot,
		flushAutosave: vi.fn().mockResolvedValue(undefined),
		deleteItem: vi.fn().mockResolvedValue(undefined),
		reload: vi.fn().mockResolvedValue(true),
		reportError: vi.fn(),
	};
	const controller = createPendingEmptyItemController(ports);
	controller.track("typed");
	controller.noteTextChange("typed", "entered text");
	controller.track("parent");
	await createPendingEmptyItemController(ports).discardRestored();

	expect(ports.deleteItem).not.toHaveBeenCalled();
	expect(saved.get("radiora.pendingEmptyItemIds")).toBe("[]");
});
