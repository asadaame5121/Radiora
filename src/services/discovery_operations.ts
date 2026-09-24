import type {
	EmergenceAction,
	EmergenceSuggestion,
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
import { DiscoveryEmergenceOperations } from "./discovery_emergence_operations.ts";
import { DiscoveryRuleQueryOperations } from "./discovery_rule_query_operations.ts";
import { SearchOperations } from "./search_operations.ts";

type DiscoveryOperationsStore =
	& DiscoveryStorePort
	& OutlineStorePort
	& RelationStorePort
	& Partial<RelationTypeDefinitionStorePort>;

/** Search, suggestion, and rule-query operations backed by feature-specific store ports. */
export class DiscoveryOperations {
	private readonly search: SearchOperations;
	private readonly emergence: DiscoveryEmergenceOperations;
	private readonly ruleQuery: DiscoveryRuleQueryOperations;

	constructor(store: DiscoveryOperationsStore) {
		this.search = new SearchOperations(store);
		this.emergence = new DiscoveryEmergenceOperations(store, this.search);
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
		return this.emergence.listEmergenceSuggestions(contextItemId, limit);
	}

	async resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		reason?: string,
	): Promise<void> {
		return this.emergence.resolveEmergenceSuggestion(id, action, reason);
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
}
