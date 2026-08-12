import { assertEquals } from "jsr:@std/assert@1";
import type { InternalReferenceCompletion } from "../src/services/internal_reference_service.ts";
import {
	filterInlineLinkCandidates,
	isSameInlineLinkTrigger,
} from "../src/ui/inline_link_completion.ts";

function candidate(
	id: string,
	displayName: string,
	scope: "work" | "revision" = "work",
	isEmpty = false,
): InternalReferenceCompletion {
	return {
		scope,
		id,
		workId: id,
		displayName,
		isEmpty,
		scopeLabel: scope === "work" ? "項目" : "固定版",
		shortId: id,
		canonicalMarkdown: "",
	};
}

Deno.test("inline link completion keeps its state for an unchanged editor trigger", () => {
	const current = { itemId: "item", query: "target", range: { start: 3, end: 10 } };

	assertEquals(
		isSameInlineLinkTrigger(current, "item", {
			query: "target",
			range: { start: 3, end: 10 },
		}),
		true,
	);
	assertEquals(
		isSameInlineLinkTrigger(current, "item", {
			query: "changed",
			range: { start: 3, end: 11 },
		}),
		false,
	);
});

Deno.test("inline link trigger identity rejects missing or different items", () => {
	const trigger = { query: "target", range: { start: 3, end: 10 } };
	assertEquals(isSameInlineLinkTrigger(null, "item", trigger), false);
	assertEquals(
		isSameInlineLinkTrigger({ itemId: "other", ...trigger }, "item", trigger),
		false,
	);
});

Deno.test("inline link completion ignores the source, revisions, and blank Works", () => {
	assertEquals(
		filterInlineLinkCandidates([
			candidate("source", "Source"),
			candidate("blank", "(空の項目)", "work", true),
			candidate("alternate-only", "別稿の本文"),
			candidate("revision", "Revision", "revision"),
			candidate("target", "Target"),
		], "source").map((entry) => entry.id),
		["alternate-only", "target"],
	);
});
