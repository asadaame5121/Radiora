import { expect, test } from "vitest";
import { LINK_TYPES } from "../../../src/domain/models.ts";
import type { InternalReferenceCompletion } from "../../../src/services/internal_reference_service.ts";
import {
	defaultRelationType,
	filterInlineLinkCandidates,
	inlineLinkCandidateCount,
	inlineLinkCandidateFromCreated,
	isSameInlineLinkTrigger,
	relationTypeNames,
} from "../../../src/ui/inline_link_completion.ts";

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

test("inline link completion keeps its state for an unchanged editor trigger", () => {
	const current = { itemId: "item", query: "target", range: { start: 3, end: 10 } };

	expect(
		isSameInlineLinkTrigger(current, "item", {
			query: "target",
			range: { start: 3, end: 10 },
		}),
	).toEqual(true);
	expect(
		isSameInlineLinkTrigger(current, "item", {
			query: "changed",
			range: { start: 3, end: 11 },
		}),
	).toEqual(false);
});

test("inline link trigger identity rejects missing or different items", () => {
	const trigger = { query: "target", range: { start: 3, end: 10 } };
	expect(isSameInlineLinkTrigger(null, "item", trigger)).toEqual(false);
	expect(isSameInlineLinkTrigger({ itemId: "other", ...trigger }, "item", trigger)).toEqual(false);
});

test("inline link completion ignores the source, revisions, and blank Works", () => {
	expect(
		filterInlineLinkCandidates(
			[
				candidate("source", "Source"),
				candidate("blank", "(空の項目)"),
				candidate("revision", "Revision", "revision"),
				candidate("target", "Target"),
			],
			"source",
		).map((entry) => entry.id),
	).toEqual(["target"]);
});

test("empty relation type list falls back to built-in types", () => {
	expect(relationTypeNames(() => [])).toEqual(LINK_TYPES);
	expect(defaultRelationType(() => [])).toEqual("RELATED");
});

test("candidate count includes creation only for a nonempty completed search", () => {
	const candidates = [candidate("target", "Target")];
	expect(inlineLinkCandidateCount({ candidates, query: "Target", searching: false })).toEqual(2);
	expect(inlineLinkCandidateCount({ candidates, query: "  ", searching: false })).toEqual(1);
	expect(inlineLinkCandidateCount({ candidates, query: "Target", searching: true })).toEqual(1);
});

test("created Work completion uses its first nonempty line or the empty label", () => {
	const work = {
		workId: "work-123456789",
		branchId: "branch-1",
		text: "  \n  Named Work  \n Later",
		createdAt: "2026-09-26T00:00:00.000Z",
		updatedAt: "2026-09-26T00:00:00.000Z",
	};
	expect(inlineLinkCandidateFromCreated(work, "Work")).toEqual({
		scope: "work",
		id: work.workId,
		workId: work.workId,
		displayName: "Named Work",
		scopeLabel: "未配置",
		shortId: "work-123",
		canonicalMarkdown: "[Named Work](radiora://work/work-123456789)",
	});
	expect(inlineLinkCandidateFromCreated({ ...work, text: " \n " }, "Work").displayName).toEqual(
		"(空のWork)",
	);
});
