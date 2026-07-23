import type {
	CreateItemInput,
	CreateLinkInput,
	EmergenceAction,
	EmergenceSuggestion,
	LinkType,
	MoveItemInput,
	OutlineItem,
	OutlineSnapshot,
	RuleQueryResult,
	SavedRuleQuery,
	SearchAlias,
	SearchRequest,
	SearchResult,
	Suggestion,
} from "../domain/models.ts";

export interface RadioraBindings {
	getStartupStatus(): Promise<StartupStatus>;
	retryStartup(): Promise<StartupStatus>;
	listOutline(): Promise<OutlineSnapshot>;
	createItem(input: CreateItemInput): Promise<OutlineItem>;
	updateItemText(id: string, text: string): Promise<void>;
	moveItem(input: MoveItemInput): Promise<void>;
	deleteItem(id: string): Promise<void>;
	setCollapsed(id: string, collapsed: boolean): Promise<void>;
	createLink(input: CreateLinkInput): Promise<void>;
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void>;
	suggestItems(prefix: string, limit?: number): Promise<Suggestion[]>;
	searchItems(request: SearchRequest | string): Promise<SearchResult[]>;
	listSearchAliases(): Promise<SearchAlias[]>;
	saveSearchAlias(
		input: { id?: string; canonical: string; variants: string[] },
	): Promise<SearchAlias>;
	deleteSearchAlias(id: string): Promise<void>;
	listEmergenceSuggestions(contextItemId: string, limit?: number): Promise<EmergenceSuggestion[]>;
	resolveEmergenceSuggestion(id: string, action: EmergenceAction): Promise<void>;
	runRuleQuery(source: string, limit?: number): Promise<RuleQueryResult>;
	listSavedRuleQueries(): Promise<SavedRuleQuery[]>;
	saveRuleQuery(input: { id?: string; name: string; source: string }): Promise<SavedRuleQuery>;
	deleteRuleQuery(id: string): Promise<void>;
}

export type StartupPhase = "starting" | "ready" | "failed";

export interface StartupStatus {
	phase: StartupPhase;
	message: string;
	detail?: string;
	logPath?: string;
}

declare global {
	const bindings: RadioraBindings;
}
