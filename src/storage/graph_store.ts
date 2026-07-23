import type {
	Knot,
	LexicalHit,
	LinkType,
	OutlineItem,
	OutlineLink,
	SavedRuleQuery,
	SearchAlias,
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
	suggestItems(prefix: string, limit: number): Promise<OutlineItem[]>;
	searchLexical(query: string, limit: number): Promise<LexicalHit[]>;
	listAliases(): Promise<SearchAlias[]>;
	upsertAlias(alias: SearchAlias): Promise<void>;
	deleteAlias(id: string): Promise<void>;
	getEmergenceFeedback(id: string): Promise<"accept" | "dismiss" | "pin" | null>;
	setEmergenceFeedback(id: string, action: "accept" | "dismiss" | "pin"): Promise<void>;
	listSavedRuleQueries(): Promise<SavedRuleQuery[]>;
	upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void>;
	deleteSavedRuleQuery(id: string): Promise<void>;
}
