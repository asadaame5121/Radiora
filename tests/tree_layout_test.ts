import { assert, assertEquals, assertGreater } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import {
	buildDirectNeighborSet,
	buildLaneOrder,
	calculateLineageProjection,
	calculateTreeLayout,
	labelForItem,
	lodForScreenCollisions,
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

Deno.test("LOD follows screen-space collisions instead of a density proxy", () => {
	assertEquals(
		lodForScreenCollisions([
			{ x: 0, y: 0 },
			{ x: 100, y: 100 },
			{ x: 200, y: 200 },
		]),
		"detail",
	);
	assertEquals(
		lodForScreenCollisions([
			{ x: 100, y: 100 },
			{ x: 110, y: 100 },
			{ x: 200, y: 200 },
			{ x: 300, y: 300 },
			{ x: 400, y: 400 },
		]),
		"context",
	);
	assertEquals(
		lodForScreenCollisions([
			{ x: 100, y: 100 },
			{ x: 110, y: 100 },
			{ x: 200, y: 200 },
			{ x: 210, y: 200 },
			{ x: 400, y: 400 },
		]),
		"overview",
	);
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

Deno.test("Chronology lanes reserve space for labels, not only node circles", () => {
	const data = snapshot([
		item("early", "2025-01-01T00:00:00.000Z", null, "これは右側へ長く伸びるChronologyラベルです"),
		item("late", "2025-01-01T00:00:01.000Z", null, "近い時刻の別ラベル"),
	]);
	const layout = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projectX: (timestamp) => timestamp / 1000,
	});
	const early = layout.nodes.find((node) => node.id === "early");
	const late = layout.nodes.find((node) => node.id === "late");
	assert(early && late);
	assert(early.lane !== late.lane);
});

Deno.test("overview aggregates screen cells and merges duplicate projected links", () => {
	const data = snapshot([
		item("n1", "2025-01-01T00:00:00.000Z"),
		item("n2", "2025-01-02T00:00:00.000Z", "n1"),
		item("n3", "2025-01-03T00:00:00.000Z", "n1"),
		item("n4", "2025-01-04T00:00:00.000Z"),
	]);
	data.links.push(link("n1", "n3", "RELATED"), link("n2", "n4", "RELATED"));
	const layout = calculateTreeLayout(data, {
		width: 30,
		height: 120,
		projectX: () => 10,
		// Zoomed out enough that lane spacing falls below one 36px cell.
		camera: { k: .45, x: 0, y: 0 },
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

Deno.test("Lineage generation anchors asserted FROM sources at G0 and takes the deepest parent", () => {
	const data = snapshot([
		item("root-a", "2026-04-01T00:00:00.000Z"),
		item("root-b", "2026-01-01T00:00:00.000Z"),
		// Occurrence placement deliberately disagrees with the FROM lineage.
		item("middle", "2026-03-01T00:00:00.000Z", "root-b"),
		item("child", "2026-02-01T00:00:00.000Z", "root-a"),
	]);
	data.links.push(
		link("middle", "root-a", "FROM"),
		link("child", "root-b", "FROM"),
		link("child", "middle", "FROM"),
		link("root-b", "root-a", "RELATED"),
	);

	const lineage = calculateLineageProjection(data);
	assertEquals(lineage.generationByWorkId.get("child"), 0);
	assertEquals(lineage.generationByWorkId.get("middle"), 1);
	assertEquals(lineage.generationByWorkId.get("root-b"), 1);
	assertEquals(lineage.generationByWorkId.get("root-a"), 2);

	const layout = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projection: "lineage",
		projectX: () => -1,
		projectGeneration: (generation) => generation * 100,
	});
	assertEquals(layout.nodes.find((node) => node.id === "child")?.x, 0);
});

Deno.test("Lineage keeps a source with multiple FROM targets at G0", () => {
	const data = snapshot([
		item("improvement", "2026-04-01T00:00:00.000Z"),
		item("target-a", "2026-03-01T00:00:00.000Z"),
		item("target-b", "2026-02-01T00:00:00.000Z"),
	]);
	data.links.push(
		link("improvement", "target-a", "FROM"),
		link("improvement", "target-b", "FROM"),
	);

	const lineage = calculateLineageProjection(data);
	assertEquals(lineage.generationByWorkId.get("improvement"), 0);
	assertEquals(lineage.generationByWorkId.get("target-a"), 1);
	assertEquals(lineage.generationByWorkId.get("target-b"), 1);
});

Deno.test("Lineage detects FROM cycles and deterministically isolates them in a Knot band", () => {
	const data = snapshot([
		item("a", "2026-01-03T00:00:00.000Z"),
		item("b", "2026-01-02T00:00:00.000Z"),
		item("root", "2026-01-01T00:00:00.000Z"),
		item("descendant", "2026-01-04T00:00:00.000Z"),
	]);
	data.links.push(
		link("b", "a", "FROM"),
		link("a", "b", "FROM"),
		link("descendant", "a", "FROM"),
	);

	const lineage = calculateLineageProjection(data);
	assertEquals(lineage.knotWorkIds, new Set(["a", "b"]));
	assertEquals(lineage.generationByWorkId.get("root"), 0);
	assertEquals(lineage.generationByWorkId.get("descendant"), 0);
	assertEquals(lineage.knotGeneration, 1);

	const options = {
		width: 600,
		height: 300,
		projection: "lineage" as const,
		projectX: () => -1,
		projectGeneration: (generation: number) => generation * 100,
	};
	const first = calculateTreeLayout(data, options);
	const second = calculateTreeLayout({ ...data, items: [...data.items].reverse() }, options);
	for (const id of ["a", "b"]) {
		assertEquals(first.nodes.find((node) => node.id === id)?.x, 100);
		assertEquals(first.nodes.find((node) => node.id === id)?.isLineageKnot, true);
		assertEquals(second.nodes.find((node) => node.id === id)?.x, 100);
	}
	assertEquals(data.stashItemIds, []);
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

Deno.test("moving an Occurrence does not change projected semantic link endpoints", () => {
	const source = item("source-primary", "2026-01-01T00:00:00.000Z");
	source.workId = "source-work";
	const sourceMirror = item("source-mirror", "2026-01-02T00:00:00.000Z", "container");
	sourceMirror.workId = source.workId;
	const target = item("target", "2026-01-03T00:00:00.000Z");
	target.workId = "target-work";
	const container = item("container", "2026-01-04T00:00:00.000Z");
	const data = snapshot([sourceMirror, target, container, source]);
	data.links.push(
		link(source.workId, target.workId, "RELATED"),
		link(source.workId, target.workId, "FROM"),
	);

	const options = { width: 600, height: 300, projectX: () => 280 };
	const before = calculateTreeLayout(data, options).edges.map((edge) =>
		`${edge.type}:${edge.source.item.workId}:${edge.source.id}->${edge.target.item.workId}:${edge.target.id}`
	);

	// This changes only the occurrence hierarchy, as OutlineService.moveItem does.
	source.parentId = container.id;
	sourceMirror.parentId = null;
	const after = calculateTreeLayout(
		{ ...data, items: [target, source, container, sourceMirror] },
		options,
	)
		.edges.map((edge) =>
			`${edge.type}:${edge.source.item.workId}:${edge.source.id}->${edge.target.item.workId}:${edge.target.id}`
		);

	assertEquals(before, [
		"RELATED:source-work:source-primary->target-work:target",
		"FROM:target-work:target->source-work:source-primary",
	]);
	assertEquals(after, before);
});

Deno.test("cluster ids derive from sorted item ids and survive panning and reordering", () => {
	const data = snapshot([
		item("n1", "2025-01-01T00:00:00.000Z"),
		item("n2", "2025-01-02T00:00:00.000Z", "n1"),
		item("n3", "2025-01-03T00:00:00.000Z", "n1"),
		item("n4", "2025-01-04T00:00:00.000Z"),
	]);
	const options = {
		width: 300,
		height: 200,
		projectX: () => 50,
		camera: { k: .4, x: 0, y: 0 },
	};
	const first = calculateTreeLayout(data, options);
	const panned = calculateTreeLayout(data, {
		...options,
		camera: { k: .4, x: 123, y: -77 },
	});
	const reordered = calculateTreeLayout(
		{ ...data, items: [...data.items].reverse() },
		options,
	);
	const clusterOf = (layout: ReturnType<typeof calculateTreeLayout>): string | undefined =>
		layout.nodes.find((node) => node.aggregate)?.id;

	assert(clusterOf(first), "the zoomed-out items should form a cluster");
	assertEquals(clusterOf(first), clusterOf(panned));
	assertEquals(clusterOf(first), clusterOf(reordered));
});

Deno.test("cluster nodes expose their constituent item ids and world-space bounds", () => {
	const data = snapshot([
		item("n1", "2025-01-01T00:00:00.000Z"),
		item("n2", "2025-01-02T00:00:00.000Z", "n1"),
		item("n3", "2025-01-03T00:00:00.000Z", "n1"),
		item("n4", "2025-01-04T00:00:00.000Z"),
	]);
	const layout = calculateTreeLayout(data, {
		width: 300,
		height: 200,
		projectX: () => 50,
		camera: { k: .4, x: 0, y: 0 },
	});
	const cluster = layout.nodes.find((node) => node.aggregate);
	assert(cluster);
	assertEquals(cluster.itemIds, ["n1", "n2", "n3"]);
	assert(cluster.bounds);
	assertEquals(cluster.bounds.minX, 50);
	assertEquals(cluster.bounds.maxX, 50);
	assertEquals(cluster.bounds.minY, 60);
	assertEquals(cluster.bounds.maxY, 148);
});

Deno.test("world coordinates stay fixed while the camera moves nodes on screen", () => {
	const data = snapshot([
		item("early", "2026-01-01T00:00:00.000Z"),
		item("late", "2026-01-03T00:00:00.000Z"),
	]);
	const base = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projectX: (timestamp) => timestamp / 1000,
		camera: { k: 2, x: 50, y: -20 },
	});
	assertEquals(base.lod, "detail");
	for (const node of base.nodes) {
		assertEquals(node.x, node.worldX * 2 + 50);
		assertEquals(node.y, node.worldY * 2 - 20);
	}

	const unzoomed = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projectX: (timestamp) => timestamp / 1000,
	});
	for (const node of unzoomed.nodes) {
		assertEquals(node.x, node.worldX);
		assertEquals(node.y, node.worldY);
	}
	const shared = new Map(base.nodes.map((node) => [node.id, node]));
	for (const node of unzoomed.nodes) {
		assertEquals(node.worldX, shared.get(node.id)?.worldX);
		assertEquals(node.worldY, shared.get(node.id)?.worldY);
	}
});

Deno.test("same-generation items are ordered by FROM component then orderKey and id", () => {
	const data = snapshot([
		item("b", "2026-01-01T00:00:00.000Z", null, "component-a"),
		item("a", "2026-01-01T00:00:00.000Z", null, "component-a"),
		item("d", "2026-01-01T00:00:00.000Z", null, "component-b"),
		item("c", "2026-01-01T00:00:00.000Z", null, "component-b"),
	]);
	data.links.push(
		link("a", "b", "FROM"),
		link("c", "d", "FROM"),
	);
	// Component {a,b} has the smallest orderKey (a=1, b=2) so it is placed first.
	const layout = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projectX: () => 280,
	});
	assertEquals(layout.lod, "detail");
	assertEquals(layout.nodes.map((node) => node.id), ["a", "b", "c", "d"]);
	assertEquals(
		layout.nodes.map((node) => node.lane),
		[0, 1, 2, 3],
	);
});

Deno.test("buildLaneOrder keeps unlinked items in stable orderKey sequence", () => {
	const data = snapshot([
		item("z", "2026-01-01T00:00:00.000Z"),
		item("a", "2026-01-01T00:00:00.000Z"),
	]);
	const order = buildLaneOrder(data);
	assertEquals(order.get("a"), 0);
	assertEquals(order.get("z"), 1);
});
