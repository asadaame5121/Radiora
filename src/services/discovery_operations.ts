import type {
	EmergenceAction,
	EmergenceSuggestion,
	OutlineItem,
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
import { runRuleQuery } from "./rule_query.ts";
import { normalizeSearchText, titleOf } from "./search_text.ts";
import { buildSparseOutline } from "./sparse_outline.ts";

const MAX_SEARCH_LIMIT = 50;

type DiscoveryOperationsStore = DiscoveryStorePort & OutlineStorePort & RelationStorePort;

/** Search, suggestion, and rule-query operations backed by feature-specific store ports. */
export class DiscoveryOperations {
	private readonly suggestionCache = new Map<string, EmergenceSuggestion>();

	constructor(private readonly store: DiscoveryOperationsStore) {}

	async suggestItems(prefix: string, limit = 8): Promise<Suggestion[]> {
		const normalized = normalizeSearchText(prefix);
		if (!normalized) return [];
		const items = await this.store.listItems();
		const byId = new Map(items.map((item) => [item.id, item]));
		return (await this.store.suggestItems(normalized, Math.min(Math.max(limit, 1), 20)))
			.map((item) => ({ item, title: titleOf(item), ancestorIds: ancestorsOf(item, byId) }));
	}

	async searchItems(request: SearchRequest | string): Promise<SearchResult[]> {
		const input = typeof request === "string" ? { query: request } : request;
		const query = normalizeSearchText(input.query);
		if (!query) return [];
		const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_SEARCH_LIMIT);
		const items = await this.store.listItems();
		const links = await this.listActiveLinks();
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

	async listEmergenceSuggestions(
		contextItemId: string,
		limit = 10,
	): Promise<EmergenceSuggestion[]> {
		const items = await this.store.listItems();
		const links = await this.listActiveLinks();
		const context = items.find((item) => item.id === contextItemId);
		if (!context) return [];
		const byId = new Map(items.map((item) => [item.id, item]));
		const byWorkId = new Map(items.map((item) => [item.workId, item]));
		const neighbors = neighborMap(links);
		const contextNeighbors = neighbors.get(context.workId) ?? new Set<string>();
		const direct = new Set(contextNeighbors);
		const suggestions = new Map<string, EmergenceSuggestion>();
		for (const candidate of byWorkId.values()) {
			if (candidate.workId === context.workId || direct.has(candidate.workId)) continue;
			const shared = [...contextNeighbors].filter((id) => neighbors.get(candidate.workId)?.has(id));
			if (shared.length >= 2) {
				this.addSuggestion(suggestions, {
					kind: "latent-relation",
					context,
					target: candidate,
					score: Math.min(1, shared.length / 3),
					proposedLinkType: "LIKE",
					title: "潜在的な関係",
					explanation: `${shared.length}件の共通リンクを介してつながっています。`,
					evidence: shared.slice(0, 3).flatMap((workId) => [
						{
							fromId: context.id,
							toId: byWorkId.get(workId)?.id ?? workId,
							relation: "LIKE" as const,
						},
						{
							fromId: byWorkId.get(workId)?.id ?? workId,
							toId: candidate.id,
							relation: "LIKE" as const,
						},
					]),
				});
			}
		}
		for (
			const result of await this.searchItems({ query: titleOf(context), contextItemId, limit: 20 })
		) {
			const target = result.item;
			if (
				direct.has(target.workId) || rootId(context, byId) === rootId(target, byId) ||
				result.score < 0.35
			) continue;
			this.addSuggestion(suggestions, {
				kind: "cross-branch-resonance",
				context,
				target,
				score: result.score,
				proposedLinkType: "LIKE",
				title: "枝を越えた共鳴",
				explanation: "異なるアウトライン枝に、語彙が強く重なる思索があります。",
				evidence: [{ fromId: context.id, toId: target.id, relation: "LEXICAL" }],
			});
		}
		for (
			const first of links.filter((link) =>
				link.type === "LIKE" && (link.fromId === context.workId || link.toId === context.workId)
			)
		) {
			const middle = first.fromId === context.workId ? first.toId : first.fromId;
			for (
				const second of links.filter((link) =>
					(link.type === "VS" || link.type === "FIX") &&
					(link.fromId === middle || link.toId === middle)
				)
			) {
				const targetId = second.fromId === middle ? second.toId : second.fromId;
				const target = byWorkId.get(targetId);
				if (!target || target.workId === context.workId) continue;
				this.addSuggestion(suggestions, {
					kind: "productive-tension",
					context,
					target,
					score: 0.65,
					title: "対立・修正の観点",
					explanation: `類似する思索の先に${second.type}関係があります。`,
					evidence: [
						{ fromId: context.id, toId: byWorkId.get(middle)?.id ?? middle, relation: "LIKE" },
						{ fromId: byWorkId.get(middle)?.id ?? middle, toId: target.id, relation: second.type },
					],
				});
			}
		}
		const visible: EmergenceSuggestion[] = [];
		const persisted = new Map(
			(await this.store.listEmergenceSuggestions()).map((
				suggestion,
			) => [suggestion.id, suggestion]),
		);
		for (const suggestion of suggestions.values()) {
			const existing = persisted.get(suggestion.id);
			const legacyId = this.fingerprint(
				`${suggestion.kind}:${suggestion.contextItemId}:${suggestion.targetItemId}`,
			);
			const feedback = existing ? null : await this.store.getEmergenceFeedback(suggestion.id) ??
				await this.store.getEmergenceFeedback(legacyId);
			const persistenceStatus = existing?.persistenceStatus ??
				(feedback === "accept"
					? "accepted"
					: feedback === "dismiss"
					? "dismissed"
					: feedback === "pin"
					? "held"
					: "pending");
			const now = new Date().toISOString();
			const materialized: EmergenceSuggestion = {
				...suggestion,
				persistenceStatus,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
				...(existing?.resolvedAt ? { resolvedAt: existing.resolvedAt } : {}),
				...(existing?.resolutionReason ? { resolutionReason: existing.resolutionReason } : {}),
				...(persistenceStatus === "held" ? { status: "pinned" as const } : {}),
			};
			await this.store.upsertEmergenceSuggestion(materialized);
			if (persistenceStatus === "dismissed" || persistenceStatus === "accepted") continue;
			this.suggestionCache.set(suggestion.id, materialized);
			visible.push(materialized);
		}
		return visible.sort((a, b) =>
			Number(b.status === "pinned") - Number(a.status === "pinned") || b.score - a.score
		)
			.slice(0, Math.min(Math.max(limit, 1), 30));
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
				const term = target ? normalizeSearchText(titleOf(target)) : "";
				if (term && term !== query && !expansions.has(term) && expansions.size < 5) {
					expansions.set(term, { term, weight: 0.5, label: `LIKEリンク: ${titleOf(target!)}` });
				}
			}
		}
		return [...expansions.values()];
	}

	private async listActiveLinks(): Promise<OutlineLink[]> {
		return (await this.store.listLinks()).filter((link) => link.status !== "retracted");
	}

	private addSuggestion(
		target: Map<string, EmergenceSuggestion>,
		input:
			& Omit<
				EmergenceSuggestion,
				| "id"
				| "contextWorkId"
				| "targetWorkId"
				| "contextItemId"
				| "targetItemId"
				| "persistenceStatus"
				| "createdAt"
				| "updatedAt"
				| "resolvedAt"
				| "resolutionReason"
				| "status"
			>
			& { context: OutlineItem; target: OutlineItem },
	): void {
		const id = this.fingerprint(`${input.kind}:${input.context.workId}:${input.target.workId}`);
		target.set(id, {
			id,
			kind: input.kind,
			contextWorkId: input.context.workId,
			targetWorkId: input.target.workId,
			contextItemId: input.context.id,
			targetItemId: input.target.id,
			proposedLinkType: input.proposedLinkType,
			title: input.title,
			explanation: input.explanation,
			evidence: input.evidence,
			score: input.score,
			persistenceStatus: "pending",
			createdAt: "",
			updatedAt: "",
		});
	}

	private fingerprint(value: string): string {
		let hash = 2166136261;
		for (const char of value) {
			hash ^= char.codePointAt(0) ?? 0;
			hash = Math.imul(hash, 16777619);
		}
		return `s-${(hash >>> 0).toString(16)}`;
	}
}

function neighborMap(links: OutlineLink[]): Map<string, Set<string>> {
	const result = new Map<string, Set<string>>();
	for (const link of links) {
		const from = result.get(link.fromId) ?? new Set<string>();
		const to = result.get(link.toId) ?? new Set<string>();
		from.add(link.toId);
		to.add(link.fromId);
		result.set(link.fromId, from);
		result.set(link.toId, to);
	}
	return result;
}

function rootId(item: OutlineItem, byId: Map<string, OutlineItem>): string {
	const visited = new Set([item.id]);
	let current = item;
	while (current.parentId && !visited.has(current.parentId)) {
		visited.add(current.parentId);
		const parent = byId.get(current.parentId);
		if (!parent) break;
		current = parent;
	}
	return current.id;
}

function isReservedTagAlias(alias: SearchAlias): boolean {
	return alias.canonical.startsWith("#") &&
		alias.variants.every((variant) => variant.startsWith("#"));
}

function ancestorsOf(item: OutlineItem, byId: Map<string, OutlineItem>): string[] {
	const result: string[] = [];
	const visited = new Set([item.id]);
	let parentId = item.parentId;
	while (parentId && !visited.has(parentId)) {
		visited.add(parentId);
		result.unshift(parentId);
		parentId = byId.get(parentId)?.parentId ?? null;
	}
	return result;
}
