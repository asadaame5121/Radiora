import { assert, assertEquals, assertGreater } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import {
	buildDirectNeighborSet,
	calculateTreeLayout,
	labelForItem,
	lodForDensity,
} from "../src/ui/tree_layout.ts";

function item(id: string, createdAt: string, parentId: string | null = null, text = id): OutlineItem {
	return {
		id,
		text,
		parentId,
		orderKey: Number(id.replace(/\D/g, "")) || 1,
		collapsed: false,
		createdAt,
		updatedAt: createdAt,
	};
}

function snapshot(items: OutlineItem[]): OutlineSnapshot {
	return { items, links: [], knots: [], stashItemIds: [] };
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
	]);
	const layout = calculateTreeLayout(data, {
		width: 30,
		height: 120,
		projectX: () => 10,
	});
	assertEquals(layout.lod, "overview");
	assert(layout.nodes.some((node) => node.aggregate));
	assert(layout.nodes.reduce((total, node) => total + node.count, 0) === 3);
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
		fromId: "focus",
		toId: "related",
		type: "LIKE",
		createdAt: "2025-01-05T00:00:00.000Z",
	});
	assertEquals(
		buildDirectNeighborSet(data, "focus"),
		new Set(["focus", "parent", "child", "related"]),
	);
});
