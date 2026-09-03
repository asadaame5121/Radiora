import type {
	CreateLinkInput,
	LinkType,
	OutlineLink,
	SearchRequest,
	SearchResult,
} from "../domain/models.ts";
import { isSymmetricLinkType } from "../domain/models.ts";

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 16;

export type LinkDirection = "outgoing" | "incoming";

export type LinkEditorControllerPorts = {
	onConfirm: (input: CreateLinkInput) => void | Promise<void>;
	onDelete: (link: OutlineLink) => void | Promise<void>;
	onReverse: (link: OutlineLink) => void | Promise<void>;
	onCompare?: (link: OutlineLink) => void | Promise<void>;
	onSearch: (request: SearchRequest | string) => Promise<SearchResult[]>;
	isSymmetricRelationType?: (type: LinkType) => boolean;
};

export class LinkEditorController {
	searchQuery = $state("");
	searchResults = $state<SearchResult[]>([]);
	searching = $state(false);
	searchError = $state("");
	selectedType = $state<LinkType>("LIKE");
	direction = $state<LinkDirection>("outgoing");
	reason = $state("");
	submitting = $state(false);
	activeLinkId = $state<string | null>(null);

	private searchTimer: number | undefined;
	private searchRequestId = 0;
	private ports: LinkEditorControllerPorts;

	constructor(ports: LinkEditorControllerPorts) {
		this.ports = ports;
	}

	updatePorts(ports: LinkEditorControllerPorts): void {
		this.ports = ports;
	}

	reset(): void {
		this.clearSearch();
		this.direction = "outgoing";
		this.reason = "";
	}

	scheduleSearch(selectedWorkId: string): void {
		if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
		const requestId = ++this.searchRequestId;
		const query = this.searchQuery.trim();
		this.searchError = "";
		this.searchResults = [];
		if (!query) {
			this.searching = false;
			return;
		}
		this.searching = true;
		this.searchTimer = window.setTimeout(
			() => void this.executeSearch(query, selectedWorkId, requestId),
			SEARCH_DEBOUNCE_MS,
		);
	}

	private async executeSearch(
		query: string,
		selectedWorkId: string,
		requestId: number,
	): Promise<void> {
		try {
			const results = await this.ports.onSearch({
				query,
				contextItemId: selectedWorkId,
				limit: SEARCH_LIMIT,
			});
			if (requestId !== this.searchRequestId) return;
			const seenWorkIds = new Set<string>();
			this.searchResults = results.filter((result) => {
				if (result.item.workId === selectedWorkId || seenWorkIds.has(result.item.workId)) {
					return false;
				}
				seenWorkIds.add(result.item.workId);
				return true;
			});
		} catch (cause) {
			if (requestId === this.searchRequestId) this.searchError = errorMessage(cause);
		} finally {
			if (requestId === this.searchRequestId) this.searching = false;
		}
	}

	clearSearch(): void {
		this.searchRequestId++;
		if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
		this.searchTimer = undefined;
		this.searchQuery = "";
		this.searchResults = [];
		this.searchError = "";
		this.searching = false;
	}

	async addLink(result: SearchResult, selectedWorkId: string): Promise<void> {
		if (this.submitting || result.item.workId === selectedWorkId) return;
		const fromId = this.direction === "outgoing" ? selectedWorkId : result.item.workId;
		const toId = this.direction === "outgoing" ? result.item.workId : selectedWorkId;
		try {
			this.submitting = true;
			this.searchError = "";
			await this.ports.onConfirm({
				fromId,
				toId,
				type: this.selectedType,
				reason: this.reason.trim() || undefined,
			});
			this.clearSearch();
		} catch (cause) {
			this.searchError = errorMessage(cause);
		} finally {
			this.submitting = false;
		}
	}

	async deleteLink(link: OutlineLink): Promise<void> {
		if (this.activeLinkId || this.submitting || link.origin === "derived") return;
		try {
			this.activeLinkId = link.id;
			this.searchError = "";
			await this.ports.onDelete(link);
		} catch (cause) {
			this.searchError = errorMessage(cause);
		} finally {
			this.activeLinkId = null;
		}
	}

	async reverseLink(link: OutlineLink): Promise<void> {
		const isSymmetric = this.ports.isSymmetricRelationType
			? this.ports.isSymmetricRelationType(link.type)
			: isSymmetricLinkType(link.type);
		if (
			this.activeLinkId || this.submitting || isSymmetric ||
			link.origin === "derived"
		) return;
		try {
			this.activeLinkId = link.id;
			this.searchError = "";
			await this.ports.onReverse(link);
		} catch (cause) {
			this.searchError = errorMessage(cause);
		} finally {
			this.activeLinkId = null;
		}
	}

	async compareLink(link: OutlineLink): Promise<void> {
		if (this.activeLinkId || this.submitting || !this.ports.onCompare) return;
		try {
			this.activeLinkId = link.id;
			this.searchError = "";
			await this.ports.onCompare(link);
		} catch (cause) {
			this.searchError = errorMessage(cause);
		} finally {
			this.activeLinkId = null;
		}
	}

	destroy(): void {
		if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
	}
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
