import type {
	CreateItemInput,
	CreateOccurrenceInput,
	Knot,
	MoveItemInput,
	OutlineItem,
	OutlineSnapshot,
	PurgeManifest,
	Revision,
	RevisionSelector,
	TrashEntry,
} from "../domain/models.ts";
import type { OutlineStorePort, RelationStorePort, WorkStorePort } from "../storage/graph_store.ts";
import { fetchActiveMergedLinks } from "./implicit_relation.ts";
import { markRecursivePlacements } from "./occurrence_knot_detection.ts";

const ORDER_STEP = 1024;

type OccurrenceStore = OutlineStorePort & RelationStorePort & WorkStorePort;

function collapsedOccurrence(item: OutlineItem, collapsed: boolean) {
	return {
		id: item.id,
		workId: item.workId,
		parentOccurrenceId: item.parentId,
		orderKey: item.orderKey,
		collapsed,
		revisionSelector: item.revisionSelector,
		contextualHeading: item.contextualHeading,
	};
}

/**
 * Store-port-backed operations for persistent Work and Occurrence state.
 */
export class OccurrenceOperations {
	constructor(private readonly store: OccurrenceStore) {}

	async listOutline(): Promise<OutlineSnapshot> {
		const items = await this.store.listItems();
		const knots = await this.store.listKnots();
		const stashItemIds = [...new Set(knots.flatMap((knot) => knot.cycleIds))];
		return {
			items: this.markRecursivePlacements(items),
			links: await this.listActiveLinks(items),
			knots,
			stashItemIds,
		};
	}

	async listRevisions(workId: string): Promise<Revision[]> {
		if (!workId) return [];
		const revisions = await this.store.listRevisions(workId);
		return revisions.sort((left, right) =>
			left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
		);
	}

	async createItem(input: CreateItemInput): Promise<OutlineItem> {
		const items = await this.store.listItems();
		const now = new Date().toISOString();
		const workId = crypto.randomUUID();
		const branchId = crypto.randomUUID();
		const occurrenceId = crypto.randomUUID();
		const occurrence = {
			id: occurrenceId,
			workId,
			parentOccurrenceId: input.parentId ?? null,
			orderKey: this.orderAfter(items, input.parentId ?? null, input.afterId ?? null),
			collapsed: false,
			revisionSelector: { mode: "branch" as const, branchId },
		};
		await this.store.createWorkBundle(
			{ id: workId, createdAt: now, updatedAt: now },
			{ id: branchId, workId, name: "main", headRevisionId: null, createdAt: now },
			{ branchId, workId, text: input.text, updatedAt: now },
			occurrence,
		);
		return {
			id: occurrenceId,
			workId,
			text: input.text,
			parentId: input.parentId ?? null,
			orderKey: occurrence.orderKey,
			collapsed: false,
			revisionSelector: occurrence.revisionSelector,
			createdAt: now,
			updatedAt: now,
		};
	}

	async createOccurrence(input: CreateOccurrenceInput): Promise<OutlineItem> {
		const items = await this.store.listItems();
		if (input.parentId && !items.some((item) => item.id === input.parentId)) {
			throw new Error(`Parent Occurrence not found: ${input.parentId}`);
		}
		let source = items.find((item) => item.workId === input.workId);
		if (input.branchId) {
			source = await this.branchWorkingCopySource(input.workId, input.branchId);
		}
		if (!source) {
			source = await this.branchWorkingCopySource(input.workId);
		}
		const occurrence = {
			id: crypto.randomUUID(),
			workId: input.workId,
			parentOccurrenceId: input.parentId ?? null,
			orderKey: this.orderAfter(items, input.parentId ?? null, input.afterId ?? null),
			collapsed: false,
			revisionSelector: structuredClone(source.revisionSelector),
			contextualHeading: input.contextualHeading?.trim() || undefined,
		};
		await this.store.createOccurrence(occurrence);
		return {
			...source,
			id: occurrence.id,
			parentId: occurrence.parentOccurrenceId,
			orderKey: occurrence.orderKey,
			collapsed: occurrence.collapsed,
			revisionSelector: occurrence.revisionSelector,
			contextualHeading: occurrence.contextualHeading,
		};
	}

	async updateItemText(id: string, text: string): Promise<void> {
		const item = await this.requireItem(id);
		if (item.revisionSelector.mode === "pinned") {
			throw new Error(`Pinned Revision Occurrence is read-only: ${id}`);
		}
		await this.store.updateBranchWorkingCopy(
			item.revisionSelector.branchId,
			text,
			new Date().toISOString(),
		);
	}

	async setCollapsed(id: string, collapsed: boolean): Promise<void> {
		const item = await this.requireItem(id);
		await this.store.updateOccurrence(collapsedOccurrence(item, collapsed));
	}

	async setContextualHeading(id: string, contextualHeading?: string): Promise<void> {
		const item = await this.requireItem(id);
		await this.store.updateOccurrence({
			id: item.id,
			workId: item.workId,
			parentOccurrenceId: item.parentId,
			orderKey: item.orderKey,
			collapsed: item.collapsed,
			revisionSelector: item.revisionSelector,
			contextualHeading: contextualHeading?.trim() || undefined,
		});
	}

	async setOccurrenceRevision(id: string, revisionId: string | null): Promise<void> {
		const item = await this.requireItem(id);
		let revisionSelector: RevisionSelector;
		if (revisionId) {
			const revision = (await this.store.listRevisions(item.workId)).find((candidate) =>
				candidate.id === revisionId
			);
			if (!revision) throw new Error(`Revision not found for Work: ${revisionId}`);
			revisionSelector = { mode: "pinned", revisionId };
		} else {
			const main = (await this.store.listBranches(item.workId)).find((branch) =>
				branch.name === "main" && !branch.archivedAt
			);
			if (!main) throw new Error(`Active main Branch not found for Work: ${item.workId}`);
			revisionSelector = { mode: "branch", branchId: main.id };
		}
		await this.store.updateOccurrence({
			id: item.id,
			workId: item.workId,
			parentOccurrenceId: item.parentId,
			orderKey: item.orderKey,
			collapsed: item.collapsed,
			revisionSelector,
			contextualHeading: item.contextualHeading,
		});
	}

	async moveItem(input: MoveItemInput): Promise<void> {
		const items = await this.store.listItems();
		const item = items.find((candidate) => candidate.id === input.id);
		if (!item) throw new Error(`Outline item not found: ${input.id}`);
		const orderKey = this.orderAfter(
			items.filter((candidate) => candidate.id !== input.id),
			input.parentId,
			input.afterId ?? null,
		);
		await this.store.updateOccurrence({
			id: item.id,
			workId: item.workId,
			parentOccurrenceId: input.parentId ?? null,
			orderKey,
			collapsed: item.collapsed,
			revisionSelector: item.revisionSelector,
			contextualHeading: item.contextualHeading,
		});
	}

	async setCollapsedBatch(ids: readonly string[], collapsed: boolean): Promise<void> {
		if (ids.length === 0) return;
		const run = async () => {
			const idSet = new Set(ids);
			const items = (await this.store.listItems()).filter((item) => idSet.has(item.id));
			for (const item of items) {
				await this.store.updateOccurrence(collapsedOccurrence(item, collapsed));
			}
		};
		if (this.store.batch) {
			await this.store.batch(run);
		} else {
			await run();
		}
	}

	async deleteItem(id: string): Promise<void> {
		const run = async () => {
			const items = await this.store.listItems();
			const item = items.find((candidate) => candidate.id === id);
			if (!item) return;
			await this.deleteOccurrenceWithPromotion(item, items);
			await this.trashBlankUnplacedWork(item.workId);
		};

		if (this.store.batch) {
			await this.store.batch(run);
		} else {
			await run();
		}
	}

	async discardEmptyItems(
		ids: readonly string[],
	): Promise<{ deletedIds: string[]; handledIds: string[] }> {
		const uniqueIds = Array.from(new Set(ids));
		if (uniqueIds.length === 0) {
			return { deletedIds: [], handledIds: [] };
		}
		const run = async () => {
			const items = await this.store.listItems();
			const itemById = new Map(items.map((item) => [item.id, item]));
			const parentIds = new Set(
				items.map((item) => item.parentId).filter((id): id is string => id !== null),
			);

			const toDelete: OutlineItem[] = [];
			for (const id of uniqueIds) {
				const item = itemById.get(id);
				if (!item) continue;
				if (item.text.trim() !== "") continue;
				if (parentIds.has(id)) continue;
				toDelete.push(item);
			}

			const deletedIds: string[] = [];
			const affectedWorkIds = new Set<string>();

			for (const item of toDelete) {
				await this.store.deleteOccurrence(item.id);
				deletedIds.push(item.id);
				affectedWorkIds.add(item.workId);
			}

			if (deletedIds.length > 0) {
				for (const workId of affectedWorkIds) {
					await this.trashBlankUnplacedWork(workId);
				}
			}

			return { deletedIds, handledIds: uniqueIds };
		};

		if (this.store.batch) {
			return await this.store.batch(run);
		}
		return await run();
	}

	private async deleteOccurrenceWithPromotion(
		item: OutlineItem,
		items: OutlineItem[],
	): Promise<void> {
		const children = items.filter((candidate) => candidate.parentId === item.id)
			.sort((a, b) => a.orderKey - b.orderKey);
		let afterId =
			items.filter((candidate) => candidate.parentId === item.parentId && candidate.id !== item.id)
				.sort((a, b) => a.orderKey - b.orderKey)
				.filter((candidate) => candidate.orderKey < item.orderKey).at(-1)?.id ?? null;

		const workingSiblings = items.filter(
			(candidate) => candidate.parentId === item.parentId && candidate.id !== item.id,
		);
		for (const child of children) {
			const orderKey = this.orderAfter(workingSiblings, item.parentId, afterId);
			await this.store.updateOccurrence({
				id: child.id,
				workId: child.workId,
				parentOccurrenceId: item.parentId,
				orderKey,
				collapsed: child.collapsed,
				revisionSelector: child.revisionSelector,
				contextualHeading: child.contextualHeading,
			});
			workingSiblings.push({ ...child, parentId: item.parentId, orderKey });
			afterId = child.id;
		}
		await this.store.deleteOccurrence(item.id);
	}

	async trashWork(id: string): Promise<void> {
		const item = await this.requireItem(id);
		await this.store.trashWork(item.workId, new Date().toISOString());
	}

	async listTrash(): Promise<TrashEntry[]> {
		const works = (await this.store.listWorks(true)).filter((work) => work.deletedAt);
		const occurrences = await this.store.listOccurrences(true);
		const links = await this.store.listLinks();
		return works.map((work) => ({
			work,
			occurrenceCount: occurrences.filter((occurrence) => occurrence.workId === work.id).length,
			linkCount:
				links.filter((link) => link.from.workId === work.id || link.to.workId === work.id).length,
		}));
	}

	restoreWork(workId: string): Promise<void> {
		return this.store.restoreWork(workId);
	}

	async purgeWork(workId: string): Promise<PurgeManifest> {
		const work = (await this.store.listWorks(true)).find((candidate) => candidate.id === workId);
		if (!work?.deletedAt) {
			throw new Error(`Work must be in trash before it can be purged: ${workId}`);
		}
		return this.store.purgeWork(workId);
	}

	private listActiveLinks(items?: readonly OutlineItem[]) {
		return fetchActiveMergedLinks(this.store, items);
	}

	private async branchWorkingCopySource(workId: string, branchId?: string): Promise<OutlineItem> {
		const [work, branches, copies] = await Promise.all([
			this.store.listWorks().then((works) => works.find((candidate) => candidate.id === workId)),
			this.store.listBranches(workId),
			this.store.listWorkingCopies(workId),
		]);
		if (!work) throw new Error(`Work not found: ${workId}`);
		const active = branchId
			? branches.filter((branch) => branch.id === branchId && !branch.archivedAt)
			: branches.filter((branch) => branch.name === "main" && !branch.archivedAt);
		if (active.length !== 1) {
			if (branchId) throw new Error(`Active Branch not found for Work: ${branchId}`);
			throw new Error(`Expected one active main Branch for Work: ${workId}`);
		}
		const branch = active[0];
		const copy = copies.find((candidate) => candidate.branchId === branch.id);
		if (!copy || copy.workId !== workId) {
			throw new Error(`Working Copy not found for Branch: ${branch.id}`);
		}
		return {
			id: "",
			workId: work.id,
			text: copy.text,
			parentId: null,
			orderKey: 0,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: branch.id },
			createdAt: work.createdAt,
			...(work.historicalTime ? { historicalTime: structuredClone(work.historicalTime) } : {}),
			updatedAt: copy.updatedAt,
		};
	}

	private markRecursivePlacements(items: OutlineItem[]): OutlineItem[] {
		return markRecursivePlacements(items);
	}

	private async requireItem(id: string): Promise<OutlineItem> {
		const item = await this.store.getItem(id);
		if (!item) throw new Error(`Outline item not found: ${id}`);
		return item;
	}

	/**
	 * A blank non-Stub Work is only useful while it has an outline placement.
	 * Removing its last placement is the common path for an accidental empty row,
	 * so retain it only as a recoverable trash entry rather than an empty inbox item.
	 */
	private async trashBlankUnplacedWork(workId: string): Promise<void> {
		const [work, occurrences, branches, copies] = await Promise.all([
			this.store.listWorks(true).then((works) =>
				works.find((candidate) => candidate.id === workId)
			),
			this.store.listOccurrences(),
			this.store.listBranches(workId),
			this.store.listWorkingCopies(workId),
		]);
		if (
			!work || work.deletedAt || work.stub ||
			occurrences.some((occurrence) => occurrence.workId === workId)
		) {
			return;
		}
		const main = branches.find((branch) => branch.name === "main" && !branch.archivedAt);
		const copy = main && copies.find((candidate) => candidate.branchId === main.id);
		if (copy && !copy.text.trim()) await this.store.trashWork(workId, new Date().toISOString());
	}

	private orderAfter(
		items: OutlineItem[],
		parentId: string | null,
		afterId: string | null,
	): number {
		const siblings = items.filter((item) => item.parentId === parentId)
			.sort((a, b) => a.orderKey - b.orderKey);
		if (!siblings.length) return ORDER_STEP;
		if (!afterId) return siblings[0].orderKey - ORDER_STEP;
		const index = siblings.findIndex((item) => item.id === afterId);
		const lastSibling = siblings.at(-1);
		if (!lastSibling) return ORDER_STEP;
		if (index < 0 || index === siblings.length - 1) return lastSibling.orderKey + ORDER_STEP;
		return (siblings[index].orderKey + siblings[index + 1].orderKey) / 2;
	}
}
