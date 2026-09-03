import { assertEquals } from "jsr:@std/assert@1";
import { LINK_TYPES, type LinkType, type OutlineItem, type OutlineLink } from "../domain/models.ts";
import {
	applyGlobalLineageFilter,
	defaultGlobalLineageFilter,
	isValidGlobalLineageFilter,
} from "./global_lineage_filter.ts";

function item(workId: string, id = workId): OutlineItem {
	return {
		id,
		workId,
		text: workId,
		parentId: null,
		orderKey: 1,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "main" },
		createdAt: "2026-08-06T00:00:00.000Z",
		updatedAt: "2026-08-06T00:00:00.000Z",
	};
}

function link(
	fromId: string,
	toId: string,
	type: LinkType = "RELATED",
	status: OutlineLink["status"] = "asserted",
): OutlineLink {
	return {
		id: `${type}-${fromId}-${toId}-${status}`,
		fromId,
		toId,
		from: { scope: "work", workId: fromId },
		to: { scope: "work", workId: toId },
		type,
		status,
		origin: "human",
		createdAt: "2026-08-06T00:00:00.000Z",
	};
}

function allTypes(): LinkType[] {
	return [...defaultGlobalLineageFilter().linkTypes];
}

Deno.test("isolated Works are kept when includeIsolated is on and dropped when off", () => {
	const items = [item("a"), item("b"), item("lonely")];
	const links = [link("a", "b", "RELATED")];

	const shown = applyGlobalLineageFilter(
		{ includeIsolated: true, linkTypes: allTypes(), includeWorkIds: [] },
		items,
		links,
	);
	assertEquals(shown.items.map((entry) => entry.workId), ["a", "b", "lonely"]);

	const connectedOnly = applyGlobalLineageFilter(
		{ includeIsolated: false, linkTypes: allTypes(), includeWorkIds: [] },
		items,
		links,
	);
	assertEquals(connectedOnly.items.map((entry) => entry.workId), ["a", "b"]);
	assertEquals(connectedOnly.links, links);
});

Deno.test("isolation is recomputed when the selected link types change", () => {
	const items = [item("a"), item("b")];
	const links = [link("a", "b", "RELATED")];

	const withRelated = applyGlobalLineageFilter(
		{ includeIsolated: false, linkTypes: ["RELATED"], includeWorkIds: [] },
		items,
		links,
	);
	assertEquals(withRelated.items.length, 2);

	const withoutRelated = applyGlobalLineageFilter(
		{ includeIsolated: false, linkTypes: ["FROM"], includeWorkIds: [] },
		items,
		links,
	);
	assertEquals(withoutRelated.items.length, 0);
});

Deno.test("self links, retracted links, and links to absent Works never count as connections", () => {
	const items = [item("a"), item("b")];
	const links = [
		link("a", "a", "RELATED"),
		link("a", "b", "FROM", "retracted"),
		link("a", "deleted", "LIKE"),
	];

	const result = applyGlobalLineageFilter(
		{ includeIsolated: false, linkTypes: allTypes(), includeWorkIds: [] },
		items,
		links,
	);
	assertEquals(result.items.length, 0);
	assertEquals(result.links.length, 0);
});

Deno.test("the selected Work stays visible as a transient exception without its links", () => {
	const items = [item("a"), item("b"), item("focus")];
	const links = [link("focus", "b", "RELATED")];

	const result = applyGlobalLineageFilter(
		{ includeIsolated: false, linkTypes: allTypes(), includeWorkIds: ["focus"] },
		items,
		links,
	);
	assertEquals(result.items.map((entry) => entry.workId), ["b", "focus"]);
	assertEquals(result.links.map((entry) => entry.id), [links[0].id]);
});

Deno.test("links whose endpoints disappear after filtering are removed", () => {
	const items = [item("a"), item("b"), item("c")];
	const links = [link("a", "b", "RELATED"), link("b", "c", "LIKE")];

	const result = applyGlobalLineageFilter(
		{ includeIsolated: false, linkTypes: ["RELATED"], includeWorkIds: [] },
		items,
		links,
	);
	assertEquals(result.items.map((entry) => entry.workId), ["a", "b"]);
	assertEquals(result.links.map((entry) => entry.id), [links[0].id]);
});

Deno.test("default filter shows every Work with every link type", () => {
	const result = applyGlobalLineageFilter(
		defaultGlobalLineageFilter(),
		[item("a"), item("b")],
		[link("a", "b", "DEF")],
	);
	assertEquals(result.items.length, 2);
	assertEquals(result.links.length, 1);
});

Deno.test("filter validation rejects malformed input and accepts valid input", () => {
	assertEquals(
		isValidGlobalLineageFilter({ includeIsolated: true, linkTypes: ["FROM"], includeWorkIds: [] }),
		true,
	);
	assertEquals(isValidGlobalLineageFilter({ includeIsolated: true, linkTypes: [] }), false);
	assertEquals(
		isValidGlobalLineageFilter({ includeIsolated: "yes", linkTypes: ["FROM"], includeWorkIds: [] }),
		false,
	);
	assertEquals(
		isValidGlobalLineageFilter({
			includeIsolated: true,
			linkTypes: ["NOT_A_TYPE"],
			includeWorkIds: [],
		}),
		false,
	);
	assertEquals(isValidGlobalLineageFilter(null), false);
	assertEquals(isValidGlobalLineageFilter("filter"), false);
});

Deno.test("filter validation accepts custom link types when explicitly allowed and rejects otherwise", () => {
	const customAllowed = [...LINK_TYPES, "CAUSES"] as const;
	const filterWithCustom = {
		includeIsolated: true,
		linkTypes: ["CAUSES"],
		includeWorkIds: [],
	};

	assertEquals(isValidGlobalLineageFilter(filterWithCustom, customAllowed), true);
	assertEquals(isValidGlobalLineageFilter(filterWithCustom), false);

	const customDefault = defaultGlobalLineageFilter(customAllowed as readonly LinkType[]);
	assertEquals(customDefault.linkTypes.includes("CAUSES"), true);
	assertEquals(customDefault.linkTypes.length, customAllowed.length);
});
