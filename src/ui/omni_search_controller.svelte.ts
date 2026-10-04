import type { SearchRequest, SearchResult, Suggestion } from "../domain/models.ts";
export interface OmniSearchPort {
	suggestItems(prefix: string, limit?: number): Promise<Suggestion[]>;
	searchItems(request: SearchRequest | string): Promise<SearchResult[]>;
	getSelectedId(): string | null;
	reportError(cause: unknown): void;
}

export type OmniwindowEntry =
	| { kind: "suggestion"; value: Suggestion }
	| { kind: "result"; value: SearchResult };

export interface OmniSearchOptions {
	searchPort?: OmniSearchPort;
	recordSearch?: (outcome: "ok" | "error", durationMs: number) => void;
}
export function createOmniSearchController(options: OmniSearchOptions = {}) {
	return new OmniSearchController(options);
}

const SUGGESTION_LIMIT = 8;
const SUGGESTION_DEBOUNCE_MS = 100;
const SEARCH_DEBOUNCE_MS = 250;

export class OmniSearchController {
	constructor(private readonly options: OmniSearchOptions) {}
	private disposed = false;
	private liveQuickCaptureText = $state("");
	private liveSuggestions = $state<Suggestion[]>([]);
	private liveSearchResults = $state<SearchResult[]>([]);
	private liveSearchActiveIndex = $state(-1);
	private suggestTimer: ReturnType<typeof setTimeout> | undefined;
	private searchTimer: ReturnType<typeof setTimeout> | undefined;
	private searchRequestId = 0;
	private searchRecorded = false;

	private clearSearchTimers(): void {
		if (this.suggestTimer !== undefined) clearTimeout(this.suggestTimer);
		if (this.searchTimer !== undefined) clearTimeout(this.searchTimer);
		this.suggestTimer = undefined;
		this.searchTimer = undefined;
	}

	private searchPort(): OmniSearchPort {
		if (!this.options.searchPort) {
			throw new Error("Navigation search port is not configured");
		}
		return this.options.searchPort;
	}

	private recordSearch(outcome: "ok" | "error", started: number): void {
		if (this.searchRecorded) return;
		this.searchRecorded = true;
		this.options.recordSearch?.(outcome, performance.now() - started);
	}

	get quickCaptureText() {
		return this.liveQuickCaptureText;
	}
	get suggestions() {
		return this.liveSuggestions;
	}
	get searchResults() {
		return this.liveSearchResults;
	}
	get searchActiveIndex() {
		return this.liveSearchActiveIndex;
	}

	get searchEntries(): readonly OmniwindowEntry[] {
		return [
			...this.liveSuggestions.map((suggestion) => ({
				kind: "suggestion" as const,
				value: suggestion,
			})),
			...this.liveSearchResults.map((result) => ({ kind: "result" as const, value: result })),
		];
	}
	get omniEntryCount() {
		return this.liveSuggestions.length + this.liveSearchResults.length +
			(this.liveQuickCaptureText.trim() ? 1 : 0);
	}
	queueSearch(): void {
		if (this.disposed) return;
		this.clearSearchTimers();
		const requestId = ++this.searchRequestId;
		const query = this.liveQuickCaptureText;
		this.liveSearchActiveIndex = -1;
		this.liveSuggestions = [];
		this.liveSearchResults = [];
		if (!query.trim()) {
			this.searchRecorded = false;
			this.liveSuggestions = [];
			this.liveSearchResults = [];
			return;
		}

		const port = this.searchPort();
		this.suggestTimer = setTimeout(async () => {
			this.suggestTimer = undefined;
			try {
				const next = await port.suggestItems(query, SUGGESTION_LIMIT);
				if (!this.disposed && requestId === this.searchRequestId) this.liveSuggestions = next;
			} catch (cause) {
				if (!this.disposed && requestId === this.searchRequestId) port.reportError(cause);
			}
		}, SUGGESTION_DEBOUNCE_MS);
		this.searchTimer = setTimeout(async () => {
			this.searchTimer = undefined;
			const started = performance.now();
			try {
				const next = await port.searchItems({
					query,
					contextItemId: port.getSelectedId(),
					limit: 20,
				});
				if (!this.disposed && requestId === this.searchRequestId) {
					this.liveSearchResults = next;
					this.recordSearch("ok", started);
				}
			} catch (cause) {
				if (!this.disposed && requestId === this.searchRequestId) {
					this.recordSearch("error", started);
					port.reportError(cause);
				}
			}
		}, SEARCH_DEBOUNCE_MS);
	}
	clearOmniwindow(): void {
		this.searchRecorded = false;
		this.liveQuickCaptureText = "";
		this.searchRequestId++;
		this.clearSearchTimers();
		this.liveSuggestions = [];
		this.liveSearchResults = [];
		this.liveSearchActiveIndex = -1;
	}
	moveSearchActiveIndex(delta: -1 | 1): number {
		this.liveSearchActiveIndex = Math.max(
			-1,
			Math.min(
				this.liveSuggestions.length + this.liveSearchResults.length +
					(this.liveQuickCaptureText.trim() ? 1 : 0) - 1,
				this.liveSearchActiveIndex + delta,
			),
		);
		return this.liveSearchActiveIndex;
	}
	input(value: string): void {
		if (this.disposed) return;
		this.liveQuickCaptureText = value;
		this.queueSearch();
	}
	captureInput(): () => boolean {
		const generation = this.searchRequestId;
		return () => !this.disposed && generation === this.searchRequestId;
	}
	clearAccepted(current: () => boolean): void {
		if (current()) this.clearOmniwindow();
	}
	dispose(): void {
		this.clearOmniwindow();
		this.disposed = true;
	}
	enterEntry(title: (entry: OmniwindowEntry) => string): OmniwindowEntry | "capture" | undefined {
		const entries = this.searchEntries;
		const exact = entries.findIndex((entry) =>
			title(entry).trim() === this.liveQuickCaptureText.trim()
		);
		const index = this.liveSearchActiveIndex >= 0
			? this.liveSearchActiveIndex
			: exact >= 0
			? exact
			: entries.length
			? 0
			: -1;
		return index === entries.length && this.liveQuickCaptureText.trim()
			? "capture"
			: entries[index];
	}
}
