import type { OutlineItem, TransientProjectionNode, Work } from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";

export interface DateRange {
	startInclusive: string;
	endExclusive: string;
}

export interface DateProjectionPlacement {
	occurrence: OutlineItem;
	/** Root-to-parent path; the occurrence itself is kept separately. */
	breadcrumb: OutlineItem[];
}

export interface DateProjectionEntry {
	work: Work;
	/** Null for an unplaced Work; the projection never creates a placement. */
	representative: OutlineItem | null;
	placements: DateProjectionPlacement[];
}

export interface DateProjection {
	range: DateRange;
	created: DateProjectionEntry[];
	updated: DateProjectionEntry[];
}

/**
 * Read-only projection for Today and arbitrary time ranges. It intentionally
 * reads GraphStore directly: generating a view must not create a date parent,
 * Occurrence, or any other persisted state.
 */
export class DateProjectionService {
	constructor(private readonly store: GraphStore) {}

	async project(range: DateRange): Promise<DateProjection> {
		const { start, end } = validateDateRange(range);
		const [works, items, workingCopies] = await Promise.all([
			this.store.listWorks(),
			this.store.listItems(),
			this.store.listWorkingCopies(),
		]);
		const itemsByWork = new Map<string, OutlineItem[]>();
		for (const item of items) {
			const placements = itemsByWork.get(item.workId) ?? [];
			placements.push(item);
			itemsByWork.set(item.workId, placements);
		}
		const itemById = new Map(items.map((item) => [item.id, item]));
		const workingCopyByWorkId = new Map(workingCopies.map((copy) => [copy.workId, copy.text]));
		const created: DateProjectionEntry[] = [];
		const updated: DateProjectionEntry[] = [];
		for (const work of works) {
			const placements = itemsByWork.get(work.id);
			if (!shouldIncludeDateEntry(work, placements ?? [], workingCopyByWorkId)) continue;
			const entry = toEntry(work, placements ?? [], itemById);
			if (isInRange(work.createdAt, start, end)) created.push(entry);
			else if (isInRange(work.updatedAt, start, end)) updated.push(entry);
		}
		return {
			range: { ...range },
			created: created.sort((left, right) => compareEntries(left, right, "createdAt")),
			updated: updated.sort((left, right) => compareEntries(left, right, "updatedAt")),
		};
	}

	async projectNodes(range: DateRange): Promise<TransientProjectionNode[]> {
		const { start, end } = validateDateRange(range);
		const [works, items, workingCopies] = await Promise.all([
			this.store.listWorks(),
			this.store.listItems(),
			this.store.listWorkingCopies(),
		]);
		const workingCopyByWorkId = new Map(workingCopies.map((wc) => [wc.workId, wc.text]));
		const itemsByWork = new Map<string, OutlineItem[]>();
		for (const item of items) {
			const placements = itemsByWork.get(item.workId) ?? [];
			placements.push(item);
			itemsByWork.set(item.workId, placements);
		}
		const itemById = new Map(items.map((item) => [item.id, item]));
		const nodes: TransientProjectionNode[] = [];
		for (const work of works) {
			const placements = itemsByWork.get(work.id);
			if (!shouldIncludeDateEntry(work, placements ?? [], workingCopyByWorkId)) continue;
			const entry = toEntry(work, placements ?? [], itemById);
			const inRange = isInRange(work.createdAt, start, end)
				? "created"
				: isInRange(work.updatedAt, start, end)
				? "updated"
				: null;
			if (!inRange) continue;
			for (const placement of entry.placements) {
				nodes.push({
					workId: placement.occurrence.workId,
					occurrenceId: placement.occurrence.id,
					text: placement.occurrence.text,
					sourceType: "today",
					breadcrumb: placement.breadcrumb.map((item) => item.id),
				});
			}
			if (!entry.placements.length) {
				nodes.push({
					workId: work.id,
					text: workingCopyByWorkId.get(work.id) ?? "",
					sourceType: "today",
				});
			}
		}
		return nodes;
	}
}

function shouldIncludeDateEntry(
	work: Work,
	placements: readonly OutlineItem[],
	workingCopyByWorkId: ReadonlyMap<string, string>,
): boolean {
	if (placements.length > 0 || work.stub) return true;
	return Boolean(workingCopyByWorkId.get(work.id)?.trim());
}

export function validateDateRange(range: DateRange): { start: number; end: number } {
	const start = parseIsoInstant(range?.startInclusive, "startInclusive");
	const end = parseIsoInstant(range?.endExclusive, "endExclusive");
	if (end <= start) throw new Error("Date range endExclusive must be after startInclusive");
	return { start, end };
}

function toEntry(
	work: Work,
	placements: OutlineItem[],
	itemById: Map<string, OutlineItem>,
): DateProjectionEntry {
	const sorted = [...placements].sort((left, right) =>
		left.orderKey - right.orderKey || left.id.localeCompare(right.id)
	);
	return {
		work,
		representative: sorted[0] ?? null,
		placements: sorted.map((occurrence) => ({
			occurrence,
			breadcrumb: breadcrumbFor(occurrence, itemById),
		})),
	};
}

function breadcrumbFor(item: OutlineItem, itemById: Map<string, OutlineItem>): OutlineItem[] {
	const result: OutlineItem[] = [];
	const seen = new Set<string>([item.id]);
	let parentId = item.parentId;
	while (parentId && !seen.has(parentId)) {
		seen.add(parentId);
		const parent = itemById.get(parentId);
		if (!parent) break;
		result.unshift(parent);
		parentId = parent.parentId;
	}
	return result;
}

function parseIsoInstant(value: unknown, name: string): number {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
		throw new Error(`Invalid ISO instant for ${name}`);
	}
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) throw new Error(`Invalid ISO instant for ${name}`);
	return timestamp;
}

function isInRange(value: string, start: number, end: number): boolean {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) && start <= timestamp && timestamp < end;
}

function compareEntries(
	left: DateProjectionEntry,
	right: DateProjectionEntry,
	field: "createdAt" | "updatedAt",
): number {
	const rightTime = Date.parse(right.work[field]);
	const leftTime = Date.parse(left.work[field]);
	if (Number.isFinite(rightTime) && Number.isFinite(leftTime) && rightTime !== leftTime) {
		return rightTime - leftTime;
	}
	return right.work[field].localeCompare(left.work[field]) ||
		left.work.id.localeCompare(right.work.id);
}
