import { afterEach, describe, expect, test, vi } from "vitest";
import type {
	OutlineItem,
	OutlineSnapshot,
	SearchResult,
	Suggestion,
} from "../src/domain/models.ts";
import { createOmniSearchController } from "../src/ui/omni_search_controller.svelte.ts";
import { createCommandPaletteController } from "../src/ui/command_palette_controller.svelte.ts";
import { createNavigationController } from "../src/ui/navigation_controller.svelte.ts";

describe("navigation controller", () => {
	afterEach(() => vi.useRealTimers());

	test("starts with an empty default navigation state", () => {
		const controller = createNavigationController();

		expect(controller.browsing.activePaneId).toBe("pane-1");
	});

	test("owns browsing selection, hoist, panes, and snapshot reconciliation", () => {
		const snapshot = outline();
		const controller = createNavigationController();

		expect(controller.browseToOccurrence(snapshot, "child")).toEqual({
			selectedOccurrenceId: "child",
			hoistOccurrenceId: null,
		});
		expect(controller.setHoist("child")).toEqual({
			selectedOccurrenceId: "child",
			hoistOccurrenceId: "child",
		});
		expect(controller.projectBrowsing(snapshot).rootOccurrenceIds).toEqual(["child"]);

		const secondPaneId = controller.addBrowsingPane();
		expect(secondPaneId).toBe("pane-2");
		expect(controller.browsing.activePaneId).toBe("pane-2");
		controller.browseToOccurrence(snapshot, "leaf");

		expect(controller.activateBrowsingPane("pane-1", snapshot).selectedOccurrenceId).toBe("child");
		expect(controller.activateBrowsingPane("pane-2", snapshot).selectedOccurrenceId).toBe("leaf");

		const withoutChild = {
			...snapshot,
			items: snapshot.items.filter((item) => item.id !== "child"),
		};
		expect(controller.reconcileBrowsing(withoutChild)).toEqual({
			selectedOccurrenceId: "leaf",
			hoistOccurrenceId: null,
		});
		expect(controller.clearHoist().hoistOccurrenceId).toBeNull();
	});

	test("resets browsing from a persisted location and continues pane numbering", () => {
		const controller = createNavigationController();

		controller.resetBrowsing("pane-4", {
			selectedOccurrenceId: "root",
			hoistOccurrenceId: "root",
		});

		expect(controller.browsingLocation.selectedOccurrenceId).toBe("root");
		expect(controller.browsingPane.id).toBe("pane-4");
		expect(controller.addBrowsingPane()).toBe("pane-5");
	});

	test("captures detached pane state and commits a prepared browsing state synchronously", () => {
		const snapshot = outline();
		const controller = createNavigationController();
		controller.browseToOccurrence(snapshot, "child");
		controller.setHoist("root");
		const secondPane = controller.addBrowsingPane();
		controller.browseToOccurrence(snapshot, "leaf");
		const saved = controller.captureBrowsing();
		controller.activateBrowsingPane("pane-1", snapshot);
		controller.browseToOccurrence(snapshot, "other");
		expect(saved.activePaneId).toBe(secondPane);
		controller.commitBrowsing(saved);
		expect(controller.browsingLocation).toEqual({
			selectedOccurrenceId: "leaf",
			hoistOccurrenceId: "root",
		});
		expect(controller.browsing.panes).toHaveLength(2);
	});

	test("honors initial navigation options and skips occupied pane numbers", () => {
		const controller = createNavigationController({
			initialPaneId: "custom",
			initialLocation: { selectedOccurrenceId: "root", hoistOccurrenceId: null },
			nextPaneNumber: 1,
		});

		expect(controller.browsing.activePaneId).toBe("custom");
		expect(controller.browsingLocation.selectedOccurrenceId).toBe("root");
		expect(controller.addBrowsingPane()).toBe("pane-1");
		expect(controller.addBrowsingPane()).toBe("pane-2");
	});

	test.each(
		[
			["pane-9", "pane-10"],
			["pane-10-extra", "pane-2"],
			["x-pane-10", "pane-2"],
			["pane-a", "pane-2"],
		] as const,
	)("derives the next id after %s as %s", (initialPaneId, expected) => {
		const controller = createNavigationController({ initialPaneId });
		expect(controller.addBrowsingPane()).toBe(expected);
	});

	test("owns reactive command palette open and query state", () => {
		const controller = createCommandPaletteController();
		const paletteState = $derived({
			open: controller.commandPaletteOpen,
			query: controller.commandPaletteQuery,
		});
		const currentPaletteState = () => paletteState;

		expect(currentPaletteState().open).toBe(false);
		controller.setQuery("stale");
		controller.openCommandPalette();

		expect(currentPaletteState()).toEqual({ open: true, query: "" });

		controller.closeCommandPalette();
		expect(currentPaletteState().open).toBe(false);
	});

	test("debounces suggestion and search ports and exposes combined entries", async () => {
		vi.useFakeTimers();
		const suggestion = suggestionFor("suggestion");
		const result = resultFor("result");
		const suggestItems = vi.fn(async () => [suggestion]);
		const searchItems = vi.fn(async () => [result]);
		const getSelectedId = vi.fn(() => "selected");
		const reportError = vi.fn();
		const controller = createOmniSearchController({
			searchPort: { suggestItems, searchItems, getSelectedId, reportError },
		});

		controller.input("needle");
		controller.queueSearch();
		expect(controller.searchActiveIndex).toBe(-1);
		expect(suggestItems).not.toHaveBeenCalled();
		expect(searchItems).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(100);
		expect(suggestItems).toHaveBeenCalledWith("needle", 8);
		expect(controller.suggestions).toEqual([suggestion]);
		expect(searchItems).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(150);
		expect(searchItems).toHaveBeenCalledWith({
			query: "needle",
			contextItemId: "selected",
			limit: 20,
		});
		expect(controller.searchEntries).toEqual([
			{ kind: "suggestion", value: suggestion },
			{ kind: "result", value: result },
		]);
		expect(controller.omniEntryCount).toBe(3);
		expect(controller.moveSearchActiveIndex(1)).toBe(0);
		expect(controller.moveSearchActiveIndex(-1)).toBe(-1);
		expect(reportError).not.toHaveBeenCalled();
	});

	test("records one search result per search session", async () => {
		vi.useFakeTimers();
		const recordSearch = vi.fn();
		const controller = createOmniSearchController({
			recordSearch,
			searchPort: {
				suggestItems: async () => [],
				searchItems: async () => [],
				getSelectedId: () => null,
				reportError: vi.fn(),
			},
		});
		controller.input("first");
		controller.queueSearch();
		await vi.advanceTimersByTimeAsync(250);
		controller.input("second");
		controller.queueSearch();
		await vi.advanceTimersByTimeAsync(250);
		expect(recordSearch).toHaveBeenCalledTimes(1);
		expect(recordSearch).toHaveBeenCalledWith("ok", expect.any(Number));
		controller.clearOmniwindow();
		controller.input("third");
		controller.queueSearch();
		await vi.advanceTimersByTimeAsync(250);
		expect(recordSearch).toHaveBeenCalledTimes(2);
	});

	test("clears results immediately for a whitespace-only query", () => {
		const controller = createOmniSearchController();
		controller.input("   ");
		controller.moveSearchActiveIndex(1);

		controller.queueSearch();

		expect(controller.searchActiveIndex).toBe(-1);
		expect(controller.suggestions).toEqual([]);
		expect(controller.searchResults).toEqual([]);
		expect(controller.omniEntryCount).toBe(0);
	});

	test("requires a search port only for non-empty queries", () => {
		const controller = createOmniSearchController();
		expect(() => controller.input("needle")).toThrow("Omni search port is not configured");
	});

	test("clamps search movement to the available entry range", async () => {
		vi.useFakeTimers();
		const controller = createOmniSearchController({
			searchPort: {
				suggestItems: vi.fn(async () => [suggestionFor("one")]),
				searchItems: vi.fn(async () => [resultFor("two")]),
				getSelectedId: () => null,
				reportError: vi.fn(),
			},
		});
		controller.input("capture");
		controller.queueSearch();
		await vi.advanceTimersByTimeAsync(250);

		expect(controller.omniEntryCount).toBe(3);
		expect(controller.moveSearchActiveIndex(1)).toBe(0);
		expect(controller.moveSearchActiveIndex(1)).toBe(1);
		expect(controller.moveSearchActiveIndex(1)).toBe(2);
		expect(controller.moveSearchActiveIndex(1)).toBe(2);
		expect(controller.moveSearchActiveIndex(-1)).toBe(1);
	});

	test("cancels timers and ignores stale async results when the omniwindow is cleared", async () => {
		vi.useFakeTimers();
		const pendingSuggestion = deferred<Suggestion[]>();
		const suggestItems = vi.fn(() => pendingSuggestion.promise);
		const searchItems = vi.fn(async () => [resultFor("stale-result")]);
		const reportError = vi.fn();
		const controller = createOmniSearchController({
			searchPort: {
				suggestItems,
				searchItems,
				getSelectedId: () => null,
				reportError,
			},
		});

		controller.input("stale");
		controller.queueSearch();
		await vi.advanceTimersByTimeAsync(100);
		expect(suggestItems).toHaveBeenCalledOnce();

		controller.clearOmniwindow();
		pendingSuggestion.resolve([suggestionFor("stale-suggestion")]);
		await Promise.resolve();
		await vi.runAllTimersAsync();

		expect(searchItems).not.toHaveBeenCalled();
		expect(controller.quickCaptureText).toBe("");
		expect(controller.suggestions).toEqual([]);
		expect(controller.searchResults).toEqual([]);
		expect(controller.searchActiveIndex).toBe(-1);
		expect(controller.omniEntryCount).toBe(0);
		expect(reportError).not.toHaveBeenCalled();
	});

	test("reports only errors from the current search request", async () => {
		vi.useFakeTimers();
		const failure = new Error("search failed");
		const reportError = vi.fn();
		const controller = createOmniSearchController({
			searchPort: {
				suggestItems: vi.fn(async () => []),
				searchItems: vi.fn(async () => {
					throw failure;
				}),
				getSelectedId: () => null,
				reportError,
			},
		});

		controller.input("failure");
		controller.queueSearch();
		await vi.advanceTimersByTimeAsync(250);

		expect(reportError).toHaveBeenCalledOnce();
		expect(reportError).toHaveBeenCalledWith(failure);
	});

	test("preserves previous suggestions and search results during debounce without flickering", async () => {
		vi.useFakeTimers();
		const suggestion1 = suggestionFor("first-suggestion");
		const suggestion2 = suggestionFor("second-suggestion");
		const result1 = resultFor("first-result");
		const result2 = resultFor("second-result");

		const controller = createOmniSearchController({
			searchPort: {
				suggestItems: vi.fn()
					.mockResolvedValueOnce([suggestion1])
					.mockResolvedValueOnce([suggestion2]),
				searchItems: vi.fn()
					.mockResolvedValueOnce([result1])
					.mockResolvedValueOnce([result2]),
				getSelectedId: () => null,
				reportError: vi.fn(),
			},
		});

		// 最初の検索完了
		controller.input("foo");
		await vi.advanceTimersByTimeAsync(250);
		expect(controller.suggestions).toEqual([suggestion1]);
		expect(controller.searchResults).toEqual([result1]);

		// 次の文字を入力（debounce 待機中）
		controller.input("foob");
		// 即時クリアされず、直前の結果が維持されていること（フリッカー防止）
		expect(controller.suggestions).toEqual([suggestion1]);
		expect(controller.searchResults).toEqual([result1]);

		// suggestion の debounce（100ms）完了後、suggestions のみ更新され、searchResults はまだ維持
		await vi.advanceTimersByTimeAsync(100);
		expect(controller.suggestions).toEqual([suggestion2]);
		expect(controller.searchResults).toEqual([result1]);

		// search の debounce（さらに150ms）完了後、searchResults も更新
		await vi.advanceTimersByTimeAsync(150);
		expect(controller.suggestions).toEqual([suggestion2]);
		expect(controller.searchResults).toEqual([result2]);

		// 空文字を入力した場合は即時クリアされること
		controller.input("");
		expect(controller.suggestions).toEqual([]);
		expect(controller.searchResults).toEqual([]);
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => resolve = next);
	return { promise, resolve };
}

function suggestionFor(id: string): Suggestion {
	return { item: item(id, null), ancestorIds: [], title: id };
}

function resultFor(id: string): SearchResult {
	return { item: item(id, null), ancestorIds: [], score: 1, reasons: [] };
}

function outline(): OutlineSnapshot {
	return {
		items: [
			item("root", null),
			item("child", "root"),
			item("leaf", "child"),
			item("other", null),
		],
		links: [],
		knots: [],
		stashItemIds: [],
	};
}

function item(id: string, parentId: string | null): OutlineItem {
	return {
		id,
		workId: id,
		text: id,
		parentId,
		orderKey: 1,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: id },
		createdAt: "2026-08-09T00:00:00.000Z",
		updatedAt: "2026-08-09T00:00:00.000Z",
	};
}
