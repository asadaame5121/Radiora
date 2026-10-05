import { outlinePublicationFixture } from "./outline_publication_fixture.ts";
import { vi } from "vitest";
import type { ScreenDestination } from "../src/ui/screen_navigation_destination.ts";
import type { OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import {
	createBrowsingNavigationState,
	currentBrowsingLocation,
} from "../src/services/browsing_navigation_state.ts";
import { HistoricalTimeController } from "../src/ui/historical_time_controller.svelte.ts";
import { ScreenNavigationWorkspace } from "../src/ui/screen_navigation_workspace.svelte.ts";
import { OccurrenceSelectionWorkspace } from "../src/ui/occurrence_selection_workspace.ts";

export function navigationFixture() {
	const item = (id: string): OutlineItem => ({
		id,
		workId: `work-${id}`,
		text: id,
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `branch-${id}` },
		createdAt: "2026-10-03T00:00:00Z",
		updatedAt: "2026-10-03T00:00:00Z",
	});
	const source = item("source"), other = item("other"), created = item("created");
	let snapshot: OutlineSnapshot = {
		items: [source, other, created],
		links: [],
		knots: [],
		stashItemIds: [],
	};
	let selected: string | null = source.id;
	let browsing = createBrowsingNavigationState("pane-2", {
		selectedOccurrenceId: source.id,
		hoistOccurrenceId: source.id,
	});
	const guard = new HistoricalTimeController({
		save: vi.fn(async () => undefined),
		reload: vi.fn(async () => undefined),
		select: vi.fn(),
	});
	guard.reset(source);
	const presentation = vi.fn();
	const prepare = vi.fn(async (_destination: ScreenDestination): Promise<() => void> =>
		presentation
	);
	const reportError = vi.fn();
	const save = vi.fn(async () => true);
	const navigation = new ScreenNavigationWorkspace({
		outline: {
			captureBrowsing: () => browsing,
			commitBrowsing: (next) => browsing = next,
			filter: () => ({ freeText: "", tagsAll: "", tagsNone: "" }),
			setFilter: vi.fn(),
			expanded: () => [],
			setExpanded: vi.fn(),
			inspector: () => ({ mode: "overview", collapsed: false }),
			setInspector: vi.fn(),
			longForm: () => false,
			setLongForm: vi.fn(),
			capturePosition: () => ({
				focus: "editor",
				editorPosition: {
					itemId: source.id,
					hoistId: source.id,
					start: 4,
					end: 4,
					scrollTop: 0,
					scrollLeft: 0,
					panelScrollTop: 50,
				},
				panelScrollTop: 50,
				panelScrollLeft: 0,
			}),
			restorePosition: vi.fn(async () => undefined),
		},
		snapshot: () => snapshot,
		readOutline: async () => snapshot,
		outlinePublication: outlinePublicationFixture((next) => snapshot = next),
		selection: {
			current: () => selected,
			guard: (next, current) => guard.canSelect(next, current),
			commit: (id, next) => selection.commitPrepared(id, next),
			cancelPending: () => selection.cancelPending(),
		},
		editor: { save, flush: vi.fn(async () => undefined), version: () => 0 },
		screens: { prepare, focusTree: vi.fn() },
		reportError,
	});
	const selection = new OccurrenceSelectionWorkspace({
		current: () => selected,
		publish: (id) => selected = id,
		snapshot: () => snapshot,
		publishStartupSnapshot: (next) => {
			snapshot = next;
			return true;
		},
		interruptNavigation: () => navigation.invalidate(),
		clearCompletions: vi.fn(),
		form: guard,
		outline: {
			visible: () => navigation.view === "outline",
			browsing: () => browsing,
			publishBrowsing: (next) => browsing = next,
			expanded: () => [],
			publishExpanded: vi.fn(),
			capturePanels: vi.fn(),
			restorePane: vi.fn(async () => undefined),
		},
		reportError,
	});
	return {
		navigation,
		selection,
		source,
		other,
		created,
		snapshot: () => snapshot,
		guard,
		selected: () => selected,
		location: () => currentBrowsingLocation(browsing),
		prepare,
		presentation,
		reportError,
		save,
		dirty: () => {
			guard.draft.start.year = "2026";
			guard.draft.start.unknown = false;
		},
		selectAway: () => {
			selected = other.id;
			guard.reset(other);
		},
	};
}
