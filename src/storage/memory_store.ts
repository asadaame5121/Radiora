import type { Knot, LinkType, OutlineItem, OutlineLink } from "../domain/models.ts";
import type { GraphStore } from "./graph_store.ts";

export class MemoryGraphStore implements GraphStore {
	items: OutlineItem[] = [];
	links: OutlineLink[] = [];
	knots: Knot[] = [];
	initialize(): Promise<void> { return Promise.resolve(); }
	close(): Promise<void> { return Promise.resolve(); }
	listItems(): Promise<OutlineItem[]> { return Promise.resolve(structuredClone(this.items)); }
	createItem(item: OutlineItem): Promise<void> { this.items.push(structuredClone(item)); return Promise.resolve(); }
	updateItem(item: OutlineItem): Promise<void> {
		this.items = this.items.map((candidate) => candidate.id === item.id ? structuredClone(item) : candidate);
		return Promise.resolve();
	}
	deleteItem(id: string): Promise<void> {
		this.items = this.items.filter((item) => item.id !== id);
		this.links = this.links.filter((link) => link.fromId !== id && link.toId !== id);
		return Promise.resolve();
	}
	setParent(childId: string, parentId: string | null): Promise<void> {
		const item = this.items.find((candidate) => candidate.id === childId);
		if (item) item.parentId = parentId;
		return Promise.resolve();
	}
	listLinks(): Promise<OutlineLink[]> { return Promise.resolve(structuredClone(this.links)); }
	createLink(link: OutlineLink): Promise<void> { this.links.push(structuredClone(link)); return Promise.resolve(); }
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		this.links = this.links.filter((link) => !(link.fromId === fromId && link.toId === toId && link.type === type));
		return Promise.resolve();
	}
	listKnots(): Promise<Knot[]> { return Promise.resolve(structuredClone(this.knots)); }
	replaceKnots(knots: Knot[]): Promise<void> { this.knots = structuredClone(knots); return Promise.resolve(); }
}
