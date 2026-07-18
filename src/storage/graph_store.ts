import type {
	Knot,
	LinkType,
	OutlineItem,
	OutlineLink,
} from "../domain/models.ts";

export interface GraphStore {
	initialize(): Promise<void>;
	close(): Promise<void>;
	listItems(): Promise<OutlineItem[]>;
	createItem(item: OutlineItem): Promise<void>;
	updateItem(item: OutlineItem): Promise<void>;
	deleteItem(id: string): Promise<void>;
	setParent(childId: string, parentId: string | null): Promise<void>;
	listLinks(): Promise<OutlineLink[]>;
	createLink(link: OutlineLink): Promise<void>;
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void>;
	listKnots(): Promise<Knot[]>;
	replaceKnots(knots: Knot[]): Promise<void>;
}
