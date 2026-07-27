import { assert, assertEquals, assertGreater } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import {
	buildDirectNeighborSet,
	calculateTreeLayout,
	labelForItem,
	lodForDensity,
} from "../src/ui/tree_layout.ts";

function item(
	id: string,
	createdAt: string,
	parentId: string | null = null,
	text = id,
): OutlineItem {
	return {
		id,
		workId: id,
		text,
		parentId,
		orderKey: Number(id.replace(/\D/g, "")) || 1,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: id },
		createdAt,
		updatedAt: createdAt,
	};
}

function snapshot(items: OutlineItem[]): OutlineSnapshot {
	return { items, links: [], knots: [], stashItemIds: [] };
}

function link(
	fromId: string,
	toId: string,
	type: "RELATED" | "FROM" | "LIKE",
): OutlineSnapshot["links"][number] {
	return {
		id: `${type}-${fromId}-${toId}`,
		fromId,
		toId,
		from: { scope: "work", workId: fromId },
		to: { scope: "work", workId: toId },
		type,
		status: "asserted",
		origin: "human",
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}

Deno.test("tree labels use the first non-empty line and clamp to two lines", () => {
	const result = labelForItem(`\n${"思".repeat(40)}\nignored`);
	assertEquals(result.lines.length, 2);
	assert(result.label.endsWith("…"));
	assertEquals([...result.label].length, 32);
});

Deno.test("LOD follows the agreed screen density thresholds", () => {
	assertEquals(lodForDensity(120), "detail");
	assertEquals(lodForDensity(64), "context");
	assertEquals(lodForDensity(20), "overview");
});

Deno.test("dense detail nodes are assigned to separate non-overlapping lanes", () => {
	const data = snapshot([
		item("n1", "2025-01-01T00:00:00.000Z", null, "最初の長い思索"),
		item("n2", "2025-01-01T00:00:01.000Z", "n1", "二番目の長い思索"),
		item("n3", "2025-01-01T00:00:02.000Z", "n2", "三番目の長い思索"),
	]);
	const layout = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projectX: () => 280,
	});
	assertEquals(layout.lod, "detail");
	assertEquals(new Set(layout.nodes.map((node) => node.lane)).size, 3);
	assertGreater(layout.contentHeight, 0);
});

Deno.test("overview aggregates screen cells and merges duplicate projected links", () => {
	const data = snapshot([
		item("n1", "2025-01-01T00:00:00.000Z"),
		item("n2", "2025-01-02T00:00:00.000Z", "n1"),
		item("n3", "2025-01-03T00:00:00.000Z", "n1"),
		item("n4", "2025-01-04T00:00:00.000Z"),
	]);
	data.links.push(link("n1", "n2", "RELATED"), link("n1", "n3", "RELATED"));
	const layout = calculateTreeLayout(data, {
		width: 30,
		height: 120,
		projectX: () => 10,
	});
	assertEquals(layout.lod, "overview");
	assert(layout.nodes.some((node) => node.aggregate));
	assert(layout.nodes.reduce((total, node) => total + node.count, 0) === 4);
	assertEquals(layout.edges.length, 1);
	assertEquals(layout.edges[0].count, 2);
});

Deno.test("direct neighborhood includes parent, children, and related links", () => {
	const data = snapshot([
		item("parent", "2025-01-01T00:00:00.000Z"),
		item("focus", "2025-01-02T00:00:00.000Z", "parent"),
		item("child", "2025-01-03T00:00:00.000Z", "focus"),
		item("related", "2025-01-04T00:00:00.000Z"),
	]);
	data.links.push({
		id: "link-1",
		fromId: "focus",
		toId: "related",
		from: { scope: "work", workId: "focus" },
		to: { scope: "work", workId: "related" },
		type: "LIKE",
		status: "asserted",
		origin: "human",
		createdAt: "2025-01-05T00:00:00.000Z",
	});
	assertEquals(
		buildDirectNeighborSet(data, "focus"),
		new Set(["focus", "parent", "child", "related"]),
	);
});

Deno.test("FROM draws from parent source to child target", () => {
	const data = snapshot([
		item("parent", "2026-01-01T00:00:00.000Z"),
		item("child", "2026-01-02T00:00:00.000Z"),
	]);
	data.links.push(link("child", "parent", "FROM"));
	const layout = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projectX: () => 280,
	});

	const edge = layout.edges.find((candidate) => candidate.type === "FROM");
	assertEquals(edge?.source.id, "parent");
	assertEquals(edge?.target.id, "child");
	assertEquals(edge?.count, 1);
});

Deno.test("Work links project to one visible Occurrence while neighborhood includes every mirror", () => {
	const source = item("source-primary", "2026-01-01T00:00:00.000Z");
	source.workId = "source-work";
	const mirror = item("source-mirror", "2026-01-02T00:00:00.000Z");
	mirror.workId = source.workId;
	const target = item("target", "2026-01-03T00:00:00.000Z");
	target.workId = "target-work";
	const data = snapshot([source, mirror, target]);
	data.links.push(link(source.workId, target.workId, "RELATED"));

	const layout = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projectX: (timestamp) => timestamp,
	});
	const edge = layout.edges.find((candidate) => candidate.type === "RELATED");

	assertEquals(edge?.source.id, source.id);
	assertEquals(edge?.target.id, target.id);
	assertEquals(
		buildDirectNeighborSet(data, target.id),
		new Set([target.id, source.id, mirror.id]),
	);
});
