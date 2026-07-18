import type {
	CreateItemInput,
	CreateLinkInput,
	Knot,
	LinkType,
	MoveItemInput,
	OutlineItem,
	OutlineSnapshot,
	SearchResult,
} from "../domain/models.ts";
import { LINK_TYPES } from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";

const ORDER_STEP = 1024;

export class OutlineService {
	constructor(private readonly store: GraphStore) {}

	async listOutline(): Promise<OutlineSnapshot> {
		const items = await this.store.listItems();
		const knots = this.detectKnots(items);
		await this.store.replaceKnots(knots);
		const stashItemIds = [...new Set(knots.flatMap((knot) => knot.cycleIds))];
		return { items, links: await this.store.listLinks(), knots, stashItemIds };
	}

	async createItem(input: CreateItemInput): Promise<OutlineItem> {
		const items = await this.store.listItems();
		const now = new Date().toISOString();
		const item: OutlineItem = {
			id: crypto.randomUUID(),
			text: input.text,
			parentId: input.parentId,
			orderKey: this.orderAfter(items, input.parentId, input.afterId ?? null),
			collapsed: false,
			createdAt: now,
			updatedAt: now,
		};
		await this.store.createItem(item);
		await this.store.setParent(item.id, item.parentId);
		return item;
	}

	async updateItemText(id: string, text: string): Promise<void> {
		const item = await this.requireItem(id);
		await this.store.updateItem({ ...item, text, updatedAt: new Date().toISOString() });
	}

	async setCollapsed(id: string, collapsed: boolean): Promise<void> {
		const item = await this.requireItem(id);
		await this.store.updateItem({ ...item, collapsed, updatedAt: new Date().toISOString() });
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
		await this.store.setParent(item.id, input.parentId);
		await this.store.updateItem({
			...item,
			parentId: input.parentId,
			orderKey,
			updatedAt: new Date().toISOString(),
		});
		await this.reconcileKnots();
	}

	async deleteItem(id: string): Promise<void> {
		const items = await this.store.listItems();
		const item = items.find((candidate) => candidate.id === id);
		if (!item) return;
		const children = items.filter((candidate) => candidate.parentId === id)
			.sort((a, b) => a.orderKey - b.orderKey);
		let afterId = items.filter((candidate) => candidate.parentId === item.parentId && candidate.id !== id)
			.sort((a, b) => a.orderKey - b.orderKey)
			.filter((candidate) => candidate.orderKey < item.orderKey).at(-1)?.id ?? null;
		for (const child of children) {
			await this.moveItem({ id: child.id, parentId: item.parentId, afterId });
			afterId = child.id;
		}
		await this.store.deleteItem(id);
		await this.reconcileKnots();
	}

	async createLink(input: CreateLinkInput): Promise<void> {
		if (!LINK_TYPES.includes(input.type)) throw new Error(`Unsupported link type: ${input.type}`);
		if (input.fromId === input.toId) throw new Error("A related link cannot target itself");
		await this.store.createLink({ ...input, createdAt: new Date().toISOString() });
	}

	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		return this.store.deleteLink(fromId, toId, type);
	}

	async searchItems(query: string): Promise<SearchResult[]> {
		const normalized = query.trim().toLocaleLowerCase();
		if (!normalized) return [];
		const items = await this.store.listItems();
		const byId = new Map(items.map((item) => [item.id, item]));
		return items
			.filter((item) => item.text.toLocaleLowerCase().includes(normalized))
			.map((item) => ({ item, ancestorIds: this.ancestors(item, byId) }));
	}

	private async requireItem(id: string): Promise<OutlineItem> {
		const item = (await this.store.listItems()).find((candidate) => candidate.id === id);
		if (!item) throw new Error(`Outline item not found: ${id}`);
		return item;
	}

	private orderAfter(items: OutlineItem[], parentId: string | null, afterId: string | null): number {
		const siblings = items.filter((item) => item.parentId === parentId)
			.sort((a, b) => a.orderKey - b.orderKey);
		if (!siblings.length) return ORDER_STEP;
		if (!afterId) return siblings[0].orderKey - ORDER_STEP;
		const index = siblings.findIndex((item) => item.id === afterId);
		if (index < 0 || index === siblings.length - 1) return siblings.at(-1)!.orderKey + ORDER_STEP;
		return (siblings[index].orderKey + siblings[index + 1].orderKey) / 2;
	}

	private ancestors(item: OutlineItem, byId: Map<string, OutlineItem>): string[] {
		const result: string[] = [];
		const visited = new Set([item.id]);
		let parentId = item.parentId;
		while (parentId && !visited.has(parentId)) {
			visited.add(parentId);
			result.unshift(parentId);
			parentId = byId.get(parentId)?.parentId ?? null;
		}
		return result;
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
						knots.push({ id: crypto.randomUUID(), cycleIds, createdAt: new Date().toISOString() });
					}
					break;
				}
				position.set(current.id, path.length);
				path.push(current.id);
				current = current.parentId ? byId.get(current.parentId) : undefined;
			}
		}
		return knots;
	}

	private async reconcileKnots(): Promise<void> {
		await this.store.replaceKnots(this.detectKnots(await this.store.listItems()));
	}
}
