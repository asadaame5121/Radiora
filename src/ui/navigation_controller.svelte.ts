import type { OutlineSnapshot } from "../domain/models.ts";
import {
	activateBrowsingPane,
	activeBrowsingPane,
	browseToOutlineOccurrence,
	type BrowsingLocation,
	type BrowsingNavigationState,
	createBrowsingNavigationState,
	currentBrowsingLocation,
	openBrowsingPane,
	projectBrowsingOutline,
	reconcileBrowsingState,
	setBrowsingHoist,
} from "../services/browsing_navigation_state.ts";

export interface NavigationControllerOptions {
	initialPaneId?: string;
	initialLocation?: BrowsingLocation;
	nextPaneNumber?: number;
}

export function createNavigationController(options: NavigationControllerOptions = {}) {
	const initialPaneId = options.initialPaneId ?? "pane-1";
	let browsing = $state<BrowsingNavigationState>(
		createBrowsingNavigationState(initialPaneId, options.initialLocation),
	);
	let nextPaneNumber = options.nextPaneNumber ?? nextPaneNumberAfter(initialPaneId);

	return {
		get browsing() {
			return browsing;
		},
		get browsingLocation() {
			return currentBrowsingLocation(browsing);
		},
		get browsingPane() {
			return activeBrowsingPane(browsing);
		},
		captureBrowsing(): BrowsingNavigationState {
			return $state.snapshot(browsing);
		},
		commitBrowsing(state: BrowsingNavigationState): void {
			browsing = state;
		},
		resetBrowsing(
			paneId = "pane-1",
			initial: BrowsingLocation = { selectedOccurrenceId: null, hoistOccurrenceId: null },
		): BrowsingLocation {
			browsing = createBrowsingNavigationState(paneId, initial);
			nextPaneNumber = nextPaneNumberAfter(paneId);
			return currentBrowsingLocation(browsing);
		},
		browseToOccurrence(snapshot: OutlineSnapshot, occurrenceId: string | null): BrowsingLocation {
			browsing = browseToOutlineOccurrence(browsing, snapshot, occurrenceId);
			return currentBrowsingLocation(browsing);
		},
		addBrowsingPane(): string {
			let paneId: string;
			do paneId = `pane-${nextPaneNumber++}`; while (
				browsing.panes.some((pane) => pane.id === paneId)
			);
			browsing = openBrowsingPane(browsing, paneId);
			return paneId;
		},
		activateBrowsingPane(paneId: string, snapshot: OutlineSnapshot): BrowsingLocation {
			browsing = activateBrowsingPane(browsing, paneId);
			browsing = reconcileBrowsingState(browsing, snapshot);
			return currentBrowsingLocation(browsing);
		},
		setHoist(occurrenceId: string): BrowsingLocation {
			browsing = setBrowsingHoist(browsing, occurrenceId);
			return currentBrowsingLocation(browsing);
		},
		clearHoist(): BrowsingLocation {
			browsing = setBrowsingHoist(browsing, null);
			return currentBrowsingLocation(browsing);
		},
		reconcileBrowsing(snapshot: OutlineSnapshot): BrowsingLocation {
			browsing = reconcileBrowsingState(browsing, snapshot);
			return currentBrowsingLocation(browsing);
		},
		projectBrowsing(snapshot: OutlineSnapshot) {
			return projectBrowsingOutline(snapshot, currentBrowsingLocation(browsing).hoistOccurrenceId);
		},
	};
}

function nextPaneNumberAfter(paneId: string): number {
	const match = /^pane-(\d+)$/.exec(paneId);
	return match ? Number(match[1]) + 1 : 2;
}
