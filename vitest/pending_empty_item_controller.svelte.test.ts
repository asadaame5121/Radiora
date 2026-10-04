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

for (const phase of ["flush", "delete"] as const) {
	test(`startup disposal during ${phase} does not reload or delete unstarted data`, async () => {
		const saved = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => saved.get(key) ?? null,
			setItem: (key: string, value: string) => saved.set(key, value),
		});
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const snapshot = {
			items: [{ id: "empty", text: "", workId: "work", parentId: null }],
			links: [],
			knots: [],
			stashItemIds: [],
		} as OutlineSnapshot;
		const ports = {
			getSnapshot: () => snapshot,
			flushAutosave: vi.fn().mockImplementation(() =>
				phase === "flush" ? pending : Promise.resolve()
			),
			deleteItem: vi.fn().mockImplementation(() => pending),
			reload: vi.fn().mockResolvedValue(true),
			reportError: vi.fn(),
		};
		const controller = createPendingEmptyItemController(ports);
		controller.track("empty");
		let current = true;
		const discarding = controller.discardRestored(() => current);
		if (phase === "delete") await vi.waitFor(() => expect(ports.deleteItem).toHaveBeenCalled());
		current = false;
		release();
		expect(await discarding).toBe(false);
		expect(ports.reload).not.toHaveBeenCalled();
		if (phase === "flush") {
			expect(ports.deleteItem).not.toHaveBeenCalled();
			expect(saved.get("radiora.pendingEmptyItemIds")).toContain("empty");
		} else {
			expect(saved.get("radiora.pendingEmptyItemIds")).toBe("[]");
		}
	});
}

test("failed startup cleanup remains retryable with its pending ID retained", async () => {
	const saved = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => saved.get(key) ?? null,
		setItem: (key: string, value: string) => saved.set(key, value),
	});
	const cause = new Error("delete offline");
	const ports = {
		getSnapshot: () => ({
			items: [{ id: "empty", workId: "work", text: "", parentId: null }],
			links: [],
			knots: [],
			stashItemIds: [],
		} as OutlineSnapshot),
		flushAutosave: vi.fn().mockResolvedValue(undefined),
		deleteItem: vi.fn().mockRejectedValue(cause),
		reload: vi.fn(),
		reportError: vi.fn(),
	};
	const controller = createPendingEmptyItemController(ports);
	controller.track("empty");
	expect(await controller.discardRestored()).toBe(false);
	expect(ports.reportError).toHaveBeenCalledWith(cause);
	expect(saved.get("radiora.pendingEmptyItemIds")).toContain("empty");
	ports.deleteItem.mockResolvedValue(undefined);
	expect(await controller.discardRestored()).toBe(true);
	expect(saved.get("radiora.pendingEmptyItemIds")).toBe("[]");
});
