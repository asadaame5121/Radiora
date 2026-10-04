import { outlinePublicationFixture } from "./outline_publication_fixture.ts";
import { expect, test, vi } from "vitest";
import {
	createBrowsingNavigationState,
	currentBrowsingLocation,
	openBrowsingPane,
} from "../src/services/browsing_navigation_state.ts";
import type { OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import type { ScreenNavigationWorkspacePorts } from "../src/ui/screen_navigation_workspace.svelte.ts";
import { OutlineController } from "../src/ui/outline_controller.svelte.ts";
import { ScreenNavigationWorkspace } from "../src/ui/screen_navigation_workspace.svelte.ts";

vi.mock("svelte", () => ({ tick: async () => undefined }));

function setup(publication?: ScreenNavigationWorkspacePorts["outlinePublication"]) {
	const items = [
		{
			id: "root",
			parentId: null,
			workId: "root-work",
			text: "root",
			revisionSelector: { mode: "branch", branchId: "root" },
		},
		{
			id: "last",
			parentId: "root",
			workId: "last-work",
			text: "last text",
			revisionSelector: { mode: "branch", branchId: "last" },
		},
		{
			id: "other",
			parentId: null,
			workId: "other-work",
			text: "other",
			revisionSelector: { mode: "branch", branchId: "other" },
		},
	] as OutlineItem[];
	let snapshot: OutlineSnapshot = { items, links: [], knots: [], stashItemIds: [] };
	let browsing = openBrowsingPane(
		createBrowsingNavigationState("pane-1", {
			selectedOccurrenceId: "other",
			hoistOccurrenceId: null,
		}),
		"pane-2",
		{ selectedOccurrenceId: "last", hoistOccurrenceId: "root" },
	);
	let selected: string | null = "last";
	let filter = { freeText: "saved", tagsAll: "", tagsNone: "" };
	let expanded = ["root"];
	let inspector = { mode: "history" as "history" | "query", collapsed: false };
	let manuscript = false;
	let editVersion = 0;
	const viewport = {
		editorPosition: {
			itemId: "last",
			hoistId: "root",
			start: 9,
			end: 9,
			scrollTop: 2,
			scrollLeft: 3,
			panelScrollTop: 450,
		},
		panelScrollTop: 450,
		panelScrollLeft: 12,
		focus: "editor" as const,
	};
	const presentation = vi.fn();
	const prepareScreen = vi.fn(async () => presentation);
	const guard = vi.fn(async () => true);
	const restorePosition = vi.fn(async () => undefined);
	const save = vi.fn(async () => true);
	const readOutline = vi.fn(async () => snapshot);
	const flush = vi.fn(async () => undefined);
	const reportError = vi.fn();
	const workspace = new ScreenNavigationWorkspace({
		outline: {
			captureBrowsing: () => browsing,
			commitBrowsing: (next) => browsing = next,
			filter: () => filter,
			setFilter: (next) => filter = next,
			expanded: () => expanded,
			setExpanded: (next) => expanded = next,
			inspector: () => inspector,
			setInspector: (next) => inspector = next as typeof inspector,
			longForm: () => manuscript,
			setLongForm: (next) => manuscript = next,
			capturePosition: () => viewport,
			restorePosition,
		},
		snapshot: () => snapshot,
		readOutline,
		outlinePublication: publication
			? {
				invalidate: () => publication.invalidate(),
				begin: () => {
					const request = publication.begin();
					return {
						current: request.current,
						publish: (next) => {
							if (!request.publish(next)) return false;
							snapshot = next;
							return true;
						},
					};
				},
			}
			: outlinePublicationFixture((next) => snapshot = next),
		selection: {
			current: () => selected,
			guard,
			commit: (id) => selected = id,
			cancelPending: vi.fn(),
		},
		editor: { save, flush, version: () => editVersion },
		screens: { prepare: prepareScreen, focusTree: vi.fn() },
		reportError,
	});
	return {
		workspace,
		guard,
		save,
		flush,
		reportError,
		readOutline,
		restorePosition,
		presentation,
		prepareScreen,
		browsing: () => browsing,
		selected: () => selected,
		filter: () => filter,
		inspector: () => inspector,
		manuscript: () => manuscript,
		selectAway: () => selected = "other",
		changeFilter: () => filter.freeText = "away",
		snapshot: () => snapshot,
		editInline: (text: string) => {
			editVersion++;
			snapshot = {
				...snapshot,
				items: snapshot.items.map((item) => item.id === "last" ? { ...item, text } : item),
			};
		},
		updateSourceText: () =>
			snapshot = {
				...snapshot,
				items: snapshot.items.map((item) =>
					item.id === "last" ? { ...item, text: "saved while guarding" } : item
				),
			},
		deleteSelection: () =>
			snapshot = { ...snapshot, items: snapshot.items.filter((item) => item.id !== "last") },
		deleteRoot: () =>
			snapshot = { ...snapshot, items: snapshot.items.filter((item) => item.id !== "root") },
		setManuscript: () => manuscript = true,
	};
}

test("multi-screen return preserves Outline Hoist, pane, caret and scroll independently of away selection", async () => {
	const s = setup();
	await s.workspace.navigate({ view: "globalLineage" });
	s.selectAway();
	s.changeFilter();
	await s.workspace.navigate({ view: "help" });
	await s.workspace.goBack();
	expect(s.workspace.view).toBe("outline");
	expect(s.selected()).toBe("last");
	expect(s.browsing().activePaneId).toBe("pane-2");
	expect(s.browsing().panes).toHaveLength(2);
	expect(s.browsing().panes[0].history[0]).toEqual({
		selectedOccurrenceId: "other",
		hoistOccurrenceId: null,
	});
	expect(currentBrowsingLocation(s.browsing()).hoistOccurrenceId).toBe("root");
	expect(s.filter().freeText).toBe("saved");
	expect(s.restorePosition.mock.calls[0][0]).toMatchObject({
		panelScrollTop: 450,
		editorPosition: { itemId: "last", start: 9, end: 9 },
	});
	expect(s.workspace.canGoBack).toBe(false);
});

test("Query switches only the inspector and does not enable Back on Outline", async () => {
	const s = setup();
	await s.workspace.navigate({ view: "outline", query: true });
	expect(s.inspector().mode).toBe("query");
	expect(s.workspace.canGoBack).toBe(false);
});

test("a rejected destination changes no selection, Hoist or presentation", async () => {
	const s = setup();
	await s.workspace.navigate({ view: "today" });
	s.presentation.mockClear();
	s.guard.mockResolvedValueOnce(false);
	await s.workspace.navigate({ view: "outline", occurrenceId: "other" });
	expect(s.workspace.view).toBe("today");
	expect(s.selected()).toBe("last");
	expect(currentBrowsingLocation(s.browsing()).hoistOccurrenceId).toBe("root");
	expect(s.presentation).not.toHaveBeenCalled();
	await s.workspace.goBack();
	expect(s.selected()).toBe("last");
});

test("explicit target outside saved Hoist clears Hoist and becomes the next resume location", async () => {
	const s = setup();
	await s.workspace.navigate({ view: "help" });
	await s.workspace.navigate({ view: "outline", occurrenceId: "other" });
	expect(currentBrowsingLocation(s.browsing()).hoistOccurrenceId).toBeNull();
	await s.workspace.navigate({ view: "help" });
	s.selectAway();
	await s.workspace.goBack();
	expect(s.selected()).toBe("other");
});

test("deleted Hoist is reconciled against latest data without discarding the remaining selection", async () => {
	const s = setup();
	await s.workspace.navigate({ view: "help" });
	s.deleteRoot();
	await s.workspace.goBack();
	expect(currentBrowsingLocation(s.browsing())).toEqual({
		selectedOccurrenceId: "last",
		hoistOccurrenceId: null,
	});
});

test("save and fetch failures retain the resume context for retry", async () => {
	const s = setup();
	await s.workspace.navigate({ view: "help" });
	s.save.mockResolvedValueOnce(false);
	await s.workspace.goBack();
	expect(s.workspace.view).toBe("help");
	s.readOutline.mockRejectedValueOnce(new Error("load failed"));
	await s.workspace.goBack();
	expect(s.workspace.view).toBe("help");
	await s.workspace.goBack();
	expect(s.selected()).toBe("last");
});

test("manuscript mode is retained through screen return", async () => {
	const s = setup();
	s.setManuscript();
	await s.workspace.navigate({ view: "help" });
	await s.workspace.goBack();
	expect(s.manuscript()).toBe(true);
});

test("guard-side saves are included in the snapshot published with the accepted destination", async () => {
	const s = setup();
	await s.workspace.navigate({ view: "help" });
	s.guard.mockImplementationOnce(async () => {
		s.updateSourceText();
		return true;
	});
	await s.workspace.navigate({ view: "outline", occurrenceId: "other" });
	expect(s.snapshot().items.find((item) => item.id === "last")?.text).toBe("saved while guarding");
});

test("a deleted suspended selection resumes without substituting or creating an item", async () => {
	const s = setup();
	await s.workspace.navigate({ view: "help" });
	s.deleteSelection();
	await s.workspace.goBack();
	expect(s.selected()).toBeNull();
	expect(currentBrowsingLocation(s.browsing()).hoistOccurrenceId).toBe("root");
	expect(s.restorePosition.mock.calls[0][0]).toMatchObject({
		focus: "rows",
		editorPosition: undefined,
	});
});

test("a rejected selection does not prepare or publish the destination feature", async () => {
	const s = setup();
	s.guard.mockResolvedValueOnce(false);
	await s.workspace.navigate({
		view: "comparison",
		occurrenceId: "other",
		comparison: { kind: "revision", revisionId: "target-revision" },
	});
	expect(s.workspace.view).toBe("outline");
	expect(s.prepareScreen).not.toHaveBeenCalled();
	expect(s.presentation).not.toHaveBeenCalled();
});

test.each(["selection", "refresh", "screen"] as const)(
	"navigation waits for inline edits queued during %s preparation",
	async (phase) => {
		const s = setup();
		let resumePreparation!: () => void;
		const preparation = new Promise<void>((resolve) => resumePreparation = resolve);
		let saveDraft!: () => void;
		const saving = new Promise<void>((resolve) => saveDraft = resolve);
		let dirty = false;
		s.flush.mockImplementation(async () => {
			if (dirty) {
				await saving;
				dirty = false;
			}
		});
		if (phase === "selection") {
			s.guard.mockImplementationOnce(async () => {
				await preparation;
				return true;
			});
		} else if (phase === "refresh") {
			s.readOutline.mockImplementationOnce(async () => {
				await preparation;
				return s.snapshot();
			});
		} else {
			s.prepareScreen.mockImplementationOnce(async () => {
				await preparation;
				return s.presentation;
			});
		}
		const navigation = s.workspace.navigate({ view: "outline", occurrenceId: "other" });
		await vi.waitFor(() => {
			const pending = phase === "selection"
				? s.guard
				: phase === "refresh"
				? s.readOutline
				: s.prepareScreen;
			expect(pending).toHaveBeenCalled();
		});
		dirty = true;
		resumePreparation();
		await vi.waitFor(() => expect(s.flush).toHaveBeenCalledTimes(2));
		expect(s.selected()).toBe("last");
		expect(s.presentation).not.toHaveBeenCalled();
		expect(s.workspace.pendingView).toBe("outline");
		saveDraft();
		expect(await navigation).toBe(true);
		expect(dirty).toBe(false);
		expect(s.selected()).toBe("other");
	},
);

test("late inline save failure leaves the screen and selection intact and permits retry", async () => {
	const s = setup();
	const error = new Error("inline save failed");
	s.prepareScreen.mockImplementationOnce(async () => {
		s.flush.mockRejectedValueOnce(error);
		return s.presentation;
	});
	expect(await s.workspace.navigate({ view: "help", occurrenceId: "other" })).toBe(false);
	expect(s.workspace.view).toBe("outline");
	expect(s.selected()).toBe("last");
	expect(s.presentation).not.toHaveBeenCalled();
	expect(s.reportError).toHaveBeenCalledWith(error);
	expect(s.workspace.pendingView).toBeNull();
	expect(await s.workspace.navigate({ view: "help", occurrenceId: "other" })).toBe(true);
	expect(s.workspace.view).toBe("help");
});

test.each(["outline", "help"] as const)(
	"%s with an explicit occurrence publishes edits saved after screen preparation",
	async (view) => {
		const s = setup();
		s.readOutline.mockImplementation(async () => structuredClone(s.snapshot()));
		s.prepareScreen.mockImplementationOnce(async () => {
			s.editInline("late inline edit");
			return s.presentation;
		});
		expect(await s.workspace.navigate({ view, occurrenceId: "other" })).toBe(true);
		expect(s.snapshot().items.find((item) => item.id === "last")?.text).toBe("late inline edit");
		expect(s.selected()).toBe("other");
	},
);

test("input during the final snapshot read is saved and fetched again before publication", async () => {
	const s = setup();
	let finishRead!: () => void;
	const reading = new Promise<void>((resolve) => finishRead = resolve);
	s.readOutline.mockImplementationOnce(async () => structuredClone(s.snapshot()));
	s.readOutline.mockImplementationOnce(async () => {
		const old = structuredClone(s.snapshot());
		await reading;
		return old;
	});
	s.readOutline.mockImplementation(async () => structuredClone(s.snapshot()));
	const navigation = s.workspace.navigate({ view: "outline", occurrenceId: "other" });
	await vi.waitFor(() => expect(s.readOutline).toHaveBeenCalledTimes(2));
	s.editInline("typed during final read");
	finishRead();
	expect(await navigation).toBe(true);
	expect(s.snapshot().items.find((item) => item.id === "last")?.text).toBe(
		"typed during final read",
	);
	expect(s.readOutline).toHaveBeenCalledTimes(3);
});

test("a final snapshot failure retains the current screen and allows retry", async () => {
	const s = setup();
	const error = new Error("final read failed");
	s.prepareScreen.mockImplementationOnce(async () => {
		s.editInline("saved late edit");
		s.readOutline.mockRejectedValueOnce(error);
		return s.presentation;
	});
	expect(await s.workspace.navigate({ view: "help", occurrenceId: "other" })).toBe(false);
	expect(s.workspace.view).toBe("outline");
	expect(s.selected()).toBe("last");
	expect(s.snapshot().items.find((item) => item.id === "last")?.text).toBe("saved late edit");
	expect(s.presentation).not.toHaveBeenCalled();
	expect(s.reportError).toHaveBeenCalledWith(error);
	expect(await s.workspace.navigate({ view: "help", occurrenceId: "other" })).toBe(true);
});

test("a newer request prevents a delayed final snapshot from committing", async () => {
	const s = setup();
	let finishRead!: () => void;
	const reading = new Promise<void>((resolve) => finishRead = resolve);
	s.readOutline.mockImplementationOnce(async () => structuredClone(s.snapshot()));
	s.readOutline.mockImplementationOnce(async () => {
		const old = structuredClone(s.snapshot());
		await reading;
		return old;
	});
	const oldNavigation = s.workspace.navigate({ view: "outline", occurrenceId: "other" });
	await vi.waitFor(() => expect(s.readOutline).toHaveBeenCalledTimes(2));
	expect(await s.workspace.navigate({ view: "help" })).toBe(true);
	finishRead();
	expect(await oldNavigation).toBe(false);
	expect(s.workspace.view).toBe("help");
	expect(s.selected()).toBe("last");
	expect(s.presentation).toHaveBeenCalledTimes(1);
});

test("the final refresh reconciles a suspended selection deleted during preparation", async () => {
	const s = setup();
	await s.workspace.navigate({ view: "help" });
	s.prepareScreen.mockImplementationOnce(async () => {
		s.deleteSelection();
		return s.presentation;
	});
	expect(await s.workspace.goBack()).toBe(true);
	expect(s.selected()).toBeNull();
	expect(s.snapshot().items.some((item) => item.id === "last")).toBe(false);
});

test.each(["outline", "help"] as const)(
	"%s rejects an explicit occurrence deleted after its selection guard",
	async (view) => {
		const s = setup();
		s.readOutline.mockResolvedValue({
			...s.snapshot(),
			items: s.snapshot().items.filter((item) => item.id !== "other"),
		});
		expect(await s.workspace.navigate({ view, occurrenceId: "other" })).toBe(false);
		expect(s.workspace.view).toBe("outline");
		expect(s.selected()).toBe("last");
		expect(s.presentation).not.toHaveBeenCalled();
		expect(s.reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "移動先の項目が見つかりません。" }),
		);
	},
);

function publicationOwner() {
	return new OutlineController({
		readOutline: async () => ({ items: [], links: [], knots: [], stashItemIds: [] }),
		readBookmarks: async () => [],
		drafts: () => [],
		prepareTree: () => ({ result: Promise.resolve(), publish: vi.fn(), cancel: vi.fn() }),
		reconcileSelection: vi.fn(),
		selectionReceipt: () => () => true,
		focus: vi.fn(),
		persist: vi.fn(),
		reportError: vi.fn(),
		clearError: vi.fn(),
	});
}

for (const stage of ["guard", "final", "missing target"] as const) {
	for (const failed of [false, true]) {
		test(`reload revokes ${stage} navigation read ${failed ? "failure" : "success"}`, async () => {
			const owner = publicationOwner();
			const s = setup(owner);
			const pending = Promise.withResolvers<OutlineSnapshot>();
			if (stage === "final") s.readOutline.mockResolvedValueOnce(s.snapshot());
			s.readOutline.mockReturnValueOnce(pending.promise);
			const navigating = s.workspace.navigate({
				view: "outline",
				occurrenceId: stage === "missing target" ? "missing" : "other",
			});
			await vi.waitFor(() =>
				expect(s.readOutline).toHaveBeenCalledTimes(stage === "final" ? 2 : 1)
			);
			await owner.reload();
			if (failed) pending.reject(new Error("old navigation"));
			else pending.resolve(s.snapshot());
			expect(await navigating).toBe(false);
			expect(s.selected()).toBe("last");
			expect(s.restorePosition).not.toHaveBeenCalled();
			expect(s.reportError).not.toHaveBeenCalled();
		});
	}
}

test("navigation start retires a reload and permits a legitimate save-triggered reload", async () => {
	const owner = publicationOwner();
	const pendingPublication = owner.begin();
	const s = setup(owner);
	s.save.mockImplementationOnce(async () => {
		await owner.reload();
		return true;
	});
	expect(await s.workspace.navigate({ view: "outline", occurrenceId: "other" })).toBe(true);
	expect(pendingPublication.current()).toBe(false);
	expect(owner.snapshot.items.some((item) => item.id === "other")).toBe(true);
	expect(s.selected()).toBe("other");
});

test("reload after navigation commit prevents delayed viewport restoration", async () => {
	const owner = publicationOwner();
	const s = setup(owner);
	let canRestore: (() => boolean) | undefined;
	s.restorePosition.mockImplementationOnce(async (_position, current) => {
		canRestore = current;
		await owner.reload();
	});
	expect(await s.workspace.navigate({ view: "outline", occurrenceId: "other" })).toBe(true);
	expect(canRestore?.()).toBe(false);
});
