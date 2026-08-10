import type {
	CreateItemInput,
	CreateOccurrenceInput,
	Knot,
	MoveItemInput,
	OutlineItem,
	OutlineSnapshot,
	PurgeManifest,
	Revision,
	TrashEntry,
} from "../domain/models.ts";
import type { OutlineStorePort, RelationStorePort, WorkStorePort } from "../storage/graph_store.ts";

const ORDER_STEP = 1024;

type OccurrenceStore = OutlineStorePort & RelationStorePort & WorkStorePort;

/**
 * Store-port-backed operations for persistent Work and Occurrence state.
 * This class deliberately retains outline projection side effects: listing an
 * outline refreshes its persisted knot projection.
 */
export class OccurrenceOperations {
	constructor(private readonly store: OccurrenceStore) {}

	async listOutline(): Promise<OutlineSnapshot> {
		const items = await this.store.listItems();
		const knots = this.detectKnots(items);
		await this.store.replaceKnots(knots);
		const stashItemIds = [...new Set(knots.flatMap((knot) => knot.cycleIds))];
		return {
			items: this.markRecursivePlacements(items),
			links: await this.listActiveLinks(),
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
			parentOccurrenceId: input.parentId,
			orderKey: this.orderAfter(items, input.parentId, input.afterId ?? null),
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
			parentId: input.parentId,
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
		if (!source) {
			const work = (await this.store.listWorks()).find((candidate) =>
				candidate.id === input.workId
			);
			if (!work) throw new Error(`Work not found: ${input.workId}`);
			const mains = (await this.store.listBranches(input.workId)).filter((branch) =>
				branch.name === "main" && !branch.archivedAt
			);
			if (mains.length !== 1) {
				throw new Error(`Expected one active main Branch for Work: ${input.workId}`);
			}
			const main = mains[0];
			const copy = (await this.store.listWorkingCopies(input.workId)).find((candidate) =>
				candidate.branchId === main.id
			);
			if (!copy) throw new Error(`Working Copy not found for Branch: ${main.id}`);
			source = {
				id: "",
				workId: work.id,
				text: copy.text,
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId: main.id },
				createdAt: work.createdAt,
				updatedAt: copy.updatedAt,
			};
		}
		const occurrence = {
			id: crypto.randomUUID(),
			workId: input.workId,
			parentOccurrenceId: input.parentId,
			orderKey: this.orderAfter(items, input.parentId, input.afterId ?? null),
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
		await this.store.updateOccurrence({
			id: item.id,
			workId: item.workId,
			parentOccurrenceId: item.parentId,
			orderKey: item.orderKey,
			collapsed,
			revisionSelector: item.revisionSelector,
			contextualHeading: item.contextualHeading,
		});
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
			parentOccurrenceId: input.parentId,
			orderKey,
			collapsed: item.collapsed,
			revisionSelector: item.revisionSelector,
			contextualHeading: item.contextualHeading,
		});
		await this.reconcileKnots();
	}

	async deleteItem(id: string): Promise<void> {
		const items = await this.store.listItems();
		const item = items.find((candidate) => candidate.id === id);
		if (!item) return;
		const children = items.filter((candidate) => candidate.parentId === id)
			.sort((a, b) => a.orderKey - b.orderKey);
		let afterId =
			items.filter((candidate) => candidate.parentId === item.parentId && candidate.id !== id)
				.sort((a, b) => a.orderKey - b.orderKey)
				.filter((candidate) => candidate.orderKey < item.orderKey).at(-1)?.id ?? null;
		for (const child of children) {
			await this.moveItem({ id: child.id, parentId: item.parentId, afterId });
			afterId = child.id;
		}
		await this.store.deleteOccurrence(id);
		await this.reconcileKnots();
		await this.trashBlankUnplacedWork(item.workId);
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

	private async listActiveLinks() {
		return (await this.store.listLinks()).filter((link) => link.status !== "retracted");
	}

	private markRecursivePlacements(items: OutlineItem[]): OutlineItem[] {
		const byId = new Map(items.map((item) => [item.id, item]));
		return items.map((item) => {
			const visited = new Set<string>();
			let parentId = item.parentId;
			while (parentId) {
				if (visited.has(parentId)) break;
				visited.add(parentId);
				const parent = byId.get(parentId);
				if (!parent) break;
				if (parent.workId === item.workId) return { ...item, referenceStub: true };
				parentId = parent.parentId;
			}
			return item;
		});
	}

	private fingerprint(value: string): string {
		let hash = 2166136261;
		for (const char of value) {
			hash ^= char.codePointAt(0) ?? 0;
			hash = Math.imul(hash, 16777619);
		}
		return `s-${(hash >>> 0).toString(16)}`;
	}

	private async requireItem(id: string): Promise<OutlineItem> {
		const item = (await this.store.listItems()).find((candidate) => candidate.id === id);
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
		if (index < 0 || index === siblings.length - 1) return siblings.at(-1)!.orderKey + ORDER_STEP;
		return (siblings[index].orderKey + siblings[index + 1].orderKey) / 2;
	}

	private detectKnots(items: OutlineItem[]): Knot[] {
		const byId = new Map(items.map((item) => [item.id, item]));
		const signatures = new Set<string>();
		const knots: Knot[] = [];
		for (const start of items) {
			const path: string[] = [];
			const position = new Map<string, number>();
			let current: OutlineItem | undefined = start;
			while (current) {
				const existing = position.get(current.id);
				if (existing !== undefined) {
					const cycleIds = path.slice(existing).sort();
					const signature = cycleIds.join(":");
					if (!signatures.has(signature)) {
						signatures.add(signature);
						knots.push({
							id: this.fingerprint(`knot:${signature}`),
							cycleIds,
							createdAt: new Date().toISOString(),
						});
					}
					break;
				}
				position.set(current.id, path.length);
				path.push(current.id);
				if (current.parentId && !byId.has(current.parentId)) {
					const signature = `orphan:${current.id}`;
					if (!signatures.has(signature)) {
						signatures.add(signature);
						knots.push({
							id: this.fingerprint(`knot:${signature}`),
							cycleIds: [current.id],
							createdAt: new Date().toISOString(),
						});
					}
					break;
				}
				current = current.parentId ? byId.get(current.parentId) : undefined;
			}
		}
		return knots;
	}

	private async reconcileKnots(): Promise<void> {
		await this.store.replaceKnots(this.detectKnots(await this.store.listItems()));
	}
}
