import { assertEquals } from "jsr:@std/assert@1";
import type {
	EmergenceSuggestion,
	OutlineItem,
	OutlineLink,
	SearchResult,
} from "../domain/models.ts";
import {
	calculateEmergenceCandidates,
	rankEmergenceSuggestions,
} from "./emergence_suggestion_calculator.ts";

const NOW = "2026-08-30T00:00:00.000Z";
const ORDER_KEY = 1024;
const STRONG_SEARCH_SCORE = 0.9;
const WEAK_SEARCH_SCORE = 0.34;
const TARGET_SEARCH_SCORE = 0.8;
const EXPECTED_SHARED_SCORE = 0.6666666666666666;
const LOW_SCORE = 0.1;
const MEDIUM_SCORE = 0.5;
const HIGH_SCORE = 0.9;
const RANKING_LIMIT = 2;

function item(workId: string, parentId: string | null = null): OutlineItem {
	return {
		id: `${workId}-occ`,
		workId,
		text: workId,
		parentId,
		orderKey: ORDER_KEY,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `${workId}-main` },
		createdAt: NOW,
		updatedAt: NOW,
	};
}

function link(fromId: string, toId: string, type: OutlineLink["type"]): OutlineLink {
	return {
		id: `${fromId}-${toId}-${type}`,
		fromId,
		toId,
		from: { scope: "work", workId: fromId },
		to: { scope: "work", workId: toId },
		type,
		status: "asserted",
		origin: "human",
		createdAt: NOW,
	};
}

function searchResult(target: OutlineItem, score: number): SearchResult {
	return { item: target, ancestorIds: [], score, reasons: [] };
}

Deno.test("emergence calculation: derives all candidate kinds without a store", () => {
	const root = item("root");
	const context = item("context", root.id);
	const latent = item("latent");
	const middleA = item("middle-a");
	const middleB = item("middle-b");
	const resonance = item("resonance");
	const tension = item("tension");
	const candidates = calculateEmergenceCandidates({
		context,
		items: [root, context, latent, middleA, middleB, resonance, tension],
		links: [
			link("context", "middle-a", "LIKE"),
			link("context", "middle-b", "LIKE"),
			link("latent", "middle-a", "LIKE"),
			link("latent", "middle-b", "LIKE"),
			link("middle-a", "tension", "VS"),
		],
		searchResults: [searchResult(resonance, TARGET_SEARCH_SCORE)],
	});

	assertEquals(
		candidates.map(({ kind, targetWorkId }) => ({ kind, targetWorkId })),
		[
			{ kind: "latent-relation", targetWorkId: "latent" },
			{ kind: "cross-branch-resonance", targetWorkId: "resonance" },
			{ kind: "productive-tension", targetWorkId: "tension" },
		],
	);
	assertEquals(candidates[0].score, EXPECTED_SHARED_SCORE);
});

Deno.test("emergence calculation: filters same-branch, direct, and weak lexical candidates", () => {
	const root = item("root");
	const context = item("context", root.id);
	const sameBranch = item("same-branch", root.id);
	const direct = item("direct");
	const weak = item("weak");
	const target = item("target");
	const candidates = calculateEmergenceCandidates({
		context,
		items: [root, context, sameBranch, direct, weak, target],
		links: [link("context", "direct", "RELATED")],
		searchResults: [
			searchResult(sameBranch, STRONG_SEARCH_SCORE),
			searchResult(direct, STRONG_SEARCH_SCORE),
			searchResult(weak, WEAK_SEARCH_SCORE),
			searchResult(target, TARGET_SEARCH_SCORE),
		],
	});

	assertEquals(candidates.map(({ kind, targetWorkId }) => ({ kind, targetWorkId })), [
		{ kind: "cross-branch-resonance", targetWorkId: "target" },
	]);
});

Deno.test("emergence ranking: pinned candidates precede score and the limit is applied", () => {
	const lowPinned = materializedSuggestion("low-pinned", LOW_SCORE, "pinned");
	const high = materializedSuggestion("high", HIGH_SCORE);
	const medium = materializedSuggestion("medium", MEDIUM_SCORE);

	assertEquals(
		rankEmergenceSuggestions([medium, high, lowPinned], RANKING_LIMIT).map(({ id }) => id),
		["low-pinned", "high"],
	);
});

function materializedSuggestion(
	id: string,
	score: number,
	status?: EmergenceSuggestion["status"],
): EmergenceSuggestion {
	return {
		id,
		kind: "latent-relation",
		contextWorkId: "context",
		targetWorkId: id,
		contextItemId: "context-occ",
		targetItemId: `${id}-occ`,
		proposedLinkType: "LIKE",
		title: id,
		explanation: id,
		evidence: [],
		score,
		persistenceStatus: status === "pinned" ? "held" : "pending",
		createdAt: NOW,
		updatedAt: NOW,
		...(status ? { status } : {}),
	};
}
