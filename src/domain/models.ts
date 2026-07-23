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
	score: number;
	reasons: SearchReason[];
}

export type SearchReasonKind =
	| "title"
	| "body"
	| "alias"
	| "direct-link"
	| "shared-link"
	| "shared-ancestor";

export interface SearchReason {
	kind: SearchReasonKind;
	label: string;
	score: number;
}

export interface SearchRequest {
	query: string;
	contextItemId?: string | null;
	limit?: number;
}

export interface Suggestion {
	item: OutlineItem;
	ancestorIds: string[];
	title: string;
}

export interface LexicalHit {
	item: OutlineItem;
	titleScore: number;
	bodyScore: number;
}

export interface SearchAlias {
	id: string;
	canonical: string;
	variants: string[];
	createdAt: string;
	updatedAt: string;
}

export type EmergenceKind = "latent-relation" | "cross-branch-resonance" | "productive-tension";
export type EmergenceAction = "accept" | "dismiss" | "pin";

export interface EvidenceStep {
	fromId: string;
	toId: string;
	relation: LinkType | "PARENT" | "LEXICAL";
}

export interface EmergenceSuggestion {
	id: string;
	kind: EmergenceKind;
	contextItemId: string;
	targetItemId: string;
	proposedLinkType?: LinkType;
	title: string;
	explanation: string;
	evidence: EvidenceStep[];
	score: number;
	status?: "pinned";
}

export interface EmergenceFeedback {
	id: string;
	action: EmergenceAction;
	updatedAt: string;
}

export interface RuleQueryResult {
	columns: string[];
	rows: string[][];
	elapsedMs: number;
}

export interface SavedRuleQuery {
	id: string;
	name: string;
	source: string;
	createdAt: string;
	updatedAt: string;
}
