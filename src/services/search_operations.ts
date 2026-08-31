import type { SearchAlias, SearchRequest, SearchResult, Suggestion } from "../domain/models.ts";
import type {
	DiscoveryStorePort,
	OutlineStorePort,
	RelationStorePort,
} from "../storage/graph_store.ts";
import { ancestorsOf, isReservedTagAlias } from "./discovery_helpers.ts";
import { fetchActiveMergedLinks } from "./implicit_relation.ts";
import {
	buildSearchExpansions,
	rankSearchResults,
	type SearchExpansion,
} from "./search_ranking.ts";
import { normalizeSearchText, titleOf } from "./search_text.ts";

const DEFAULT_SEARCH_LIMIT = 20;
const MIN_SEARCH_LIMIT = 1;
const MAX_SEARCH_LIMIT = 50;
const MAX_SUGGESTION_LIMIT = 20;
const BASE_HIT_MULTIPLIER = 3;
const MIN_BASE_HITS = 40;
const EXPANSION_HIT_MULTIPLIER = 2;
const MIN_EXPANSION_HITS = 30;

export type SearchOperationsStore =
	& Pick<
		DiscoveryStorePort,
		"suggestItems" | "searchLexical" | "listAliases" | "upsertAlias" | "deleteAlias"
	>
	& Pick<OutlineStorePort, "listItems">
	& Pick<RelationStorePort, "listLinks">;

/** Prefix, lexical, graph-aware, and alias search operations. */
export class SearchOperations {
	constructor(private readonly store: SearchOperationsStore) {}

	async suggestItems(prefix: string, limit = 8): Promise<Suggestion[]> {
		const normalized = normalizeSearchText(prefix);
		if (!normalized) return [];
		const items = await this.store.listItems();
		const byId = new Map(items.map((item) => [item.id, item]));
		const boundedLimit = Math.min(Math.max(limit, MIN_SEARCH_LIMIT), MAX_SUGGESTION_LIMIT);
		return (await this.store.suggestItems(normalized, boundedLimit))
			.map((item) => ({ item, title: titleOf(item), ancestorIds: ancestorsOf(item, byId) }));
	}

	async searchItems(request: SearchRequest | string): Promise<SearchResult[]> {
		const input = typeof request === "string" ? { query: request } : request;
		const query = normalizeSearchText(input.query);
		if (!query) return [];
		const limit = Math.min(
			Math.max(input.limit ?? DEFAULT_SEARCH_LIMIT, MIN_SEARCH_LIMIT),
			MAX_SEARCH_LIMIT,
		);
		const items = await this.store.listItems();
		const links = await fetchActiveMergedLinks(this.store);
		const aliases = (await this.store.listAliases()).filter((alias) => !isReservedTagAlias(alias));
		const expansions = buildSearchExpansions({ query, aliases, items, links });
		const baseHits = await this.store.searchLexical(
			query,
			Math.max(limit * BASE_HIT_MULTIPLIER, MIN_BASE_HITS),
		);
		const expansionHits = await this.loadExpansionHits(expansions, limit);
		return rankSearchResults({ ...input, query, limit, items, links, baseHits, expansionHits });
	}

	async listSearchAliases(): Promise<SearchAlias[]> {
		return (await this.store.listAliases()).filter((alias) => !isReservedTagAlias(alias));
	}

	async saveSearchAlias(
		input: { id?: string; canonical: string; variants: string[] },
	): Promise<SearchAlias> {
		const canonical = normalizeSearchText(input.canonical);
		const variants = [...new Set(input.variants.map(normalizeSearchText).filter(Boolean))]
			.filter((variant) => variant !== canonical);
		if (canonical.startsWith("#") || variants.some((variant) => variant.startsWith("#"))) {
			throw new Error("タグの改名・統合にはタグ管理を使用してください。");
		}
		if (!canonical || !variants.length) {
			throw new Error("別名には基準語と1件以上の異なる表記が必要です。");
		}
		const existing = input.id
			? (await this.store.listAliases()).find((alias) => alias.id === input.id)
			: undefined;
		const now = new Date().toISOString();
		const alias: SearchAlias = {
			id: input.id ?? crypto.randomUUID(),
			canonical,
			variants,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		await this.store.upsertAlias(alias);
		return alias;
	}

	deleteSearchAlias(id: string): Promise<void> {
		return this.store.deleteAlias(id);
	}

	private async loadExpansionHits(expansions: readonly SearchExpansion[], limit: number) {
		const hitLimit = Math.max(limit * EXPANSION_HIT_MULTIPLIER, MIN_EXPANSION_HITS);
		return (await Promise.all(expansions.map(async ({ term, weight, label }) => ({
			weight,
			label,
			hits: await this.store.searchLexical(term, hitLimit),
		})))).flatMap(({ weight, label, hits }) => hits.map((hit) => ({ hit, weight, label })));
	}
}
