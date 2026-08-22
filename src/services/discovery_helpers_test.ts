import { assertEquals } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineLink, SearchAlias } from "../domain/models.ts";
import { ancestorsOf, isReservedTagAlias, neighborMap, rootId } from "./discovery_helpers.ts";

function createItem(id: string, parentId: string | null = null): OutlineItem {
	return {
		id,
		workId: `work-${id}`,
		text: id,
		parentId,
		orderKey: 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `branch-${id}` },
		createdAt: "2026-08-22T00:00:00.000Z",
		updatedAt: "2026-08-22T00:00:00.000Z",
	};
}

Deno.test("discovery helpers: neighborMap constructs bidirectional neighbor sets", () => {
	const links: OutlineLink[] = [
		{
			id: "link-1",
			fromId: "a",
			toId: "b",
			from: { scope: "work", workId: "a" },
			to: { scope: "work", workId: "b" },
			type: "RELATED",
			status: "asserted",
			origin: "human",
			createdAt: "2026-08-22T00:00:00.000Z",
		},
	];
	const neighbors = neighborMap(links);
	assertEquals(neighbors.get("a"), new Set(["b"]));
	assertEquals(neighbors.get("b"), new Set(["a"]));
});

Deno.test("discovery helpers: rootId and ancestorsOf trace item hierarchy safely", () => {
	const root = createItem("root", null);
	const middle = createItem("middle", "root");
	const leaf = createItem("leaf", "middle");
	const byId = new Map([
		["root", root],
		["middle", middle],
		["leaf", leaf],
	]);

	assertEquals(rootId(leaf, byId), "root");
	assertEquals(ancestorsOf(leaf, byId), ["root", "middle"]);
	assertEquals(ancestorsOf(root, byId), []);
});

Deno.test("discovery helpers: isReservedTagAlias identifies # prefixes", () => {
	const tagAlias: SearchAlias = {
		id: "1",
		canonical: "#tag",
		variants: ["#tag-alt"],
		createdAt: "2026-08-22T00:00:00.000Z",
		updatedAt: "2026-08-22T00:00:00.000Z",
	};
	const normalAlias: SearchAlias = {
		id: "2",
		canonical: "term",
		variants: ["variation"],
		createdAt: "2026-08-22T00:00:00.000Z",
		updatedAt: "2026-08-22T00:00:00.000Z",
	};
	assertEquals(isReservedTagAlias(tagAlias), true);
	assertEquals(isReservedTagAlias(normalAlias), false);
});
