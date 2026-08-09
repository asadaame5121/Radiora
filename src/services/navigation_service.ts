import type {
	Bookmark,
	NavigationTarget,
	Occurrence,
	ResolvedBookmark,
	ResolvedResumePosition,
	ResumePosition,
} from "../domain/models.ts";
import type { OutlineStorePort, WorkStorePort } from "../storage/graph_store.ts";

export class NavigationService {
	constructor(
		private readonly store: OutlineStorePort & WorkStorePort,
		private readonly newId: () => string = () => crypto.randomUUID(),
		private readonly now: () => string = () => new Date().toISOString(),
	) {}

	listBookmarks(): Promise<Bookmark[]> {
		return this.store.listBookmarks();
	}

	async createBookmark(occurrenceId: string): Promise<Bookmark> {
		const occurrence = await this.requireOccurrence(occurrenceId);
		const bookmark: Bookmark = {
			id: this.newId(),
			workId: occurrence.workId,
			occurrenceId,
			createdAt: this.now(),
		};
		await this.store.createBookmark(bookmark);
		return bookmark;
	}

	deleteBookmark(id: string): Promise<void> {
		return this.store.deleteBookmark(id);
	}

	async resolveBookmark(id: string): Promise<ResolvedBookmark> {
		const bookmark = (await this.store.listBookmarks()).find((candidate) => candidate.id === id);
		if (!bookmark) throw new Error(`Bookmark not found: ${id}`);
		return { bookmark, target: await this.resolveTarget(bookmark.workId, bookmark.occurrenceId) };
	}

	async saveResumePosition(occurrenceId: string, caretOffset: number): Promise<ResumePosition> {
		if (!Number.isSafeInteger(caretOffset) || caretOffset < 0) {
			throw new Error(`Invalid caret offset: ${caretOffset}`);
		}
		const occurrence = await this.requireOccurrence(occurrenceId);
		const position: ResumePosition = {
			workId: occurrence.workId,
			occurrenceId,
			caretOffset,
			updatedAt: this.now(),
		};
		await this.store.setResumePosition(position);
		return position;
	}

	async resolveResumePosition(): Promise<ResolvedResumePosition | null> {
		const position = await this.store.getResumePosition();
		if (!position) return null;
		const target = await this.resolveTarget(position.workId, position.occurrenceId);
		const item = target.kind === "occurrence"
			? (await this.store.listItems()).find((candidate) => candidate.id === target.occurrenceId)
			: undefined;
		return {
			position,
			target,
			resolvedCaretOffset: Math.min(position.caretOffset, item?.text.length ?? 0),
		};
	}

	clearResumePosition(): Promise<void> {
		return this.store.clearResumePosition();
	}

	private async requireOccurrence(id: string): Promise<Occurrence> {
		const occurrence = (await this.store.listOccurrences()).find((candidate) =>
			candidate.id === id
		);
		if (!occurrence) throw new Error(`Occurrence not found: ${id}`);
		return occurrence;
	}

	private async resolveTarget(
		workId: string,
		preferredOccurrenceId: string,
	): Promise<NavigationTarget> {
		const work = (await this.store.listWorks()).find((candidate) => candidate.id === workId);
		if (!work) throw new Error(`Work not found: ${workId}`);
		const occurrences = (await this.store.listOccurrences())
			.filter((candidate) => candidate.workId === workId)
			.sort(compareOccurrence);
		const preferred = occurrences.find((candidate) => candidate.id === preferredOccurrenceId);
		const target = preferred ?? occurrences[0];
		if (!target) return { kind: "work", workId, fellBack: true };
		return {
			kind: "occurrence",
			workId,
			occurrenceId: target.id,
			ancestorOccurrenceIds: ancestorIds(target, await this.store.listOccurrences()),
			fellBack: !preferred,
		};
	}
}

function compareOccurrence(left: Occurrence, right: Occurrence): number {
	return left.orderKey - right.orderKey || left.id.localeCompare(right.id);
}

function ancestorIds(target: Occurrence, occurrences: readonly Occurrence[]): string[] {
	const byId = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]));
	const result: string[] = [];
	const seen = new Set([target.id]);
	let parentId = target.parentOccurrenceId;
	while (parentId && !seen.has(parentId)) {
		seen.add(parentId);
		const parent = byId.get(parentId);
		if (!parent) break;
		result.unshift(parent.id);
		parentId = parent.parentOccurrenceId;
	}
	return result;
}
