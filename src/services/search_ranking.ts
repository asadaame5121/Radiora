import type {
	LexicalHit,
	OutlineItem,
	OutlineLink,
	SearchAlias,
	SearchReason,
	SearchResult,
} from "../domain/models.ts";
import { ancestorsOf, neighborMap } from "./discovery_helpers.ts";
import { normalizeSearchText, titleOf } from "./search_text.ts";

const TITLE_SCORE_WEIGHT = 2;
const ALIAS_EXPANSION_WEIGHT = 0.9;
const LIKE_EXPANSION_WEIGHT = 0.5;
const MAX_EXPANSIONS = 5;
const DIRECT_LINK_SCORE = 1;
const MAX_SHARED_LINK_SCORE = 0.8;
const SHARED_LINK_DIVISOR = 3;
const SHARED_ANCESTOR_SCORE = 0.5;
const LEXICAL_WEIGHT = 0.55;
const GRAPH_WEIGHT = 0.3;
const EXPANSION_WEIGHT = 0.15;

export interface SearchExpansion {
	term: string;
	weight: number;
	label: string;
}

export interface WeightedLexicalHit {
	hit: LexicalHit;
	weight: number;
	label: string;
}

interface SearchCandidate {
	item: OutlineItem;
	lexical: number;
	expansion: number;
	reasons: SearchReason[];
}

export interface SearchRankingInput {
	query: string;
	limit: number;
	contextItemId?: string | null;
	items: readonly OutlineItem[];
	links: readonly OutlineLink[];
	baseHits: readonly LexicalHit[];
	expansionHits: readonly WeightedLexicalHit[];
}

export function buildSearchExpansions(input: {
	query: string;
	aliases: readonly SearchAlias[];
	items: readonly OutlineItem[];
	links: readonly OutlineLink[];
}): SearchExpansion[] {
	const expansions = new Map<string, SearchExpansion>();
	addAliasExpansions(expansions, input.query, input.aliases);
	addLikeExpansions(expansions, input.query, input.items, input.links);
	return [...expansions.values()];
}

export function rankSearchResults(input: SearchRankingInput): SearchResult[] {
	const byId = new Map(input.items.map((item) => [item.id, item]));
	const candidates = buildCandidates(input);
	const context = input.contextItemId ? byId.get(input.contextItemId) : undefined;
	const neighbors = neighborMap(input.links);
	return [...candidates.values()]
		.map((candidate) => scoreCandidate({ candidate, context, byId, neighbors }))
		.filter((result) => result.item.id !== input.contextItemId)
		.sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
		.slice(0, input.limit);
}

function addAliasExpansions(
	target: Map<string, SearchExpansion>,
	query: string,
	aliases: readonly SearchAlias[],
): void {
	for (const alias of aliases) {
		const terms = [
			normalizeSearchText(alias.canonical),
			...alias.variants.map(normalizeSearchText),
		];
		if (!terms.includes(query)) continue;
		for (const term of terms.filter((term) => term !== query)) {
			target.set(term, { term, weight: ALIAS_EXPANSION_WEIGHT, label: `別名: ${term}` });
		}
	}
}

function addLikeExpansions(
	target: Map<string, SearchExpansion>,
	query: string,
	items: readonly OutlineItem[],
	links: readonly OutlineLink[],
): void {
	const seeds = items.filter((item) => normalizeSearchText(titleOf(item)) === query);
	for (const seed of seeds) {
		for (const link of links.filter((entry) => isLikeLinkForWork(entry, seed.workId))) {
			const targetWorkId = link.fromId === seed.workId ? link.toId : link.fromId;
			const linkedItem = items.find((item) => item.workId === targetWorkId);
			if (!linkedItem) continue;
			const term = normalizeSearchText(titleOf(linkedItem));
			if (term && term !== query && !target.has(term) && target.size < MAX_EXPANSIONS) {
				target.set(term, {
					term,
					weight: LIKE_EXPANSION_WEIGHT,
					label: `LIKEリンク: ${titleOf(linkedItem)}`,
				});
			}
		}
	}
}

function isLikeLinkForWork(link: OutlineLink, workId: string): boolean {
	return link.type === "LIKE" && (link.fromId === workId || link.toId === workId);
}

function buildCandidates(input: SearchRankingInput): Map<string, SearchCandidate> {
	const maxBase = maximumWeightedScore(input.baseHits);
	const maxExpanded = maximumWeightedScore(
		input.expansionHits.map(({ hit, weight }) => ({
			...hit,
			titleScore: hit.titleScore * weight,
			bodyScore: hit.bodyScore * weight,
		})),
	);
	const candidates = new Map<string, SearchCandidate>();
	for (const hit of input.baseHits) addBaseHit(candidates, hit, input.query, maxBase);
	for (const weightedHit of input.expansionHits) {
		addExpansionHit(candidates, weightedHit, maxExpanded);
	}
	return candidates;
}

function maximumWeightedScore(hits: readonly LexicalHit[]): number {
	return Math.max(
		DIRECT_LINK_SCORE,
		...hits.map((hit) => hit.titleScore * TITLE_SCORE_WEIGHT + hit.bodyScore),
	);
}

function addBaseHit(
	target: Map<string, SearchCandidate>,
	hit: LexicalHit,
	query: string,
	maximum: number,
): void {
	const title = normalizeSearchText(titleOf(hit.item));
	const weightedScore = hit.titleScore * TITLE_SCORE_WEIGHT + hit.bodyScore;
	const lexical = title === query ? DIRECT_LINK_SCORE : weightedScore / maximum;
	const reasons: SearchReason[] = [];
	if (hit.titleScore > 0) {
		reasons.push({
			kind: "title",
			label: title === query ? "タイトル完全一致" : "タイトル一致",
			score: hit.titleScore,
		});
	}
	if (hit.bodyScore > 0) reasons.push({ kind: "body", label: "本文一致", score: hit.bodyScore });
	target.set(hit.item.id, { item: hit.item, lexical, expansion: 0, reasons });
}

function addExpansionHit(
	target: Map<string, SearchCandidate>,
	weightedHit: WeightedLexicalHit,
	maximum: number,
): void {
	const { hit, weight, label } = weightedHit;
	const candidate = target.get(hit.item.id) ?? {
		item: hit.item,
		lexical: 0,
		expansion: 0,
		reasons: [],
	};
	const weightedScore = (hit.titleScore * TITLE_SCORE_WEIGHT + hit.bodyScore) * weight;
	const score = weightedScore / maximum;
	if (score > candidate.expansion) {
		candidate.expansion = score;
		candidate.reasons.push({ kind: "alias", label, score });
	}
	target.set(hit.item.id, candidate);
}

function scoreCandidate(input: {
	candidate: SearchCandidate;
	context: OutlineItem | undefined;
	byId: ReadonlyMap<string, OutlineItem>;
	neighbors: ReadonlyMap<string, ReadonlySet<string>>;
}): SearchResult {
	const graph = graphScore(input);
	return {
		item: input.candidate.item,
		ancestorIds: ancestorsOf(input.candidate.item, input.byId),
		score: LEXICAL_WEIGHT * input.candidate.lexical + GRAPH_WEIGHT * graph.score +
			EXPANSION_WEIGHT * input.candidate.expansion,
		reasons: [...input.candidate.reasons, ...graph.reasons],
	};
}

function graphScore(input: {
	candidate: SearchCandidate;
	context: OutlineItem | undefined;
	byId: ReadonlyMap<string, OutlineItem>;
	neighbors: ReadonlyMap<string, ReadonlySet<string>>;
}): { score: number; reasons: SearchReason[] } {
	if (!input.context || input.context.workId === input.candidate.item.workId) {
		return { score: 0, reasons: [] };
	}
	const contextNeighbors = input.neighbors.get(input.context.workId) ?? new Set<string>();
	if (contextNeighbors.has(input.candidate.item.workId)) {
		return {
			score: DIRECT_LINK_SCORE,
			reasons: [{ kind: "direct-link", label: "選択中の思索と直接接続", score: DIRECT_LINK_SCORE }],
		};
	}
	return indirectGraphScore({ ...input, context: input.context }, contextNeighbors);
}

function indirectGraphScore(
	input: Omit<Parameters<typeof graphScore>[0], "context"> & { context: OutlineItem },
	contextNeighbors: ReadonlySet<string>,
): { score: number; reasons: SearchReason[] } {
	const candidateNeighbors = input.neighbors.get(input.candidate.item.workId) ?? new Set<string>();
	const shared = [...contextNeighbors].filter((id) => candidateNeighbors.has(id));
	let score = shared.length
		? Math.min(MAX_SHARED_LINK_SCORE, shared.length / SHARED_LINK_DIVISOR)
		: 0;
	const reasons: SearchReason[] = shared.length
		? [{ kind: "shared-link", label: `共通リンク ${shared.length}件`, score }]
		: [];
	const contextAncestors = new Set(ancestorsOf(input.context, input.byId));
	const sharesAncestor = ancestorsOf(input.candidate.item, input.byId).some((id) =>
		contextAncestors.has(id)
	);
	if (sharesAncestor && score < SHARED_ANCESTOR_SCORE) {
		score = SHARED_ANCESTOR_SCORE;
		reasons.push({ kind: "shared-ancestor", label: "共通の祖先", score });
	}
	return { score, reasons };
}
