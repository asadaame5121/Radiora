import { assertEquals } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineLink, SearchResult } from "../domain/models.ts";
import { calculateEmergenceSuggestions } from "./emergence_suggestion_calculator.ts";

const NOW = "2026-08-24T00:00:00.000Z";

function item(workId: string, parentId: string | null = null): OutlineItem {
	return {
		id: `${workId}-occ`,
		workId,
		text: workId,
		parentId,
		orderKey: 1024,
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

Deno.test("emergence calculation: ranks a shared-neighbor candidate without a store", () => {
	const context = item("context");
	const target = item("target");
	const middleA = item("middle-a");
	const middleB = item("middle-b");
	const suggestions = calculateEmergenceSuggestions({
		context,
		items: [context, target, middleA, middleB],
		links: [
			link("context", "middle-a", "LIKE"),
			link("context", "middle-b", "LIKE"),
			link("target", "middle-a", "LIKE"),
			link("target", "middle-b", "LIKE"),
		],
		searchResults: [],
	});

	assertEquals(
		suggestions.map(({ kind, targetWorkId, score }) => ({ kind, targetWorkId, score })),
		[
			{ kind: "latent-relation", targetWorkId: "target", score: 2 / 3 },
		],
	);
	assertEquals(suggestions[0].evidence, [
		{ fromId: "context-occ", toId: "middle-a-occ", relation: "LIKE" },
		{ fromId: "middle-a-occ", toId: "target-occ", relation: "LIKE" },
		{ fromId: "context-occ", toId: "middle-b-occ", relation: "LIKE" },
		{ fromId: "middle-b-occ", toId: "target-occ", relation: "LIKE" },
	]);
});

Deno.test("emergence calculation: filters lexical candidates by branch, score, and direct links", () => {
	const root = item("root");
	const context = item("context", root.id);
	const sameBranch = item("same-branch", root.id);
	const direct = item("direct");
	const weak = item("weak");
	const target = item("target");
	const suggestions = calculateEmergenceSuggestions({
		context,
		items: [root, context, sameBranch, direct, weak, target],
		links: [link("context", "direct", "RELATED")],
		searchResults: [
			searchResult(sameBranch, 0.9),
			searchResult(direct, 0.9),
			searchResult(weak, 0.34),
			searchResult(target, 0.8),
		],
	});

	assertEquals(
		suggestions.map(({ kind, targetWorkId, score }) => ({ kind, targetWorkId, score })),
		[
			{ kind: "cross-branch-resonance", targetWorkId: "target", score: 0.8 },
		],
	);
});

Deno.test("emergence calculation: derives productive tension through LIKE then VS or FIX", () => {
	const context = item("context");
	const middle = item("middle");
	const versusTarget = item("versus-target");
	const fixTarget = item("fix-target");
	const suggestions = calculateEmergenceSuggestions({
		context,
		items: [context, middle, versusTarget, fixTarget],
		links: [
			link("context", "middle", "LIKE"),
			link("middle", "versus-target", "VS"),
			link("fix-target", "middle", "FIX"),
		],
		searchResults: [],
	});

	assertEquals(
		suggestions.map(({ kind, targetWorkId, proposedLinkType, explanation }) => ({
			kind,
			targetWorkId,
			proposedLinkType,
			explanation,
		})),
		[
			{
				kind: "productive-tension",
				targetWorkId: "versus-target",
				proposedLinkType: "RELATED",
				explanation: "類似する思索の先にVS関係があります。",
			},
			{
				kind: "productive-tension",
				targetWorkId: "fix-target",
				proposedLinkType: "RELATED",
				explanation: "類似する思索の先にFIX関係があります。",
			},
		],
	);
});
