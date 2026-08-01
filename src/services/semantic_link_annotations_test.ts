import { assertEquals } from "jsr:@std/assert@1";
import type { LinkType, OutlineItem, OutlineLink } from "../domain/models.ts";
import { projectSemanticLinkAnnotations } from "./semantic_link_annotations.ts";

const NOW = "2026-08-01T00:00:00.000Z";

Deno.test("semantic link annotations project explained links per occurrence with stable order", () => {
	const items = [
		outlineItem("occ-c", "work-c", "C title\n本文"),
		outlineItem("occ-a-2", "work-a", "A second placement", "2026-08-01T00:00:02.000Z"),
		outlineItem("occ-b", "work-b", "B title\n本文"),
		outlineItem("occ-a-1", "work-a", "A first placement", "2026-08-01T00:00:01.000Z"),
	];
	const links = [
		semanticLink("vs-link", "work-c", "work-a", "VS", "対立している"),
		semanticLink("like-link", "work-b", "work-c", "LIKE", "似た問題を扱う"),
		semanticLink("from-link", "work-a", "work-b", "FROM", "Bから派生した"),
		semanticLink("empty-reason", "work-a", "work-c", "RELATED", "   "),
		semanticLink("undefined-reason", "work-a", "work-c", "RELATED", undefined),
		semanticLink("retracted-link", "work-a", "work-c", "RELATED", "撤回済み", "retracted"),
	];

	const projected = projectSemanticLinkAnnotations(items, links);
	assertEquals(projected, [
		{
			occurrenceId: "occ-a-1",
			workId: "work-a",
			linkId: "from-link",
			type: "FROM",
			direction: "outgoing",
			otherWorkId: "work-b",
			otherDisplayName: "B title",
			reason: "Bから派生した",
		},
		{
			occurrenceId: "occ-a-1",
			workId: "work-a",
			linkId: "vs-link",
			type: "VS",
			direction: "symmetric",
			otherWorkId: "work-c",
			otherDisplayName: "C title",
			reason: "対立している",
		},
		{
			occurrenceId: "occ-a-2",
			workId: "work-a",
			linkId: "from-link",
			type: "FROM",
			direction: "outgoing",
			otherWorkId: "work-b",
			otherDisplayName: "B title",
			reason: "Bから派生した",
		},
		{
			occurrenceId: "occ-a-2",
			workId: "work-a",
			linkId: "vs-link",
			type: "VS",
			direction: "symmetric",
			otherWorkId: "work-c",
			otherDisplayName: "C title",
			reason: "対立している",
		},
		{
			occurrenceId: "occ-b",
			workId: "work-b",
			linkId: "from-link",
			type: "FROM",
			direction: "incoming",
			otherWorkId: "work-a",
			otherDisplayName: "A first placement",
			reason: "Bから派生した",
		},
		{
			occurrenceId: "occ-b",
			workId: "work-b",
			linkId: "like-link",
			type: "LIKE",
			direction: "symmetric",
			otherWorkId: "work-c",
			otherDisplayName: "C title",
			reason: "似た問題を扱う",
		},
		{
			occurrenceId: "occ-c",
			workId: "work-c",
			linkId: "like-link",
			type: "LIKE",
			direction: "symmetric",
			otherWorkId: "work-b",
			otherDisplayName: "B title",
			reason: "似た問題を扱う",
		},
		{
			occurrenceId: "occ-c",
			workId: "work-c",
			linkId: "vs-link",
			type: "VS",
			direction: "symmetric",
			otherWorkId: "work-a",
			otherDisplayName: "A first placement",
			reason: "対立している",
		},
	]);

	const reversed = projectSemanticLinkAnnotations([...items].reverse(), [...links].reverse());
	assertEquals(reversed, projected);
});

Deno.test("semantic link annotations preserve directed and symmetric endpoint meaning", () => {
	const items = [
		outlineItem("source-occurrence", "source", "Source"),
		outlineItem("target-occurrence", "target", "Target"),
	];
	const links = [
		semanticLink("support-link", "source", "target", "SUPPORT", "根拠になる"),
		semanticLink("related-link", "target", "source", "RELATED", "同じ話題"),
		semanticLink("vs-link", "source", "target", "VS", "両立しない"),
	];

	const annotations = projectSemanticLinkAnnotations(items, links);
	assertEquals(
		annotations.map(({ occurrenceId, linkId, type, direction, otherWorkId }) => ({
			occurrenceId,
			linkId,
			type,
			direction,
			otherWorkId,
		})),
		[
			{
				occurrenceId: "source-occurrence",
				linkId: "related-link",
				type: "RELATED",
				direction: "symmetric",
				otherWorkId: "target",
			},
			{
				occurrenceId: "source-occurrence",
				linkId: "support-link",
				type: "SUPPORT",
				direction: "outgoing",
				otherWorkId: "target",
			},
			{
				occurrenceId: "source-occurrence",
				linkId: "vs-link",
				type: "VS",
				direction: "symmetric",
				otherWorkId: "target",
			},
			{
				occurrenceId: "target-occurrence",
				linkId: "related-link",
				type: "RELATED",
				direction: "symmetric",
				otherWorkId: "source",
			},
			{
				occurrenceId: "target-occurrence",
				linkId: "support-link",
				type: "SUPPORT",
				direction: "incoming",
				otherWorkId: "source",
			},
			{
				occurrenceId: "target-occurrence",
				linkId: "vs-link",
				type: "VS",
				direction: "symmetric",
				otherWorkId: "source",
			},
		],
	);
});

Deno.test("semantic link annotation projection is read-only and does not persist anything", () => {
	const items = [outlineItem("a-occurrence", "a", "A"), outlineItem("b-occurrence", "b", "B")];
	const links = [semanticLink("related-link", "a", "b", "RELATED", "説明")];
	const itemsBefore = structuredClone(items);
	const linksBefore = structuredClone(links);

	const first = projectSemanticLinkAnnotations(items, links);
	const second = projectSemanticLinkAnnotations(items, links);

	assertEquals(first, second);
	assertEquals(items, itemsBefore);
	assertEquals(links, linksBefore);
	assertEquals(first[0].reason, "説明");
});

function outlineItem(
	id: string,
	workId: string,
	text: string,
	createdAt = NOW,
): OutlineItem {
	return {
		id,
		workId,
		text,
		parentId: null,
		orderKey: 1,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `${workId}-branch` },
		createdAt,
		updatedAt: createdAt,
	};
}

function semanticLink(
	id: string,
	fromWorkId: string,
	toWorkId: string,
	type: LinkType,
	reason?: string,
	status: OutlineLink["status"] = "asserted",
): OutlineLink {
	return {
		id,
		fromId: fromWorkId,
		toId: toWorkId,
		from: { scope: "work", workId: fromWorkId },
		to: { scope: "work", workId: toWorkId },
		type,
		status,
		origin: "human",
		createdAt: NOW,
		reason,
	};
}
