import type { OutlineSnapshot, SearchRequest, SearchResult, Suggestion } from "../domain/models.ts";
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
	searchPort?: NavigationSearchPort;
}

export interface NavigationSearchPort {
	suggestItems(prefix: string, limit?: number): Promise<Suggestion[]>;
	searchItems(request: SearchRequest | string): Promise<SearchResult[]>;
	getSelectedId(): string | null;
	reportError(cause: unknown): void;
}

export type OmniwindowEntry =
	| { kind: "suggestion"; value: Suggestion }
	| { kind: "result"; value: SearchResult };

export function createNavigationController(options: NavigationControllerOptions = {}) {
	const initialPaneId = options.initialPaneId ?? "pane-1";
	let browsing = $state<BrowsingNavigationState>(
		createBrowsingNavigationState(initialPaneId, options.initialLocation),
	);
	let nextPaneNumber = options.nextPaneNumber ?? nextPaneNumberAfter(initialPaneId);
	let commandPaletteOpen = $state(false);
	let commandPaletteQuery = $state("");
	let quickCaptureText = $state("");
	let suggestions = $state<Suggestion[]>([]);
	let searchResults = $state<SearchResult[]>([]);
	let searchActiveIndex = $state(-1);
	let suggestTimer = $state<ReturnType<typeof setTimeout> | undefined>();
	let searchTimer = $state<ReturnType<typeof setTimeout> | undefined>();
	let searchRequestId = $state(0);

	function clearSearchTimers(): void {
		if (suggestTimer !== undefined) clearTimeout(suggestTimer);
		if (searchTimer !== undefined) clearTimeout(searchTimer);
		suggestTimer = undefined;
		searchTimer = undefined;
	}

	function searchPort(): NavigationSearchPort {
		if (!options.searchPort) {
			throw new Error("Navigation search port is not configured");
		}
		return options.searchPort;
	}

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
		get commandPaletteOpen() {
			return commandPaletteOpen;
		},
		get commandPaletteQuery() {
			return commandPaletteQuery;
		},
		set commandPaletteQuery(value: string) {
			commandPaletteQuery = value;
		},
		get quickCaptureText() {
			return quickCaptureText;
		},
		set quickCaptureText(value: string) {
			quickCaptureText = value;
		},
		get suggestions() {
			return suggestions;
		},
		get searchResults() {
			return searchResults;
		},
		get searchActiveIndex() {
			return searchActiveIndex;
		},
		set searchActiveIndex(value: number) {
			searchActiveIndex = value;
		},
		get searchEntries(): readonly OmniwindowEntry[] {
			return [
				...suggestions.map((suggestion) => ({ kind: "suggestion" as const, value: suggestion })),
				...searchResults.map((result) => ({ kind: "result" as const, value: result })),
			];
		},
		get omniEntryCount() {
			return suggestions.length + searchResults.length + (quickCaptureText.trim() ? 1 : 0);
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
		openCommandPalette(): void {
			commandPaletteQuery = "";
			commandPaletteOpen = true;
		},
		closeCommandPalette(): void {
			commandPaletteOpen = false;
		},
		queueSearch(): void {
			clearSearchTimers();
			const requestId = ++searchRequestId;
			const query = quickCaptureText;
			searchActiveIndex = -1;
			if (!query.trim()) {
				suggestions = [];
				searchResults = [];
				return;
			}

			const port = searchPort();
			suggestTimer = setTimeout(async () => {
				suggestTimer = undefined;
				try {
					const next = await port.suggestItems(query, 8);
					if (requestId === searchRequestId) suggestions = next;
				} catch (cause) {
					if (requestId === searchRequestId) port.reportError(cause);
				}
			}, 100);
			searchTimer = setTimeout(async () => {
				searchTimer = undefined;
				try {
					const next = await port.searchItems({
						query,
						contextItemId: port.getSelectedId(),
						limit: 20,
					});
					if (requestId === searchRequestId) searchResults = next;
				} catch (cause) {
					if (requestId === searchRequestId) port.reportError(cause);
				}
			}, 250);
		},
		clearOmniwindow(): void {
			quickCaptureText = "";
			searchRequestId++;
			clearSearchTimers();
			suggestions = [];
			searchResults = [];
			searchActiveIndex = -1;
		},
		moveSearchActiveIndex(delta: -1 | 1): number {
			searchActiveIndex = Math.max(
				-1,
				Math.min(
					suggestions.length + searchResults.length + (quickCaptureText.trim() ? 1 : 0) - 1,
					searchActiveIndex + delta,
				),
			);
			return searchActiveIndex;
		},
	};
}

function nextPaneNumberAfter(paneId: string): number {
	const match = /^pane-(\d+)$/.exec(paneId);
	return match ? Number(match[1]) + 1 : 2;
}
