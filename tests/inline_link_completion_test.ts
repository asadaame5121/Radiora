import { assertEquals } from "jsr:@std/assert@1";
import { LINK_TYPES } from "../src/domain/models.ts";
import type { InternalReferenceCompletion } from "../src/services/internal_reference_service.ts";
import {
	defaultRelationType,
	filterInlineLinkCandidates,
	inlineLinkCandidateCount,
	inlineLinkCandidateFromCreated,
	isSameInlineLinkTrigger,
	relationTypeNames,
} from "../src/ui/inline_link_completion.ts";

function candidate(
	id: string,
	displayName: string,
	scope: "work" | "revision" = "work",
): InternalReferenceCompletion {
	return {
		scope,
		id,
		workId: id,
		displayName,
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
			candidate("blank", "(空の項目)"),
			candidate("revision", "Revision", "revision"),
			candidate("target", "Target"),
		], "source").map((entry) => entry.id),
		["target"],
	);
});

Deno.test("empty relation type list falls back to built-in types", () => {
	assertEquals(relationTypeNames(() => []), LINK_TYPES);
	assertEquals(defaultRelationType(() => []), "RELATED");
});

Deno.test("candidate count includes creation only for a nonempty completed search", () => {
	const candidates = [candidate("target", "Target")];
	assertEquals(inlineLinkCandidateCount({ candidates, query: "Target", searching: false }), 2);
	assertEquals(inlineLinkCandidateCount({ candidates, query: "  ", searching: false }), 1);
	assertEquals(inlineLinkCandidateCount({ candidates, query: "Target", searching: true }), 1);
});

Deno.test("created Work completion uses its first nonempty line or the empty label", () => {
	const work = {
		workId: "work-123456789",
		branchId: "branch-1",
		text: "  \n  Named Work  \n Later",
		createdAt: "2026-09-26T00:00:00.000Z",
		updatedAt: "2026-09-26T00:00:00.000Z",
	};
	assertEquals(inlineLinkCandidateFromCreated(work, "Work"), {
		scope: "work",
		id: work.workId,
		workId: work.workId,
		displayName: "Named Work",
		scopeLabel: "未配置",
		shortId: "work-123",
		canonicalMarkdown: "[Named Work](radiora://work/work-123456789)",
	});
	assertEquals(
		inlineLinkCandidateFromCreated({ ...work, text: " \n " }, "Work").displayName,
		"(空のWork)",
	);
});
