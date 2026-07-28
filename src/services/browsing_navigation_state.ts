import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";

export interface BrowsingLocation {
	readonly selectedOccurrenceId: string | null;
	readonly hoistOccurrenceId: string | null;
}

export interface BrowsingPane {
	readonly id: string;
	readonly history: readonly BrowsingLocation[];
	readonly historyIndex: number;
}

export interface BrowsingNavigationState {
	readonly activePaneId: string;
	readonly panes: readonly BrowsingPane[];
}

export interface BrowsingOutlineProjection {
	readonly items: readonly OutlineItem[];
	readonly rootOccurrenceIds: readonly string[];
	readonly breadcrumb: readonly OutlineItem[];
}

const EMPTY_LOCATION: BrowsingLocation = {
	selectedOccurrenceId: null,
	hoistOccurrenceId: null,
};

export function createBrowsingNavigationState(
	paneId = "pane-1",
	initial: BrowsingLocation = EMPTY_LOCATION,
): BrowsingNavigationState {
	return {
		activePaneId: paneId,
		panes: [{ id: paneId, history: [initial], historyIndex: 0 }],
	};
}

export function activeBrowsingPane(state: BrowsingNavigationState): BrowsingPane {
	const pane = state.panes.find((candidate) => candidate.id === state.activePaneId);
	if (!pane) throw new Error(`Active browsing pane not found: ${state.activePaneId}`);
	return pane;
}

export function currentBrowsingLocation(state: BrowsingNavigationState): BrowsingLocation {
	const pane = activeBrowsingPane(state);
	return pane.history[pane.historyIndex] ?? EMPTY_LOCATION;
}

export function browseToOccurrence(
	state: BrowsingNavigationState,
	selectedOccurrenceId: string | null,
): BrowsingNavigationState {
	const current = currentBrowsingLocation(state);
	return pushLocation(state, { ...current, selectedOccurrenceId });
}

export function browseToOutlineOccurrence(
	state: BrowsingNavigationState,
	snapshot: OutlineSnapshot,
	selectedOccurrenceId: string | null,
): BrowsingNavigationState {
	const current = currentBrowsingLocation(state);
	const remainsInHoist = !current.hoistOccurrenceId || !selectedOccurrenceId ||
		isDescendantOrSelf(snapshot.items, selectedOccurrenceId, current.hoistOccurrenceId);
	return pushLocation(state, {
		selectedOccurrenceId,
		hoistOccurrenceId: remainsInHoist ? current.hoistOccurrenceId : null,
	});
}

export function setBrowsingHoist(
	state: BrowsingNavigationState,
	hoistOccurrenceId: string | null,
): BrowsingNavigationState {
	const current = currentBrowsingLocation(state);
	return pushLocation(state, {
		selectedOccurrenceId: hoistOccurrenceId ?? current.selectedOccurrenceId,
		hoistOccurrenceId,
	});
}

export function moveBrowsingHistory(
	state: BrowsingNavigationState,
	delta: -1 | 1,
): BrowsingNavigationState {
	return updateActivePane(state, (pane) => ({
		...pane,
		historyIndex: Math.max(0, Math.min(pane.history.length - 1, pane.historyIndex + delta)),
	}));
}

export function canMoveBrowsingHistory(
	state: BrowsingNavigationState,
	delta: -1 | 1,
): boolean {
	const pane = activeBrowsingPane(state);
	const nextIndex = pane.historyIndex + delta;
	return nextIndex >= 0 && nextIndex < pane.history.length;
}

export function openBrowsingPane(
	state: BrowsingNavigationState,
	paneId: string,
	initial: BrowsingLocation = currentBrowsingLocation(state),
): BrowsingNavigationState {
	if (state.panes.some((pane) => pane.id === paneId)) {
		throw new Error(`Browsing pane already exists: ${paneId}`);
	}
	return {
		activePaneId: paneId,
		panes: [...state.panes, { id: paneId, history: [initial], historyIndex: 0 }],
	};
}

export function activateBrowsingPane(
	state: BrowsingNavigationState,
	paneId: string,
): BrowsingNavigationState {
	if (!state.panes.some((pane) => pane.id === paneId)) {
		throw new Error(`Browsing pane not found: ${paneId}`);
	}
	return { ...state, activePaneId: paneId };
}

export function reconcileBrowsingState(
	state: BrowsingNavigationState,
	snapshot: OutlineSnapshot,
): BrowsingNavigationState {
	const ids = new Set(snapshot.items.map((item) => item.id));
	return {
		...state,
		panes: state.panes.map((pane) => {
			const current = pane.history[pane.historyIndex];
			if (!current) return pane;
			const selectedOccurrenceId = current.selectedOccurrenceId &&
					ids.has(current.selectedOccurrenceId)
				? current.selectedOccurrenceId
				: null;
			const hoistOccurrenceId = current.hoistOccurrenceId && ids.has(current.hoistOccurrenceId)
				? current.hoistOccurrenceId
				: null;
			if (
				selectedOccurrenceId === current.selectedOccurrenceId &&
				hoistOccurrenceId === current.hoistOccurrenceId
			) return pane;
			const history = pane.history.map((entry, index) =>
				index === pane.historyIndex ? { selectedOccurrenceId, hoistOccurrenceId } : entry
			);
			return { ...pane, history };
		}),
	};
}

export function projectBrowsingOutline(
	snapshot: OutlineSnapshot,
	hoistOccurrenceId: string | null,
): BrowsingOutlineProjection {
	const byId = new Map(snapshot.items.map((item) => [item.id, item]));
	if (!hoistOccurrenceId || !byId.has(hoistOccurrenceId)) {
		return {
			items: snapshot.items,
			rootOccurrenceIds: snapshot.items.filter((item) => item.parentId === null).map((item) =>
				item.id
			),
			breadcrumb: [],
		};
	}

	const included = new Set<string>();
	const children = childrenByParent(snapshot.items);
	const visit = (id: string) => {
		if (included.has(id)) return;
		included.add(id);
		for (const child of children.get(id) ?? []) visit(child.id);
	};
	visit(hoistOccurrenceId);

	return {
		items: snapshot.items.filter((item) => included.has(item.id)),
		rootOccurrenceIds: [hoistOccurrenceId],
		breadcrumb: ancestorBreadcrumb(snapshot, hoistOccurrenceId),
	};
}

export function ancestorBreadcrumb(
	snapshot: OutlineSnapshot,
	occurrenceId: string | null,
): readonly OutlineItem[] {
	if (!occurrenceId) return [];
	const byId = new Map(snapshot.items.map((item) => [item.id, item]));
	const result: OutlineItem[] = [];
	const seen = new Set([occurrenceId]);
	let parentId = byId.get(occurrenceId)?.parentId ?? null;
	while (parentId && !seen.has(parentId)) {
		seen.add(parentId);
		const parent = byId.get(parentId);
		if (!parent) break;
		result.unshift(parent);
		parentId = parent.parentId;
	}
	return result;
}

function pushLocation(
	state: BrowsingNavigationState,
	location: BrowsingLocation,
): BrowsingNavigationState {
	const current = currentBrowsingLocation(state);
	if (
		current.selectedOccurrenceId === location.selectedOccurrenceId &&
		current.hoistOccurrenceId === location.hoistOccurrenceId
	) return state;
	return updateActivePane(state, (pane) => {
		const history = [...pane.history.slice(0, pane.historyIndex + 1), location];
		return { ...pane, history, historyIndex: history.length - 1 };
	});
}

function updateActivePane(
	state: BrowsingNavigationState,
	update: (pane: BrowsingPane) => BrowsingPane,
): BrowsingNavigationState {
	return {
		...state,
		panes: state.panes.map((pane) => pane.id === state.activePaneId ? update(pane) : pane),
	};
}

function childrenByParent(items: readonly OutlineItem[]): Map<string, OutlineItem[]> {
	const children = new Map<string, OutlineItem[]>();
	for (const item of items) {
		if (!item.parentId) continue;
		const bucket = children.get(item.parentId) ?? [];
		bucket.push(item);
		children.set(item.parentId, bucket);
	}
	return children;
}

function isDescendantOrSelf(
	items: readonly OutlineItem[],
	occurrenceId: string,
	ancestorId: string,
): boolean {
	const byId = new Map(items.map((item) => [item.id, item]));
	const seen = new Set<string>();
	let currentId: string | null = occurrenceId;
	while (currentId && !seen.has(currentId)) {
		if (currentId === ancestorId) return true;
		seen.add(currentId);
		currentId = byId.get(currentId)?.parentId ?? null;
	}
	return false;
}
