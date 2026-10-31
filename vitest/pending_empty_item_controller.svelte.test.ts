import { afterEach, expect, test, vi } from "vitest";
import type { OutlineSnapshot } from "../src/domain/models.ts";
import { createPendingEmptyItemController } from "../src/ui/pending_empty_item_controller.svelte.ts";

afterEach(() => vi.unstubAllGlobals());

function setupStorage(initial: string[] = []) {
	const saved = new Map<string, string>();
	saved.set("radiora.pendingEmptyItemIds", JSON.stringify(initial));
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => saved.get(key) ?? null,
		setItem: (key: string, value: string) => saved.set(key, value),
	});
	return saved;
}

test("single discard retains ports.deleteItem for user backspace", async () => {
	const saved = setupStorage();
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
		discardEmptyItems: vi.fn().mockResolvedValue({ deletedIds: ["empty"], handledIds: ["empty"] }),
		isEditing: vi.fn().mockReturnValue(false),
		reload: vi.fn().mockResolvedValue(true),
		reportError: vi.fn(),
	};

	const controller = createPendingEmptyItemController(ports);
	controller.track("empty");
	await controller.discard("empty");

	expect(ports.deleteItem).toHaveBeenCalledWith("empty");
	expect(ports.discardEmptyItems).not.toHaveBeenCalled();
	expect(ports.reload).toHaveBeenCalledOnce();
	expect(saved.get("radiora.pendingEmptyItemIds")).toBe("[]");
});

test("discardRestored uses discardEmptyItems and removes untouched empty item after restart", async () => {
	const saved = setupStorage();
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
		discardEmptyItems: vi.fn().mockResolvedValue({ deletedIds: ["empty"], handledIds: ["empty"] }),
		isEditing: vi.fn().mockReturnValue(false),
		reload: vi.fn().mockResolvedValue(true),
		reportError: vi.fn(),
	};

	createPendingEmptyItemController(ports).track("empty");
	expect(ports.discardEmptyItems).not.toHaveBeenCalled();
	await createPendingEmptyItemController(ports).discardRestored();

	expect(ports.deleteItem).not.toHaveBeenCalled();
	expect(ports.discardEmptyItems).toHaveBeenCalledWith(["empty"]);
	expect(ports.reload).toHaveBeenCalledOnce();
	expect(saved.get("radiora.pendingEmptyItemIds")).toBe("[]");
});

test("multiple restored empty items with same work flush only once and delete in single batch", async () => {
	const saved = setupStorage();
	const snapshot = {
		items: [
			{ id: "empty-1", text: "", workId: "work-same", parentId: null },
			{ id: "empty-2", text: "", workId: "work-same", parentId: null },
			{ id: "empty-3", text: "", workId: "work-other", parentId: null },
		],
		links: [],
		knots: [],
		stashItemIds: [],
	} as OutlineSnapshot;
	const ports = {
		getSnapshot: () => snapshot,
		flushAutosave: vi.fn().mockResolvedValue(undefined),
		deleteItem: vi.fn().mockResolvedValue(undefined),
		discardEmptyItems: vi.fn().mockResolvedValue({
			deletedIds: ["empty-1", "empty-2", "empty-3"],
			handledIds: ["empty-1", "empty-2", "empty-3"],
		}),
		isEditing: vi.fn().mockReturnValue(false),
		reload: vi.fn().mockResolvedValue(true),
		reportError: vi.fn(),
	};

	const controller = createPendingEmptyItemController(ports);
	controller.track("empty-1");
	controller.track("empty-2");
	controller.track("empty-3");
	await createPendingEmptyItemController(ports).discardRestored();

	// work-same should be flushed only once, work-other once -> 2 flushes total
	expect(ports.flushAutosave).toHaveBeenCalledTimes(2);
	expect(ports.flushAutosave).toHaveBeenCalledWith("work-same");
	expect(ports.flushAutosave).toHaveBeenCalledWith("work-other");

	// single discardEmptyItems batch call
	expect(ports.deleteItem).not.toHaveBeenCalled();
	expect(ports.discardEmptyItems).toHaveBeenCalledOnce();
	expect(ports.discardEmptyItems).toHaveBeenCalledWith(["empty-1", "empty-2", "empty-3"]);
	expect(ports.reload).toHaveBeenCalledOnce();
	expect(saved.get("radiora.pendingEmptyItemIds")).toBe("[]");
});

test("actively edited item is protected from discardRestored", async () => {
	const saved = setupStorage();
	const snapshot = {
		items: [
			{ id: "editing", text: "", workId: "work-1", parentId: null },
			{ id: "not-editing", text: "", workId: "work-2", parentId: null },
		],
		links: [],
		knots: [],
		stashItemIds: [],
	} as OutlineSnapshot;
	const ports = {
		getSnapshot: () => snapshot,
		flushAutosave: vi.fn().mockResolvedValue(undefined),
		deleteItem: vi.fn().mockResolvedValue(undefined),
		discardEmptyItems: vi.fn().mockResolvedValue({
			deletedIds: ["not-editing"],
			handledIds: ["not-editing"],
		}),
		isEditing: vi.fn((id: string) => id === "editing"),
		reload: vi.fn().mockResolvedValue(true),
		reportError: vi.fn(),
	};

	const controller = createPendingEmptyItemController(ports);
	controller.track("editing");
	controller.track("not-editing");
	await createPendingEmptyItemController(ports).discardRestored();

	// "editing" must NOT be in candidates passed to discardEmptyItems
	expect(ports.discardEmptyItems).toHaveBeenCalledWith(["not-editing"]);
	// "editing" must remain in pending, "not-editing" is removed
	const stored = JSON.parse(saved.get("radiora.pendingEmptyItemIds") ?? "[]");
	expect(stored).toEqual(["editing"]);
});

test("typing or adding a child keeps the new item", async () => {
	const saved = setupStorage();
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
		discardEmptyItems: vi.fn().mockResolvedValue({ deletedIds: [], handledIds: [] }),
		isEditing: vi.fn().mockReturnValue(false),
		reload: vi.fn().mockResolvedValue(true),
		reportError: vi.fn(),
	};
	const controller = createPendingEmptyItemController(ports);
	controller.track("typed");
	controller.noteTextChange("typed", "entered text");
	controller.track("parent");
	await createPendingEmptyItemController(ports).discardRestored();

	expect(ports.discardEmptyItems).not.toHaveBeenCalled();
	expect(saved.get("radiora.pendingEmptyItemIds")).toBe("[]");
});

test("failed discardEmptyItems RPC retains pending IDs and reports error", async () => {
	const saved = setupStorage();
	const cause = new Error("RPC error");
	const ports = {
		getSnapshot: () =>
			({
				items: [{ id: "empty", workId: "work", text: "", parentId: null }],
				links: [],
				knots: [],
				stashItemIds: [],
			}) as OutlineSnapshot,
		flushAutosave: vi.fn().mockResolvedValue(undefined),
		deleteItem: vi.fn(),
		discardEmptyItems: vi.fn().mockRejectedValue(cause),
		isEditing: vi.fn().mockReturnValue(false),
		reload: vi.fn(),
		reportError: vi.fn(),
	};
	const controller = createPendingEmptyItemController(ports);
	controller.track("empty");
	expect(await controller.discardRestored()).toBe(false);
	expect(ports.reportError).toHaveBeenCalledWith(cause);
	expect(saved.get("radiora.pendingEmptyItemIds")).toContain("empty");

	ports.discardEmptyItems.mockResolvedValue({ deletedIds: ["empty"], handledIds: ["empty"] });
	expect(await controller.discardRestored()).toBe(true);
	expect(saved.get("radiora.pendingEmptyItemIds")).toBe("[]");
});

test("startup disposal after successful RPC suppresses reload but keeps DB changes committed", async () => {
	const saved = setupStorage();
	let release!: () => void;
	const pending = new Promise<{ deletedIds: string[]; handledIds: string[] }>((resolve) => {
		release = () => resolve({ deletedIds: ["empty"], handledIds: ["empty"] });
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
		deleteItem: vi.fn(),
		discardEmptyItems: vi.fn().mockImplementation(() => pending),
		isEditing: vi.fn().mockReturnValue(false),
		reload: vi.fn().mockResolvedValue(true),
		reportError: vi.fn(),
	};
	const controller = createPendingEmptyItemController(ports);
	controller.track("empty");
	let current = true;
	const discarding = controller.discardRestored(() => current);

	await vi.waitFor(() => expect(ports.discardEmptyItems).toHaveBeenCalled());
	current = false;
	release();

	expect(await discarding).toBe(false);
	// Reload is suppressed because request expired
	expect(ports.reload).not.toHaveBeenCalled();
	// But pending item was forgotten since DB mutation succeeded
	expect(saved.get("radiora.pendingEmptyItemIds")).toBe("[]");
});
