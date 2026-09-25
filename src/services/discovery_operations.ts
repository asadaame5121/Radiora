import type {
	EmergenceAction,
	EmergenceSuggestion,
	OutlineLink,
	RuleQueryResult,
	SavedRuleQuery,
	SearchAlias,
	SearchRequest,
	SearchResult,
	Suggestion,
	TransientProjectionNode,
} from "../domain/models.ts";
import type {
	DiscoveryStorePort,
	OutlineStorePort,
	RelationStorePort,
	RelationTypeDefinitionStorePort,
} from "../storage/graph_store.ts";
import { DiscoveryRuleQueryOperations } from "./discovery_rule_query_operations.ts";
import { EmergencePersistence } from "./emergence_persistence.ts";
import {
	calculateEmergenceCandidates,
	rankEmergenceSuggestions,
} from "./emergence_suggestion_calculator.ts";
import { fetchActiveMergedLinks } from "./implicit_relation.ts";
import { SearchOperations } from "./search_operations.ts";
import { titleOf } from "./search_text.ts";

type DiscoveryOperationsStore =
	& DiscoveryStorePort
	& OutlineStorePort
	& RelationStorePort
	& Partial<RelationTypeDefinitionStorePort>;

/** Search, suggestion, and rule-query operations backed by feature-specific store ports. */
export class DiscoveryOperations {
	private readonly search: SearchOperations;
	private readonly emergencePersistence: EmergencePersistence;
	private readonly ruleQuery: DiscoveryRuleQueryOperations;

	constructor(private readonly store: DiscoveryOperationsStore) {
		this.search = new SearchOperations(store);
		this.emergencePersistence = new EmergencePersistence(store);
		this.ruleQuery = new DiscoveryRuleQueryOperations(store);
	}

	async suggestItems(prefix: string, limit = 8): Promise<Suggestion[]> {
		return this.search.suggestItems(prefix, limit);
	}

	async searchItems(request: SearchRequest | string): Promise<SearchResult[]> {
		return this.search.searchItems(request);
	}

	listSearchAliases(): Promise<SearchAlias[]> {
		return this.search.listSearchAliases();
	}

	async saveSearchAlias(
		input: { id?: string; canonical: string; variants: string[] },
	): Promise<SearchAlias> {
		return this.search.saveSearchAlias(input);
	}

	deleteSearchAlias(id: string): Promise<void> {
		return this.search.deleteSearchAlias(id);
	}

	async listEmergenceSuggestions(
		contextItemId: string,
		limit = 10,
	): Promise<EmergenceSuggestion[]> {
		const items = await this.store.listItems();
		const links = await this.listActiveLinks();
		const context = items.find((item) => item.id === contextItemId);
		if (!context) return [];
		const searchResults = await this.search.searchItems({
			query: titleOf(context),
			contextItemId,
			limit: 20,
		});
		const candidates = calculateEmergenceCandidates({ context, items, links, searchResults });
		const visible = await this.emergencePersistence.materialize(candidates);
		return rankEmergenceSuggestions(visible, limit);
	}

	async resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		reason?: string,
	): Promise<void> {
		return this.emergencePersistence.resolve(id, action, reason);
	}

	async runRuleQuery(source: string, limit = 500): Promise<RuleQueryResult> {
		return this.ruleQuery.runRuleQuery(source, limit);
	}

	listSavedRuleQueries(): Promise<SavedRuleQuery[]> {
		return this.ruleQuery.listSavedRuleQueries();
	}

	async saveRuleQuery(
		input: { id?: string; name: string; source: string },
	): Promise<SavedRuleQuery> {
		return this.ruleQuery.saveRuleQuery(input);
	}

	deleteRuleQuery(id: string): Promise<void> {
		return this.ruleQuery.deleteRuleQuery(id);
	}

	async buildQueryProjectionNodes(
		queryId: string,
		limit = 500,
	): Promise<{ nodes: TransientProjectionNode[]; result: RuleQueryResult }> {
		return this.ruleQuery.buildQueryProjectionNodes(queryId, limit);
	}

	private listActiveLinks(): Promise<OutlineLink[]> {
		return fetchActiveMergedLinks(this.store);
	}
}
