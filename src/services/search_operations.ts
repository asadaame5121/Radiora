import type {
	OutlineItem,
	OutlineLink,
	SearchAlias,
	SearchRequest,
	SearchResult,
	Suggestion,
} from "../domain/models.ts";
import type {
	DiscoveryStorePort,
	OutlineStorePort,
	RelationStorePort,
} from "../storage/graph_store.ts";
import { ancestorsOf, isReservedTagAlias, neighborMap } from "./discovery_helpers.ts";
import { fetchActiveMergedLinks } from "./implicit_relation.ts";
import { normalizeSearchText, titleOf } from "./search_text.ts";

const MAX_SEARCH_LIMIT = 50;

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
		return (await this.store.suggestItems(normalized, Math.min(Math.max(limit, 1), 20)))
			.map((item) => ({ item, title: titleOf(item), ancestorIds: ancestorsOf(item, byId) }));
	}

	// biome-ignore lint/complexity/noExcessiveLinesPerFunction: D2 moves the established ranking pipeline intact so this boundary refactor cannot change scoring.
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: D2 preserves the characterized search scoring while narrowing its store boundary.
	async searchItems(request: SearchRequest | string): Promise<SearchResult[]> {
		const input = typeof request === "string" ? { query: request } : request;
		const query = normalizeSearchText(input.query);
		if (!query) return [];
		const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_SEARCH_LIMIT);
		const items = await this.store.listItems();
		const links = await fetchActiveMergedLinks(this.store, items);
		const byId = new Map(items.map((item) => [item.id, item]));
		const aliases = (await this.store.listAliases()).filter((alias) => !isReservedTagAlias(alias));
		const expansions = this.expandQuery(query, aliases, items, links);
		const baseHits = await this.store.searchLexical(query, Math.max(limit * 3, 40));
		const expansionHits = (await Promise.all(expansions.map(async (expansion) => ({
			...expansion,
			hits: await this.store.searchLexical(expansion.term, Math.max(limit * 2, 30)),
		})))).flatMap(({ term, weight, label, hits }) =>
			hits.map((hit) => ({ hit, term, weight, label }))
		);
		const maxBase = Math.max(1, ...baseHits.map((hit) => hit.titleScore * 2 + hit.bodyScore));
		const maxExpanded = Math.max(
			1,
			...expansionHits.map(({ hit, weight }) => (hit.titleScore * 2 + hit.bodyScore) * weight),
		);
		const candidates = new Map<string, {
			item: OutlineItem;
			lexical: number;
			expansion: number;
			reasons: SearchResult["reasons"];
		}>();
		for (const hit of baseHits) {
			const title = normalizeSearchText(titleOf(hit.item));
			let lexical = (hit.titleScore * 2 + hit.bodyScore) / maxBase;
			if (title === query) lexical = 1;
			const reasons: SearchResult["reasons"] = [];
			if (hit.titleScore > 0) {
				reasons.push({
					kind: "title",
					label: title === query ? "タイトル完全一致" : "タイトル一致",
					score: hit.titleScore,
				});
			}
			if (hit.bodyScore > 0) {
				reasons.push({ kind: "body", label: "本文一致", score: hit.bodyScore });
			}
			candidates.set(hit.item.id, { item: hit.item, lexical, expansion: 0, reasons });
		}
		for (const { hit, weight, label } of expansionHits) {
			const candidate = candidates.get(hit.item.id) ??
				{ item: hit.item, lexical: 0, expansion: 0, reasons: [] };
			const score = ((hit.titleScore * 2 + hit.bodyScore) * weight) / maxExpanded;
			if (score > candidate.expansion) {
				candidate.expansion = score;
				candidate.reasons.push({ kind: "alias", label, score });
			}
			candidates.set(hit.item.id, candidate);
		}
		const neighbors = neighborMap(links);
		const context = input.contextItemId ? byId.get(input.contextItemId) : undefined;
		const contextNeighbors = context
			? neighbors.get(context.workId) ?? new Set<string>()
			: new Set<string>();
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep the characterized graph scoring branches together during the boundary-only refactor.
		return [...candidates.values()].map((candidate): SearchResult => {
			let graph = 0;
			if (context && context.workId !== candidate.item.workId) {
				const candidateNeighbors = neighbors.get(candidate.item.workId) ?? new Set<string>();
				if (contextNeighbors.has(candidate.item.workId)) {
					graph = 1;
					candidate.reasons.push({
						kind: "direct-link",
						label: "選択中の思索と直接接続",
						score: 1,
					});
				} else {
					const shared = [...contextNeighbors].filter((id) => candidateNeighbors.has(id));
					if (shared.length) {
						graph = Math.min(0.8, shared.length / 3);
						candidate.reasons.push({
							kind: "shared-link",
							label: `共通リンク ${shared.length}件`,
							score: graph,
						});
					}
					const contextAncestors = new Set(ancestorsOf(context, byId));
					const sharedAncestors = ancestorsOf(candidate.item, byId).filter((id) =>
						contextAncestors.has(id)
					);
					if (sharedAncestors.length && graph < 0.5) {
						graph = 0.5;
						candidate.reasons.push({ kind: "shared-ancestor", label: "共通の祖先", score: 0.5 });
					}
				}
			}
			return {
				item: candidate.item,
				ancestorIds: ancestorsOf(candidate.item, byId),
				score: 0.55 * candidate.lexical + 0.3 * graph + 0.15 * candidate.expansion,
				reasons: candidate.reasons,
			};
		}).filter((result) => result.item.id !== input.contextItemId)
			.sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
			.slice(0, limit);
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

	private expandQuery(
		query: string,
		aliases: SearchAlias[],
		items: OutlineItem[],
		links: OutlineLink[],
	): { term: string; weight: number; label: string }[] {
		const expansions = new Map<string, { term: string; weight: number; label: string }>();
		for (const alias of aliases) {
			const terms = [
				normalizeSearchText(alias.canonical),
				...alias.variants.map(normalizeSearchText),
			];
			if (!terms.includes(query)) continue;
			for (const term of terms.filter((term) => term !== query)) {
				expansions.set(term, { term, weight: 0.9, label: `別名: ${term}` });
			}
		}
		const seeds = items.filter((item) => normalizeSearchText(titleOf(item)) === query);
		for (const seed of seeds) {
			for (
				const link of links.filter((entry) =>
					entry.type === "LIKE" && (entry.fromId === seed.workId || entry.toId === seed.workId)
				)
			) {
				const target = items.find((item) =>
					item.workId === (link.fromId === seed.workId ? link.toId : link.fromId)
				);
				if (!target) continue;
				const term = normalizeSearchText(titleOf(target));
				if (term && term !== query && !expansions.has(term) && expansions.size < 5) {
					expansions.set(term, { term, weight: 0.5, label: `LIKEリンク: ${titleOf(target)}` });
				}
			}
		}
		return [...expansions.values()];
	}
}
