import { describe, expect, it, vi } from "vitest";
import type { OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import { createBrowsingNavigationState } from "../src/services/browsing_navigation_state.ts";
import { LongFormController } from "../src/ui/long_form_controller.svelte.ts";
import { ScreenNavigationWorkspace } from "../src/ui/screen_navigation_workspace.svelte.ts";

vi.mock("svelte", () => ({ tick: async () => undefined }));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("P1: LongForm navigation race reproduction", () => {
	it("preserves edits entered while manuscript navigation save/reload is pending", async () => {
		const item: OutlineItem = {
			id: "item-1",
			workId: "work-1",
			text: "initial",
			parentId: null,
			orderKey: 0,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "branch-1" },
			createdAt: "2026-10-03T00:00:00Z",
			updatedAt: "2026-10-03T00:00:00Z",
		};

		let dbText = "initial";
		let snapshot: OutlineSnapshot = {
			items: [{ ...item, text: dbText }],
			links: [],
			knots: [],
			stashItemIds: [],
		};

		const saveDeferred = deferred<void>();
		const reloadDeferred = deferred<boolean>();
		let saveCalledWith: string | null = null;

		const longForm = new LongFormController({
			flush: async () => undefined,
			save: async (id, text) => {
				saveCalledWith = text;
				dbText = text;
				snapshot = {
					...snapshot,
					items: snapshot.items.map((i) => (i.id === id ? { ...i, text } : i)),
				};
				await saveDeferred.promise;
			},
			reload: async () => {
				return reloadDeferred.promise;
			},
			reportError: () => undefined,
		});

		let browsing = createBrowsingNavigationState("pane-1", {
			selectedOccurrenceId: "item-1",
			hoistOccurrenceId: null,
		});
		let selectedId: string | null = "item-1";
		let isLongFormActive = true;

		const workspace = new ScreenNavigationWorkspace({
			outline: {
				captureBrowsing: () => browsing,
				commitBrowsing: (next) => {
					browsing = next;
				},
				filter: () => ({ freeText: "", tagsAll: "", tagsNone: "" }),
				setFilter: () => undefined,
				expanded: () => [],
				setExpanded: () => undefined,
				inspector: () => ({ mode: "overview", collapsed: false }),
				setInspector: () => undefined,
				longForm: () => isLongFormActive,
				setLongForm: (active, id) => {
					isLongFormActive = active;
					longForm.setMode(active, snapshot.items.find((i) => i.id === id) ?? null);
				},
				capturePosition: () => ({
					focus: "editor",
					editorPosition: {
						itemId: "item-1",
						hoistId: null,
						start: 0,
						end: 0,
						scrollTop: 0,
						scrollLeft: 0,
						panelScrollTop: 0,
					},
					panelScrollTop: 0,
					panelScrollLeft: 0,
				}),
				restorePosition: async () => undefined,
			},
			snapshot: () => snapshot,
			readOutline: async () => snapshot,
			publishOutline: (next) => {
				snapshot = next;
			},
			selection: {
				current: () => selectedId,
				guard: async () => true,
				commit: (id) => {
					selectedId = id;
				},
				cancelPending: () => undefined,
			},
			editor: {
				save: () => longForm.save(false),
				flush: async () => undefined,
			},
			screens: {
				prepare: async () => () => undefined,
				focusTree: () => undefined,
			},
			reportError: () => undefined,
		});

		// 1. Setup manuscript mode with Text A
		longForm.setMode(true, item);
		longForm.input("text A");
		expect(longForm.state.text).toBe("text A");
		expect(longForm.state.dirty).toBe(true);

		// 2. Press F1 (navigate to help)
		const navPromise = workspace.navigate({ view: "help" });

		// Wait until save is called with Text A
		await vi.waitFor(() => expect(saveCalledWith).toBe("text A"));

		// 3. User types Text B while save/reload is still in-flight
		longForm.input("text B");
		expect(longForm.state.text).toBe("text B");
		expect(longForm.state.dirty).toBe(true);

		// 4. Resolve save and reload
		saveDeferred.resolve();
		reloadDeferred.resolve(true);

		const navResult = await navPromise;
		expect(navResult).toBe(true);
		expect(workspace.view).toBe("help");

		// 5. Navigate back to Outline
		const backResult = await workspace.goBack();
		expect(backResult).toBe(true);
		expect(workspace.view).toBe("outline");

		// 6. Property 1: New edit 'text B' MUST NOT be lost, nor marked clean falsely.
		expect(longForm.state.text).toBe("text B");
		if (dbText === "text B") {
			expect(longForm.state.text).toBe(dbText);
		} else {
			expect(longForm.state.dirty).toBe(true);
		}
	});
});
