export const LINK_TYPES = ["LIKE", "FIX", "VS", "IN"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export interface OutlineItem {
	id: string;
	text: string;
	parentId: string | null;
	orderKey: number;
	collapsed: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface OutlineLink {
	fromId: string;
	toId: string;
	type: LinkType;
	createdAt: string;
}

export interface Knot {
	id: string;
	cycleIds: string[];
	createdAt: string;
}

export interface OutlineSnapshot {
	items: OutlineItem[];
	links: OutlineLink[];
	knots: Knot[];
	stashItemIds: string[];
}

export interface CreateItemInput {
	text: string;
	parentId: string | null;
	afterId?: string | null;
}

export interface MoveItemInput {
	id: string;
	parentId: string | null;
	afterId?: string | null;
}

export interface CreateLinkInput {
	fromId: string;
	toId: string;
	type: LinkType;
}

export interface SearchResult {
	item: OutlineItem;
	ancestorIds: string[];
}
