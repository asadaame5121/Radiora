import type {
	EmergenceSuggestion,
	OutlineItem,
	OutlineLink,
	SearchResult,
} from "../domain/models.ts";
import { neighborMap, rootId } from "./discovery_helpers.ts";

export interface EmergenceSuggestionCalculation {
	context: OutlineItem;
	items: readonly OutlineItem[];
	links: readonly OutlineLink[];
	searchResults: readonly SearchResult[];
}

type SuggestionInput =
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
	& { context: OutlineItem; target: OutlineItem };

/** Calculates discovery candidates without fetching or persisting data. */
export function calculateEmergenceSuggestions(
	input: EmergenceSuggestionCalculation,
): EmergenceSuggestion[] {
	const { context, items, links, searchResults } = input;
	const byId = new Map(items.map((item) => [item.id, item]));
	const byWorkId = new Map(items.map((item) => [item.workId, item]));
	const neighbors = neighborMap(links);
	const contextNeighbors = neighbors.get(context.workId) ?? new Set<string>();
	const suggestions = new Map<string, EmergenceSuggestion>();
	addLatentRelations(suggestions, context, byWorkId, neighbors, contextNeighbors);
	addCrossBranchResonances(suggestions, context, byId, searchResults, contextNeighbors);
	addProductiveTensions(suggestions, context, byWorkId, links);
	return [...suggestions.values()];
}

function addLatentRelations(
	suggestions: Map<string, EmergenceSuggestion>,
	context: OutlineItem,
	byWorkId: ReadonlyMap<string, OutlineItem>,
	neighbors: ReadonlyMap<string, ReadonlySet<string>>,
	contextNeighbors: ReadonlySet<string>,
): void {
	for (const candidate of byWorkId.values()) {
		if (candidate.workId === context.workId || contextNeighbors.has(candidate.workId)) continue;
		const shared = [...contextNeighbors].filter((id) => neighbors.get(candidate.workId)?.has(id));
		if (shared.length >= 2) {
			addSuggestion(suggestions, {
				kind: "latent-relation",
				context,
				target: candidate,
				score: Math.min(1, shared.length / 3),
				proposedLinkType: "LIKE",
				title: "潜在的な関係",
				explanation: `${shared.length}件の共通リンクを介してつながっています。`,
				evidence: shared.slice(0, 3).flatMap((workId) => [
					{ fromId: context.id, toId: byWorkId.get(workId)?.id ?? workId, relation: "LIKE" },
					{
						fromId: byWorkId.get(workId)?.id ?? workId,
						toId: candidate.id,
						relation: "LIKE",
					},
				]),
			});
		}
	}
}

function addCrossBranchResonances(
	suggestions: Map<string, EmergenceSuggestion>,
	context: OutlineItem,
	byId: ReadonlyMap<string, OutlineItem>,
	searchResults: readonly SearchResult[],
	contextNeighbors: ReadonlySet<string>,
): void {
	for (const result of searchResults) {
		const target = result.item;
		if (
			contextNeighbors.has(target.workId) || rootId(context, byId) === rootId(target, byId) ||
			result.score < 0.35
		) continue;
		addSuggestion(suggestions, {
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
}

function addProductiveTensions(
	suggestions: Map<string, EmergenceSuggestion>,
	context: OutlineItem,
	byWorkId: ReadonlyMap<string, OutlineItem>,
	links: readonly OutlineLink[],
): void {
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
			addSuggestion(suggestions, {
				kind: "productive-tension",
				context,
				target,
				score: 0.65,
				proposedLinkType: "RELATED",
				title: "対立・修正の観点",
				explanation: `類似する思索の先に${second.type}関係があります。`,
				evidence: [
					{ fromId: context.id, toId: byWorkId.get(middle)?.id ?? middle, relation: "LIKE" },
					{
						fromId: byWorkId.get(middle)?.id ?? middle,
						toId: target.id,
						relation: second.type,
					},
				],
			});
		}
	}
}

function addSuggestion(
	target: Map<string, EmergenceSuggestion>,
	input: SuggestionInput,
): void {
	const id = fingerprint(`${input.kind}:${input.context.workId}:${input.target.workId}`);
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

export function emergenceSuggestionFingerprint(value: string): string {
	return fingerprint(value);
}

function fingerprint(value: string): string {
	let hash = 2166136261;
	for (const char of value) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return `s-${(hash >>> 0).toString(16)}`;
}
