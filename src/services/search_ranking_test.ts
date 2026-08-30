import { assertEquals } from "jsr:@std/assert@1";
import type { LexicalHit, OutlineItem, OutlineLink, SearchAlias } from "../domain/models.ts";
import { buildSearchExpansions, rankSearchResults } from "./search_ranking.ts";

const NOW = "2026-08-30T00:00:00.000Z";
const ORDER_KEY = 1024;
const HIGH_TITLE_SCORE = 2;
const BODY_SCORE = 1;
const RESULT_LIMIT = 10;

function item(workId: string, text = workId, parentId: string | null = null): OutlineItem {
	return {
		id: `${workId}-occ`,
		workId,
		text,
		parentId,
		orderKey: ORDER_KEY,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `${workId}-main` },
		createdAt: NOW,
		updatedAt: NOW,
	};
}

function link(fromId: string, toId: string): OutlineLink {
	return {
		id: `${fromId}-${toId}`,
		fromId,
		toId,
		from: { scope: "work", workId: fromId },
		to: { scope: "work", workId: toId },
		type: "LIKE",
		status: "asserted",
		origin: "human",
		createdAt: NOW,
	};
}

Deno.test("search ranking: alias and LIKE expansions are calculated without a store", () => {
	const alpha = item("alpha", "Alpha");
	const beta = item("beta", "Beta");
	const alias: SearchAlias = {
		id: "alias",
		canonical: "alpha",
		variants: ["first"],
		createdAt: NOW,
		updatedAt: NOW,
	};

	assertEquals(
		buildSearchExpansions({
			query: "alpha",
			aliases: [alias],
			items: [alpha, beta],
			links: [link("alpha", "beta")],
		}),
		[
			{ term: "first", weight: 0.9, label: "別名: first" },
			{ term: "beta", weight: 0.5, label: "LIKEリンク: Beta" },
		],
	);
});

Deno.test("search ranking: graph context and lexical scores determine order without a store", () => {
	const context = item("context");
	const direct = item("direct", "query");
	const lexical = item("lexical", "other");
	const baseHits: LexicalHit[] = [
		{ item: lexical, titleScore: HIGH_TITLE_SCORE, bodyScore: BODY_SCORE },
		{ item: direct, titleScore: HIGH_TITLE_SCORE, bodyScore: 0 },
	];

	const results = rankSearchResults({
		query: "query",
		limit: RESULT_LIMIT,
		contextItemId: context.id,
		items: [context, direct, lexical],
		links: [link("context", "direct")],
		baseHits,
		expansionHits: [],
	});

	assertEquals(results.map((result) => result.item.workId), ["direct", "lexical"]);
	assertEquals(results[0].reasons.map((reason) => reason.kind), ["title", "direct-link"]);
});
