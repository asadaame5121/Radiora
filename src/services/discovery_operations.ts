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
import { isSymmetricLinkType } from "../domain/models.ts";
import type {
	DiscoveryStorePort,
	OutlineStorePort,
	RelationStorePort,
} from "../storage/graph_store.ts";
import { ancestorsOf } from "./discovery_helpers.ts";
import {
	calculateEmergenceCandidates,
	type EmergenceCandidate,
	emergenceSuggestionFingerprint,
	rankEmergenceSuggestions,
} from "./emergence_suggestion_calculator.ts";
import { fetchActiveMergedLinks } from "./implicit_relation.ts";
import { runRuleQuery } from "./rule_query.ts";
import { SearchOperations } from "./search_operations.ts";
import { titleOf } from "./search_text.ts";
import { buildSparseOutline } from "./sparse_outline.ts";

type DiscoveryOperationsStore = DiscoveryStorePort & OutlineStorePort & RelationStorePort;

/** Search, suggestion, and rule-query operations backed by feature-specific store ports. */
export class DiscoveryOperations {
	private readonly suggestionCache = new Map<string, EmergenceSuggestion>();
	private readonly search: SearchOperations;

	constructor(private readonly store: DiscoveryOperationsStore) {
		this.search = new SearchOperations(store);
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
		const visible = await this.materializeEmergenceCandidates(candidates);
		return rankEmergenceSuggestions(visible, limit);
	}

	private async materializeEmergenceCandidates(
		candidates: readonly EmergenceCandidate[],
	): Promise<EmergenceSuggestion[]> {
		const persisted = new Map(
			(await this.store.listEmergenceSuggestions()).map((
				suggestion,
			) => [suggestion.id, suggestion]),
		);
		const visible: EmergenceSuggestion[] = [];
		for (const candidate of candidates) {
			const materialized = await this.materializeEmergenceCandidate(
				candidate,
				persisted.get(candidate.id),
			);
			if (materialized) visible.push(materialized);
		}
		return visible;
	}

	private async materializeEmergenceCandidate(
		candidate: EmergenceCandidate,
		existing: EmergenceSuggestion | undefined,
	): Promise<EmergenceSuggestion | null> {
		const legacyId = emergenceSuggestionFingerprint(
			`${candidate.kind}:${candidate.contextItemId}:${candidate.targetItemId}`,
		);
		const feedback = existing ? null : await this.store.getEmergenceFeedback(candidate.id) ??
			await this.store.getEmergenceFeedback(legacyId);
		const persistenceStatus = existing?.persistenceStatus ?? statusForFeedback(feedback);
		const now = new Date().toISOString();
		const materialized: EmergenceSuggestion = {
			...candidate,
			persistenceStatus,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			...(existing?.resolvedAt ? { resolvedAt: existing.resolvedAt } : {}),
			...(existing?.resolutionReason ? { resolutionReason: existing.resolutionReason } : {}),
			...(persistenceStatus === "held" ? { status: "pinned" as const } : {}),
		};
		await this.store.upsertEmergenceSuggestion(materialized);
		if (persistenceStatus === "dismissed" || persistenceStatus === "accepted") return null;
		this.suggestionCache.set(candidate.id, materialized);
		return materialized;
	}

	async resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		reason?: string,
	): Promise<void> {
		const suggestion = this.suggestionCache.get(id);
		if (!suggestion) throw new Error("提案が古くなりました。再読み込みしてください。");
		if (action === "accept") {
			if (!suggestion.proposedLinkType) throw new Error("リンク種別のない提案は採用できません。");
			let fromWorkId = suggestion.contextWorkId;
			let toWorkId = suggestion.targetWorkId;
			if (
				isSymmetricLinkType(suggestion.proposedLinkType) && fromWorkId.localeCompare(toWorkId) > 0
			) [fromWorkId, toWorkId] = [toWorkId, fromWorkId];
			await this.store.resolveEmergenceSuggestion(id, action, {
				id: crypto.randomUUID(),
				fromId: fromWorkId,
				toId: toWorkId,
				from: { scope: "work", workId: fromWorkId },
				to: { scope: "work", workId: toWorkId },
				type: suggestion.proposedLinkType,
				status: "asserted",
				origin: "suggestion",
				reason: suggestion.explanation,
				createdAt: new Date().toISOString(),
			}, reason);
			return;
		}
		await this.store.resolveEmergenceSuggestion(id, action, undefined, reason);
	}

	async runRuleQuery(source: string, limit = 500): Promise<RuleQueryResult> {
		const [items, links] = await Promise.all([this.store.listItems(), this.listActiveLinks()]);
		const representativeByWork = new Map<string, string>();
		for (const item of items) {
			if (!representativeByWork.has(item.workId)) representativeByWork.set(item.workId, item.id);
		}
		const occurrenceLinks = links.flatMap((link) => {
			const fromId = representativeByWork.get(link.from.workId);
			const toId = representativeByWork.get(link.to.workId);
			return fromId && toId ? [{ ...link, fromId, toId }] : [];
		});
		return runRuleQuery(source, items, occurrenceLinks, limit);
	}

	listSavedRuleQueries(): Promise<SavedRuleQuery[]> {
		return this.store.listSavedRuleQueries();
	}

	async saveRuleQuery(
		input: { id?: string; name: string; source: string },
	): Promise<SavedRuleQuery> {
		const now = new Date().toISOString();
		const existing = input.id
			? (await this.store.listSavedRuleQueries()).find((query) => query.id === input.id)
			: undefined;
		await this.runRuleQuery(input.source, 1);
		const saved: SavedRuleQuery = {
			id: input.id ?? crypto.randomUUID(),
			name: input.name.trim() || "名称未設定",
			source: input.source,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		await this.store.upsertSavedRuleQuery(saved);
		return saved;
	}

	deleteRuleQuery(id: string): Promise<void> {
		return this.store.deleteSavedRuleQuery(id);
	}

	async buildQueryProjectionNodes(
		queryId: string,
		limit = 500,
	): Promise<{ nodes: TransientProjectionNode[]; result: RuleQueryResult }> {
		const query = (await this.store.listSavedRuleQueries()).find((entry) => entry.id === queryId);
		if (!query) throw new Error("Saved Rule Query not found");
		const [result, items, links] = await Promise.all([
			this.runRuleQuery(query.source, limit),
			this.store.listItems(),
			this.listActiveLinks(),
		]);
		const itemsById = new Map(items.map((item) => [item.id, item]));
		const seenIds = new Set<string>();
		const pseudoResults: SearchResult[] = [];
		for (const row of result.rows) {
			for (const cell of row) {
				if (seenIds.has(cell)) continue;
				const item = itemsById.get(cell);
				if (!item) continue;
				seenIds.add(cell);
				pseudoResults.push({
					item,
					ancestorIds: ancestorsOf(item, itemsById),
					score: 1,
					reasons: [{ kind: "title", label: "Query一致", score: 1 }],
				});
			}
		}
		return { nodes: buildSparseOutline(pseudoResults, items, links, "query"), result };
	}

	private listActiveLinks(): Promise<OutlineLink[]> {
		return fetchActiveMergedLinks(this.store);
	}
}

function statusForFeedback(
	feedback: "accept" | "dismiss" | "pin" | null,
): EmergenceSuggestion["persistenceStatus"] {
	if (feedback === "accept") return "accepted";
	if (feedback === "dismiss") return "dismissed";
	if (feedback === "pin") return "held";
	return "pending";
}
