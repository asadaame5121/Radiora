import { outlinePublicationFixture } from "./outline_publication_fixture.ts";
import { vi } from "vitest";
import type { HistoricalTime } from "../src/domain/historical_time.ts";
import type { OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import {
	createBrowsingNavigationState,
	currentBrowsingLocation,
} from "../src/services/browsing_navigation_state.ts";
import { HistoricalTimeController } from "../src/ui/historical_time_controller.svelte.ts";
import { LongFormController } from "../src/ui/long_form_controller.svelte.ts";
import type { ScreenDestination } from "../src/ui/screen_navigation_destination.ts";
import { ScreenNavigationWorkspace } from "../src/ui/screen_navigation_workspace.svelte.ts";

export interface DeferredTask<T = unknown> {
	id: string;
	kind: string;
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason?: unknown): void;
	settled: boolean;
}

export class DeferredRegistry {
	private counter = 0;
	private tasks = new Map<string, DeferredTask<unknown>>();

	create<T>(kind: string): DeferredTask<T> {
		const id = `${kind}-${++this.counter}`;
		let resolve!: (value: T) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		const task: DeferredTask<T> = {
			id,
			kind,
			promise,
			settled: false,
			resolve: (val: T) => {
				task.settled = true;
				this.tasks.delete(id);
				resolve(val);
			},
			reject: (err?: unknown) => {
				task.settled = true;
				this.tasks.delete(id);
				reject(err);
			},
		};
		this.tasks.set(id, task);
		return task;
	}

	get pendingTasks(): DeferredTask[] {
		return Array.from(this.tasks.values());
	}

	resolveAll(): void {
		for (const task of this.pendingTasks) {
			task.resolve(undefined);
		}
	}

	rejectAll(reason = new Error("aborted")): void {
		for (const task of this.pendingTasks) {
			task.reject(reason);
		}
	}
}

export interface NavigationHarnessOptions {
	initialItems?: OutlineItem[];
}

export function createNavigationHarness(options: NavigationHarnessOptions = {}) {
	const registry = new DeferredRegistry();

	const defaultItems: OutlineItem[] = options.initialItems ?? [
		{
			id: "root-1",
			workId: "work-1",
			text: "Root 1",
			parentId: null,
			orderKey: 0,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "b-1" },
			createdAt: "2026-10-03T00:00:00Z",
			updatedAt: "2026-10-03T00:00:00Z",
		},
		{
			id: "child-1",
			workId: "work-1",
			text: "Child 1",
			parentId: "root-1",
			orderKey: 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "b-1" },
			createdAt: "2026-10-03T00:00:00Z",
			updatedAt: "2026-10-03T00:00:00Z",
		},
		{
			id: "other-2",
			workId: "work-2",
			text: "Other 2",
			parentId: null,
			orderKey: 2,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "b-2" },
			createdAt: "2026-10-03T00:00:00Z",
			updatedAt: "2026-10-03T00:00:00Z",
		},
	];

	const store = {
		items: new Map<string, OutlineItem>(defaultItems.map((item) => [item.id, { ...item }])),
		historicalTimes: new Map<string, HistoricalTime | null>(),
	};

	let browsing = createBrowsingNavigationState("pane-1", {
		selectedOccurrenceId: "root-1",
		hoistOccurrenceId: null,
	});
	let selectedId: string | null = "root-1";
	let filter = { freeText: "", tagsAll: "", tagsNone: "" };
	let expanded: string[] = [];
	let inspector = { mode: "overview" as const, collapsed: false };
	let isLongFormActive = true;

	const getSnapshot = (): OutlineSnapshot => ({
		items: Array.from(store.items.values()),
		links: [],
		knots: [],
		stashItemIds: [],
	});

	const longForm = new LongFormController({
		flush: async () => undefined,
		save: async (id, text) => {
			const task = registry.create<void>("longform_save");
			await task.promise;
			const existing = store.items.get(id);
			if (existing) {
				store.items.set(id, { ...existing, text, updatedAt: new Date().toISOString() });
			}
		},
		reload: async () => {
			const task = registry.create<boolean>("longform_reload");
			return task.promise;
		},
		reportError: vi.fn(),
	});
	longForm.setMode(true, store.items.get("root-1") ?? null);

	const historicalTime = new HistoricalTimeController({
		save: async (workId, time) => {
			const task = registry.create<void>("time_save");
			await task.promise;
			store.historicalTimes.set(workId, time);
		},
		reload: async () => {
			const task = registry.create<void>("time_reload");
			return task.promise;
		},
		select: (id) => {
			selectedId = id;
		},
	});
	historicalTime.reset(store.items.get("root-1") ?? null);

	const workspace = new ScreenNavigationWorkspace({
		outline: {
			captureBrowsing: () => browsing,
			commitBrowsing: (next) => {
				browsing = next;
			},
			filter: () => filter,
			setFilter: (next) => {
				filter = next;
			},
			expanded: () => expanded,
			setExpanded: (next) => {
				expanded = next;
			},
			inspector: () => inspector,
			setInspector: (next) => {
				inspector = next as typeof inspector;
			},
			longForm: () => isLongFormActive,
			setLongForm: (active, id) => {
				isLongFormActive = active;
				longForm.setMode(active, store.items.get(id ?? "") ?? null);
			},
			capturePosition: () => ({
				focus: "editor",
				editorPosition: {
					itemId: selectedId,
					hoistId: currentBrowsingLocation(browsing).hoistOccurrenceId,
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
		snapshot: getSnapshot,
		readOutline: async () => {
			const task = registry.create<OutlineSnapshot>("read_outline");
			const snap = await task.promise;
			return snap ?? getSnapshot();
		},
		outlinePublication: outlinePublicationFixture((next) => {
			for (const item of next.items) {
				store.items.set(item.id, { ...item });
			}
		}),
		selection: {
			current: () => selectedId,
			guard: (item, current) => historicalTime.canSelect(item, current),
			commit: (id, item) => {
				selectedId = id;
				historicalTime.commitSelection(item);
			},
			cancelPending: () => historicalTime.cancelPending(),
		},
		editor: {
			save: () => longForm.save(false),
			version: () => longForm.editVersion,
			flush: async () => undefined,
		},
		screens: {
			prepare: async (_dest: ScreenDestination) => {
				const task = registry.create<() => void>("screen_prepare");
				const publish = await task.promise;
				return publish ?? (() => undefined);
			},
			focusTree: vi.fn(),
		},
		reportError: vi.fn(),
	});

	return {
		workspace,
		longForm,
		historicalTime,
		registry,
		store,
		state: {
			browsing: () => browsing,
			selectedId: () => selectedId,
			filter: () => filter,
			expanded: () => expanded,
			inspector: () => inspector,
			isLongFormActive: () => isLongFormActive,
			getSnapshot,
		},
	};
}
