import type { EmergenceAction, EmergenceSuggestion } from "../domain/models.ts";
import type {
	DiscoveryStorePort,
	OutlineStorePort,
	RelationStorePort,
	RelationTypeDefinitionStorePort,
} from "../storage/graph_store.ts";
import { EmergencePersistence } from "./emergence_persistence.ts";
import {
	calculateEmergenceCandidates,
	rankEmergenceSuggestions,
} from "./emergence_suggestion_calculator.ts";
import { fetchActiveMergedLinks } from "./implicit_relation.ts";
import type { SearchOperations } from "./search_operations.ts";
import { titleOf } from "./search_text.ts";

type EmergenceStore =
	& Pick<OutlineStorePort, "listItems">
	& Pick<RelationStorePort, "listLinks">
	& Pick<
		DiscoveryStorePort,
		| "getEmergenceFeedback"
		| "listEmergenceSuggestions"
		| "resolveEmergenceSuggestion"
		| "upsertEmergenceSuggestion"
	>
	& Partial<Pick<RelationTypeDefinitionStorePort, "listRelationTypeDefinitions">>;

export class DiscoveryEmergenceOperations {
	private readonly persistence: EmergencePersistence;

	constructor(
		private readonly store: EmergenceStore,
		private readonly search: SearchOperations,
	) {
		this.persistence = new EmergencePersistence(store);
	}

	async listEmergenceSuggestions(
		contextItemId: string,
		limit = 10,
	): Promise<EmergenceSuggestion[]> {
		const items = await this.store.listItems();
		const links = await fetchActiveMergedLinks(this.store);
		const context = items.find((item) => item.id === contextItemId);
		if (!context) return [];
		const searchResults = await this.search.searchItems({
			query: titleOf(context),
			contextItemId,
			limit: 20,
		});
		const candidates = calculateEmergenceCandidates({ context, items, links, searchResults });
		const visible = await this.persistence.materialize(candidates);
		return rankEmergenceSuggestions(visible, limit);
	}

	async resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		reason?: string,
	): Promise<void> {
		return this.persistence.resolve(id, action, reason);
	}
}
