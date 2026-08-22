import { assertEquals } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineLink } from "../domain/models.ts";
import { mergeImplicitFromLinks } from "./implicit_relation.ts";

function createItem(
	id: string,
	workId: string,
	parentId: string | null = null,
): OutlineItem {
	return {
		id,
		workId,
		text: `Text for ${id}`,
		parentId,
		orderKey: 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `branch-${workId}` },
		createdAt: "2026-08-22T00:00:00.000Z",
		updatedAt: "2026-08-22T00:00:00.000Z",
	};
}

function createExplicitLink(
	id: string,
	fromWorkId: string,
	toWorkId: string,
	type: OutlineLink["type"] = "FROM",
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
		createdAt: "2026-08-22T00:00:00.000Z",
	};
}

Deno.test("implicit relation: generates implicit FROM from parent Work to child Work with derived origin", () => {
	const items: OutlineItem[] = [
		createItem("item-1", "work-parent", null),
		createItem("item-2", "work-child", "item-1"),
	];
	const explicitLinks: OutlineLink[] = [];

	const result = mergeImplicitFromLinks(items, explicitLinks);

	assertEquals(result.length, 1);
	assertEquals(result[0].from.workId, "work-parent");
	assertEquals(result[0].to.workId, "work-child");
	assertEquals(result[0].type, "FROM");
	assertEquals(result[0].status, "asserted");
	assertEquals(result[0].origin, "derived");
});

Deno.test("implicit relation: does not generate implicit FROM when explicit link exists in either direction", () => {
	const items: OutlineItem[] = [
		createItem("item-1", "work-a", null),
		createItem("item-2", "work-b", "item-1"),
	];

	// Case 1: explicit FROM in same direction
	const explicitFrom = [createExplicitLink("link-1", "work-a", "work-b", "FROM")];
	const result1 = mergeImplicitFromLinks(items, explicitFrom);
	assertEquals(result1.length, 1);
	assertEquals(result1[0].id, "link-1");

	// Case 2: explicit VS in reverse direction
	const explicitVs = [createExplicitLink("link-2", "work-b", "work-a", "VS")];
	const result2 = mergeImplicitFromLinks(items, explicitVs);
	assertEquals(result2.length, 1);
	assertEquals(result2[0].id, "link-2");

	// Case 3: explicit RELATED in either direction
	const explicitRelated = [createExplicitLink("link-3", "work-a", "work-b", "RELATED")];
	const result3 = mergeImplicitFromLinks(items, explicitRelated);
	assertEquals(result3.length, 1);
	assertEquals(result3[0].id, "link-3");
});

Deno.test("implicit relation: does not generate implicit FROM for parent and child of the same Work", () => {
	const items: OutlineItem[] = [
		createItem("item-1", "work-same", null),
		createItem("item-2", "work-same", "item-1"),
	];
	const explicitLinks: OutlineLink[] = [];

	const result = mergeImplicitFromLinks(items, explicitLinks);

	assertEquals(result.length, 0);
});

Deno.test("implicit relation: deduplicates multiple parent-child placements of the same Work pair in same or reversed direction", () => {
	// Case 1: same direction (A->B, A->B)
	const itemsSameDir: OutlineItem[] = [
		createItem("item-p1", "work-parent", null),
		createItem("item-c1", "work-child", "item-p1"),
		createItem("item-p2", "work-parent", null),
		createItem("item-c2", "work-child", "item-p2"),
	];
	const result1 = mergeImplicitFromLinks(itemsSameDir, []);
	assertEquals(result1.length, 1);
	assertEquals(result1[0].from.workId, "work-parent");
	assertEquals(result1[0].to.workId, "work-child");

	// Case 2: reversed direction across placements (A->B and B->A)
	const itemsReversed: OutlineItem[] = [
		createItem("item-a1", "work-alpha", null),
		createItem("item-b1", "work-beta", "item-a1"),
		createItem("item-b2", "work-beta", null),
		createItem("item-a2", "work-alpha", "item-b2"),
	];
	const result2 = mergeImplicitFromLinks(itemsReversed, []);
	assertEquals(result2.length, 1);
	assertEquals(result2[0].from.workId, "work-alpha");
	assertEquals(result2[0].to.workId, "work-beta");
});

Deno.test("implicit relation: safely handles Work IDs containing delimiter characters without collision", () => {
	// work "a:b" with "c", versus "a" with "b:c"
	const items: OutlineItem[] = [
		createItem("item-1", "a:b", null),
		createItem("item-2", "c", "item-1"),
		createItem("item-3", "a", null),
		createItem("item-4", "b:c", "item-3"),
	];
	const explicitLinks = [createExplicitLink("link-1", "a:b", "c", "RELATED")];

	const result = mergeImplicitFromLinks(items, explicitLinks);

	// "a:b" <-> "c" has an explicit link, so no implicit FROM.
	// "a" <-> "b:c" must NOT collide with "a:b" <-> "c" and SHOULD generate an implicit FROM.
	assertEquals(result.length, 2);
	const implicit = result.find((link) => link.id !== "link-1");
	assertEquals(implicit !== undefined, true);
	assertEquals(implicit?.from.workId, "a");
	assertEquals(implicit?.to.workId, "b:c");
});

Deno.test("implicit relation: treats Unicode-equivalent Work IDs as distinct and keeps pair keys undirected", () => {
	const composed = "é";
	const decomposed = "e\u0301";
	const items: OutlineItem[] = [
		createItem("item-a", composed, null),
		createItem("item-b", decomposed, "item-a"),
	];
	const explicitLinks = [createExplicitLink("link-1", decomposed, composed, "RELATED")];

	const result = mergeImplicitFromLinks(items, explicitLinks);

	assertEquals(result.map((link) => link.id), ["link-1"]);
});

Deno.test("implicit relation: generates implicit FROM when explicit link is retracted", () => {
	const items: OutlineItem[] = [
		createItem("item-1", "work-parent", null),
		createItem("item-2", "work-child", "item-1"),
	];
	const explicitLinks: OutlineLink[] = [
		createExplicitLink("link-retracted", "work-parent", "work-child", "VS", "retracted"),
	];

	const result = mergeImplicitFromLinks(items, explicitLinks);

	// The retracted link remains in the list, and the active implicit FROM is added
	const implicitLink = result.find((link) => link.id !== "link-retracted");
	assertEquals(implicitLink !== undefined, true);
	assertEquals(implicitLink?.from.workId, "work-parent");
	assertEquals(implicitLink?.to.workId, "work-child");
	assertEquals(implicitLink?.type, "FROM");
	assertEquals(implicitLink?.origin, "derived");
});
