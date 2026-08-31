import type {
	EmergenceSuggestion,
	OutlineItem,
	OutlineLink,
	SearchResult,
} from "../domain/models.ts";
import { neighborMap, rootId } from "./discovery_helpers.ts";

const MIN_SHARED_NEIGHBORS = 2;
const SHARED_NEIGHBOR_SCORE_DIVISOR = 3;
const MAX_CANDIDATE_SCORE = 1;
const MAX_EVIDENCE_NEIGHBORS = 3;
const MIN_RESONANCE_SCORE = 0.35;
const PRODUCTIVE_TENSION_SCORE = 0.65;
const FINGERPRINT_OFFSET = 2166136261;
const FINGERPRINT_PRIME = 16777619;
const FINGERPRINT_RADIX = 16;
const MIN_SUGGESTION_LIMIT = 1;
const MAX_SUGGESTION_LIMIT = 30;

export type EmergenceCandidate = Pick<
	EmergenceSuggestion,
	| "id"
	| "kind"
	| "contextWorkId"
	| "targetWorkId"
	| "contextItemId"
	| "targetItemId"
	| "proposedLinkType"
	| "title"
	| "explanation"
	| "evidence"
	| "score"
>;

export interface EmergenceSuggestionCalculation {
	context: OutlineItem;
	items: readonly OutlineItem[];
	links: readonly OutlineLink[];
	searchResults: readonly SearchResult[];
}

type CandidateInput =
	& Omit<
		EmergenceCandidate,
		"id" | "contextWorkId" | "targetWorkId" | "contextItemId" | "targetItemId"
	>
	& { context: OutlineItem; target: OutlineItem };

/** Calculates discovery candidates without fetching or persisting data. */
export function calculateEmergenceCandidates(
	input: EmergenceSuggestionCalculation,
): EmergenceCandidate[] {
	const { context, items, links, searchResults } = input;
	const byId = new Map(items.map((item) => [item.id, item]));
	const byWorkId = new Map(items.map((item) => [item.workId, item]));
	const neighbors = neighborMap(links);
	const contextNeighbors = neighbors.get(context.workId) ?? new Set<string>();
	const candidates = new Map<string, EmergenceCandidate>();
	addLatentRelations(candidates, context, byWorkId, neighbors, contextNeighbors);
	addCrossBranchResonances(candidates, context, byId, searchResults, contextNeighbors);
	addProductiveTensions(candidates, context, byWorkId, links);
	return [...candidates.values()];
}

export function rankEmergenceSuggestions(
	suggestions: readonly EmergenceSuggestion[],
	limit: number,
): EmergenceSuggestion[] {
	const boundedLimit = Math.min(Math.max(limit, MIN_SUGGESTION_LIMIT), MAX_SUGGESTION_LIMIT);
	return [...suggestions]
		.sort((a, b) =>
			Number(b.status === "pinned") - Number(a.status === "pinned") || b.score - a.score
		)
		.slice(0, boundedLimit);
}

function addLatentRelations(
	target: Map<string, EmergenceCandidate>,
	context: OutlineItem,
	byWorkId: ReadonlyMap<string, OutlineItem>,
	neighbors: ReadonlyMap<string, ReadonlySet<string>>,
	contextNeighbors: ReadonlySet<string>,
): void {
	for (const candidate of byWorkId.values()) {
		if (candidate.workId === context.workId || contextNeighbors.has(candidate.workId)) continue;
		const shared = [...contextNeighbors].filter((id) => neighbors.get(candidate.workId)?.has(id));
		if (shared.length < MIN_SHARED_NEIGHBORS) continue;
		addCandidate(target, {
			kind: "latent-relation",
			context,
			target: candidate,
			score: Math.min(MAX_CANDIDATE_SCORE, shared.length / SHARED_NEIGHBOR_SCORE_DIVISOR),
			proposedLinkType: "LIKE",
			title: "潜在的な関係",
			explanation: `${shared.length}件の共通リンクを介してつながっています。`,
			evidence: shared.slice(0, MAX_EVIDENCE_NEIGHBORS).flatMap((workId) =>
				sharedNeighborEvidence(context, candidate, byWorkId, workId)
			),
		});
	}
}

function sharedNeighborEvidence(
	context: OutlineItem,
	candidate: OutlineItem,
	byWorkId: ReadonlyMap<string, OutlineItem>,
	workId: string,
): EmergenceSuggestion["evidence"] {
	const middleId = byWorkId.get(workId)?.id ?? workId;
	return [
		{ fromId: context.id, toId: middleId, relation: "LIKE" },
		{ fromId: middleId, toId: candidate.id, relation: "LIKE" },
	];
}

function addCrossBranchResonances(
	target: Map<string, EmergenceCandidate>,
	context: OutlineItem,
	byId: ReadonlyMap<string, OutlineItem>,
	searchResults: readonly SearchResult[],
	contextNeighbors: ReadonlySet<string>,
): void {
	for (const result of searchResults) {
		const candidate = result.item;
		if (
			contextNeighbors.has(candidate.workId) ||
			rootId(context, byId) === rootId(candidate, byId) ||
			result.score < MIN_RESONANCE_SCORE
		) continue;
		addCandidate(target, {
			kind: "cross-branch-resonance",
			context,
			target: candidate,
			score: result.score,
			proposedLinkType: "LIKE",
			title: "枝を越えた共鳴",
			explanation: "異なるアウトライン枝に、語彙が強く重なる思索があります。",
			evidence: [{ fromId: context.id, toId: candidate.id, relation: "LEXICAL" }],
		});
	}
}

function addProductiveTensions(
	target: Map<string, EmergenceCandidate>,
	context: OutlineItem,
	byWorkId: ReadonlyMap<string, OutlineItem>,
	links: readonly OutlineLink[],
): void {
	for (const first of links.filter((link) => isLikeLinkForContext(link, context.workId))) {
		const middle = first.fromId === context.workId ? first.toId : first.fromId;
		for (const second of links.filter((link) => isTensionLinkForWork(link, middle))) {
			const targetId = second.fromId === middle ? second.toId : second.fromId;
			const candidate = byWorkId.get(targetId);
			if (!candidate || candidate.workId === context.workId) continue;
			addCandidate(target, {
				kind: "productive-tension",
				context,
				target: candidate,
				score: PRODUCTIVE_TENSION_SCORE,
				proposedLinkType: "RELATED",
				title: "対立・修正の観点",
				explanation: `類似する思索の先に${second.type}関係があります。`,
				evidence: tensionEvidence(context, candidate, byWorkId, middle, second),
			});
		}
	}
}

function isLikeLinkForContext(link: OutlineLink, contextWorkId: string): boolean {
	return link.type === "LIKE" && (link.fromId === contextWorkId || link.toId === contextWorkId);
}

function isTensionLinkForWork(link: OutlineLink, workId: string): boolean {
	return (link.type === "VS" || link.type === "FIX") &&
		(link.fromId === workId || link.toId === workId);
}

function tensionEvidence(
	context: OutlineItem,
	candidate: OutlineItem,
	byWorkId: ReadonlyMap<string, OutlineItem>,
	middleWorkId: string,
	tensionLink: OutlineLink,
): EmergenceSuggestion["evidence"] {
	const middleId = byWorkId.get(middleWorkId)?.id ?? middleWorkId;
	return [
		{ fromId: context.id, toId: middleId, relation: "LIKE" },
		{ fromId: middleId, toId: candidate.id, relation: tensionLink.type },
	];
}

function addCandidate(target: Map<string, EmergenceCandidate>, input: CandidateInput): void {
	const id = emergenceSuggestionFingerprint(
		`${input.kind}:${input.context.workId}:${input.target.workId}`,
	);
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
	});
}

export function emergenceSuggestionFingerprint(value: string): string {
	let hash = FINGERPRINT_OFFSET;
	for (const char of value) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, FINGERPRINT_PRIME);
	}
	return `s-${(hash >>> 0).toString(FINGERPRINT_RADIX)}`;
}
