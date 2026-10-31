import { expect, test } from "vitest";
import { buildLaneOrder } from "../../../src/ui/tree_lane_order.ts";
import { calculateLineageProjection } from "../../../src/ui/tree_lineage_projection.ts";
import type { OutlineItem, OutlineSnapshot } from "../../../src/domain/models.ts";
import {
	applyTreeCamera,
	buildDirectNeighborSet,
	calculateTreeLayout,
	calculateTreeWorldLayout,
	labelForItem,
	lodForScreenCollisions,
} from "../../../src/ui/tree_layout.ts";
import { buildStructuralClosure } from "../../../src/ui/tree_highlight.ts";

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
	type: OutlineSnapshot["links"][number]["type"],
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

test("tree labels use the first non-empty line and clamp to two lines", () => {
	const result = labelForItem(`\n${"思".repeat(40)}\nignored`);
	expect(result.lines.length).toEqual(2);
	expect(result.label.endsWith("…")).toBeTruthy();
	expect([...result.label].length).toEqual(32);
});

test("LOD follows screen-space collisions instead of a density proxy", () => {
	expect(
		lodForScreenCollisions([
			{ x: 0, y: 0 },
			{ x: 100, y: 100 },
			{ x: 200, y: 200 },
		]),
	).toEqual("detail");
	expect(
		lodForScreenCollisions([
			{ x: 100, y: 100 },
			{ x: 110, y: 100 },
			{ x: 200, y: 200 },
			{ x: 300, y: 300 },
			{ x: 400, y: 400 },
		]),
	).toEqual("context");
	expect(
		lodForScreenCollisions([
			{ x: 100, y: 100 },
			{ x: 110, y: 100 },
			{ x: 200, y: 200 },
			{ x: 210, y: 200 },
			{ x: 400, y: 400 },
		]),
	).toEqual("overview");
});

test("dense detail nodes are assigned to separate non-overlapping lanes", () => {
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
	expect(layout.lod).toEqual("detail");
	expect(new Set(layout.nodes.map((node) => node.lane)).size).toEqual(3);
	expect(layout.contentHeight).toBeGreaterThan(0);
});

test("Chronology lanes reserve space for labels, not only node circles", () => {
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
	if (!early || !late) throw new Error("expected early and late nodes");
	expect(early.lane !== late.lane).toBeTruthy();
});

test("overview aggregates screen cells and merges duplicate projected links", () => {
	const data = snapshot([
		item("n1", "2025-01-01T00:00:00.000Z"),
		item("n2", "2025-01-02T00:00:00.000Z", "n1"),
		item("n3", "2025-01-03T00:00:00.000Z", "n1"),
		item("n4", "2025-01-04T00:00:00.000Z"),
	]);
	data.links.push(link("n2", "n4", "RELATED"), link("n3", "n4", "RELATED"));
	const layout = calculateTreeLayout(data, {
		width: 30,
		height: 120,
		projectX: (timestamp) => (timestamp === Date.parse("2025-01-04T00:00:00.000Z") ? 200 : 10),
		// Zoomed out enough that lane spacing falls below one 36px cell.
		camera: { k: 0.45, x: 0, y: 0 },
	});
	expect(layout.lod).toEqual("overview");
	expect(layout.nodes.some((node) => node.aggregate)).toBeTruthy();
	expect(layout.nodes.reduce((total, node) => total + node.count, 0) === 4).toBeTruthy();
	expect(layout.edges.length).toEqual(1);
	expect(layout.edges[0].count).toEqual(2);
});

test("direct neighborhood includes parent, children, and related links", () => {
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
	expect(buildDirectNeighborSet(data, "focus")).toEqual(
		new Set(["focus", "parent", "child", "related"]),
	);
});

test("structural closure includes every ancestor and descendant, but not siblings", () => {
	const data = snapshot([
		item("root", "2025-01-01T00:00:00.000Z"),
		item("branch", "2025-01-02T00:00:00.000Z", "root"),
		item("leaf", "2025-01-03T00:00:00.000Z", "branch"),
		item("sibling", "2025-01-04T00:00:00.000Z", "root"),
	]);

	expect(buildStructuralClosure(data, "branch")).toEqual(new Set(["branch", "root", "leaf"]));
	expect(buildStructuralClosure(data, "root")).toEqual(
		new Set(["root", "branch", "sibling", "leaf"]),
	);
});

test("structural closure stops safely at missing or cyclic parents", () => {
	const data = snapshot([
		item("a", "2025-01-01T00:00:00.000Z", "b"),
		item("b", "2025-01-02T00:00:00.000Z", "a"),
		item("orphan", "2025-01-03T00:00:00.000Z", "missing"),
	]);

	expect(buildStructuralClosure(data, "a")).toEqual(new Set(["a", "b"]));
	expect(buildStructuralClosure(data, "orphan")).toEqual(new Set(["orphan"]));
});

test("structural closure follows active FROM links but ignores other semantic links", () => {
	const data = snapshot([
		item("root", "2025-01-01T00:00:00.000Z"),
		item("branch", "2025-01-02T00:00:00.000Z"),
		item("leaf", "2025-01-03T00:00:00.000Z"),
	]);
	data.links.push(
		{ ...link("root", "branch", "FROM"), origin: "derived" },
		link("branch", "leaf", "FROM"),
		link("root", "leaf", "RELATED"),
	);

	expect(buildStructuralClosure(data, "branch")).toEqual(new Set(["branch", "root", "leaf"]));
});

test("FROM draws from parent source to child target", () => {
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
	expect(edge?.source.id).toEqual("parent");
	expect(edge?.target.id).toEqual("child");
	expect(edge?.count).toEqual(1);
});

test("Lineage generation anchors asserted FROM sources at G0 and takes the deepest parent", () => {
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
	expect(lineage.generationByWorkId.get("child")).toEqual(0);
	expect(lineage.generationByWorkId.get("middle")).toEqual(1);
	expect(lineage.generationByWorkId.get("root-b")).toEqual(1);
	expect(lineage.generationByWorkId.get("root-a")).toEqual(2);

	const layout = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projection: "lineage",
		projectX: () => -1,
		projectGeneration: (generation) => generation * 100,
	});
	expect(layout.nodes.find((node) => node.id === "child")?.x).toEqual(0);
});

test("Lineage keeps a source with multiple FROM targets at G0", () => {
	const data = snapshot([
		item("improvement", "2026-04-01T00:00:00.000Z"),
		item("target-a", "2026-03-01T00:00:00.000Z"),
		item("target-b", "2026-02-01T00:00:00.000Z"),
	]);
	data.links.push(link("improvement", "target-a", "FROM"), link("improvement", "target-b", "FROM"));

	const lineage = calculateLineageProjection(data);
	expect(lineage.generationByWorkId.get("improvement")).toEqual(0);
	expect(lineage.generationByWorkId.get("target-a")).toEqual(1);
	expect(lineage.generationByWorkId.get("target-b")).toEqual(1);
});

test("Lineage advances generation for custom directed relations with advancesGeneration: true", () => {
	const data = snapshot([
		item("parent", "2026-01-01T00:00:00.000Z"),
		item("child", "2026-01-02T00:00:00.000Z"),
		item("grandchild", "2026-01-03T00:00:00.000Z"),
	]);
	data.links.push(link("parent", "child", "FATHER_OF"), link("child", "grandchild", "MOTHER_OF"));

	const customDefinitions = [
		{
			name: "FATHER_OF",
			direction: "directed" as const,
			builtIn: false,
			createdAt: "1970-01-01T00:00:00.000Z",
			advancesGeneration: true,
		},
		{
			name: "MOTHER_OF",
			direction: "directed" as const,
			builtIn: false,
			createdAt: "1970-01-01T00:00:00.000Z",
			advancesGeneration: true,
		},
	];

	const lineage = calculateLineageProjection(data, customDefinitions);
	expect(lineage.generationByWorkId.get("parent")).toEqual(0);
	expect(lineage.generationByWorkId.get("child")).toEqual(1);
	expect(lineage.generationByWorkId.get("grandchild")).toEqual(2);
	expect(lineage.maxGeneration).toEqual(2);
});

test("Lineage keeps generation unchanged for directed relations with advancesGeneration: false", () => {
	const data = snapshot([
		item("elder", "2026-01-01T00:00:00.000Z"),
		item("younger", "2026-01-02T00:00:00.000Z"),
	]);
	data.links.push(link("elder", "younger", "OLDER_BROTHER_OF"));

	const customDefinitions = [
		{
			name: "OLDER_BROTHER_OF",
			direction: "directed" as const,
			builtIn: false,
			createdAt: "1970-01-01T00:00:00.000Z",
			advancesGeneration: false,
		},
	];

	const lineage = calculateLineageProjection(data, customDefinitions);
	expect(lineage.generationByWorkId.get("elder")).toEqual(0);
	expect(lineage.generationByWorkId.get("younger")).toEqual(0);
	expect(lineage.maxGeneration).toEqual(0);
});

test("Lineage detects FROM cycles and deterministically isolates them in a Knot band", () => {
	const data = snapshot([
		item("a", "2026-01-03T00:00:00.000Z"),
		item("b", "2026-01-02T00:00:00.000Z"),
		item("root", "2026-01-01T00:00:00.000Z"),
		item("descendant", "2026-01-04T00:00:00.000Z"),
	]);
	data.links.push(link("b", "a", "FROM"), link("a", "b", "FROM"), link("descendant", "a", "FROM"));

	const lineage = calculateLineageProjection(data);
	expect(lineage.knotWorkIds).toEqual(new Set(["a", "b"]));
	expect(lineage.generationByWorkId.get("root")).toEqual(0);
	expect(lineage.generationByWorkId.get("descendant")).toEqual(0);
	expect(lineage.knotGeneration).toEqual(1);

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
		expect(first.nodes.find((node) => node.id === id)?.x).toEqual(100);
		expect(first.nodes.find((node) => node.id === id)?.isLineageKnot).toEqual(true);
		expect(second.nodes.find((node) => node.id === id)?.x).toEqual(100);
	}
	expect(data.stashItemIds).toEqual([]);
});

test("Work links project to one visible Occurrence while neighborhood includes every mirror", () => {
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

	expect(edge?.source.id).toEqual(source.id);
	expect(edge?.target.id).toEqual(target.id);
	expect(buildDirectNeighborSet(data, target.id)).toEqual(
		new Set([target.id, source.id, mirror.id]),
	);
});

test("moving an Occurrence does not change projected semantic link endpoints", () => {
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
	const before = calculateTreeLayout(data, options).edges.map(
		(edge) =>
			`${edge.type}:${edge.source.item.workId}:${edge.source.id}->${edge.target.item.workId}:${edge.target.id}`,
	);

	// This changes only the occurrence hierarchy, as OutlineService.moveItem does.
	source.parentId = container.id;
	sourceMirror.parentId = null;
	const after = calculateTreeLayout(
		{ ...data, items: [target, source, container, sourceMirror] },
		options,
	).edges.map(
		(edge) =>
			`${edge.type}:${edge.source.item.workId}:${edge.source.id}->${edge.target.item.workId}:${edge.target.id}`,
	);

	expect(before).toEqual([
		"RELATED:source-work:source-primary->target-work:target",
		"FROM:target-work:target->source-work:source-primary",
	]);
	expect(after).toEqual(before);
});

test("cluster ids derive from sorted item ids and survive panning and reordering", () => {
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
		camera: { k: 0.4, x: 0, y: 0 },
	};
	const first = calculateTreeLayout(data, options);
	const panned = calculateTreeLayout(data, {
		...options,
		camera: { k: 0.4, x: 123, y: -77 },
	});
	const reordered = calculateTreeLayout({ ...data, items: [...data.items].reverse() }, options);
	const clusterOf = (layout: ReturnType<typeof calculateTreeLayout>): string | undefined =>
		layout.nodes.find((node) => node.aggregate)?.id;

	expect(clusterOf(first), "the zoomed-out items should form a cluster").toBeTruthy();
	expect(clusterOf(first)).toEqual(clusterOf(panned));
	expect(clusterOf(first)).toEqual(clusterOf(reordered));
});

test("cluster nodes expose their constituent item ids and world-space bounds", () => {
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
		camera: { k: 0.4, x: 0, y: 0 },
	});
	const cluster = layout.nodes.find((node) => node.aggregate);
	if (!cluster) throw new Error("expected an aggregate cluster");
	expect(cluster.itemIds).toEqual(["n1", "n2", "n3", "n4"]);
	if (!cluster.bounds) throw new Error("expected cluster bounds");
	expect(cluster.bounds.minX).toEqual(50);
	expect(cluster.bounds.maxX).toEqual(50);
	expect(cluster.bounds.minY).toEqual(60);
	expect(cluster.bounds.maxY).toEqual(192);
});

test("world coordinates stay fixed while the camera moves nodes on screen", () => {
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
	expect(base.lod).toEqual("detail");
	for (const node of base.nodes) {
		expect(node.x).toEqual(node.worldX * 2 + 50);
		expect(node.y).toEqual(node.worldY * 2 - 20);
	}

	const unzoomed = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projectX: (timestamp) => timestamp / 1000,
	});
	for (const node of unzoomed.nodes) {
		expect(node.x).toEqual(node.worldX);
		expect(node.y).toEqual(node.worldY);
	}
	const shared = new Map(base.nodes.map((node) => [node.id, node]));
	for (const node of unzoomed.nodes) {
		expect(node.worldX).toEqual(shared.get(node.id)?.worldX);
		expect(node.worldY).toEqual(shared.get(node.id)?.worldY);
	}
});

test("same-generation items are ordered by FROM component then orderKey and id", () => {
	const data = snapshot([
		item("b", "2026-01-01T00:00:00.000Z", null, "component-a"),
		item("a", "2026-01-01T00:00:00.000Z", null, "component-a"),
		item("d", "2026-01-01T00:00:00.000Z", null, "component-b"),
		item("c", "2026-01-01T00:00:00.000Z", null, "component-b"),
	]);
	data.links.push(link("a", "b", "FROM"), link("c", "d", "FROM"));
	// Component {a,b} has the smallest orderKey (a=1, b=2) so it is placed first.
	const layout = calculateTreeLayout(data, {
		width: 600,
		height: 300,
		projectX: () => 280,
	});
	expect(layout.lod).toEqual("detail");
	expect(layout.nodes.map((node) => node.id)).toEqual(["a", "b", "c", "d"]);
	expect(layout.nodes.map((node) => node.lane)).toEqual([0, 1, 2, 3]);
});

test("buildLaneOrder keeps unlinked items in stable orderKey sequence", () => {
	const data = snapshot([
		item("z", "2026-01-01T00:00:00.000Z"),
		item("a", "2026-01-01T00:00:00.000Z"),
	]);
	const order = buildLaneOrder(data);
	expect(order.get("a")).toEqual(0);
	expect(order.get("z")).toEqual(1);
});

test("P6 characterization: camera pan preserves world geometry and lane assignment", () => {
	const data = snapshot([
		item("n1", "2026-01-01T00:00:00.000Z"),
		item("n2", "2026-01-02T00:00:00.000Z", "n1"),
		item("n3", "2026-01-03T00:00:00.000Z", "n1"),
	]);
	data.links.push(link("n1", "n2", "FROM"));
	const options = {
		width: 600,
		height: 400,
		projection: "lineage" as const,
		projectX: (t: number) => t / 1000,
		projectGeneration: (g: number) => g * 100 + 50,
	};
	const first = calculateTreeLayout(data, { ...options, camera: { k: 1, x: 100, y: 50 } });
	const second = calculateTreeLayout(data, { ...options, camera: { k: 1, x: -200, y: 300 } });
	expect(first.nodes.map((n) => [n.id, n.worldX, n.worldY, n.lane])).toEqual(
		second.nodes.map((n) => [n.id, n.worldX, n.worldY, n.lane]),
	);
	expect(first.nodes.map((n) => [n.x - 300, n.y + 250])).toEqual(
		second.nodes.map((n) => [n.x, n.y]),
	);
	expect(first.edges.map((e) => e.id)).toEqual(second.edges.map((e) => e.id));
});

test("P6 characterization: Lineage generations are independent of item and link order", () => {
	const data = snapshot(
		Array.from({ length: 120 }, (_, i) =>
			item(`n${i}`, "2026-01-01T00:00:00.000Z", i ? `n${i - 1}` : null),
		),
	);
	for (let i = 1; i < 120; i++) data.links.push(link(`n${i}`, `n${i - 1}`, "FROM"));
	const expected = calculateLineageProjection(data);
	const reversed = calculateLineageProjection({
		...data,
		items: [...data.items].reverse(),
		links: [...data.links].reverse(),
	});
	expect(expected.maxGeneration).toEqual(119);
	expect(reversed.generationByWorkId).toEqual(expected.generationByWorkId);
	expect(reversed.knotWorkIds).toEqual(expected.knotWorkIds);
	expect(buildLaneOrder({ ...data, items: [...data.items].reverse() })).toEqual(
		buildLaneOrder(data),
	);
});

test("P6 graph traversal handles a 6,000-node FROM chain without recursion", () => {
	const count = 6000;
	const data = snapshot(
		Array.from({ length: count }, (_, i) =>
			item(`w-${i}`, "2026-01-01T00:00:00.000Z", i > 0 ? `w-${i - 1}` : null),
		),
	);
	for (let i = 1; i < count; i++) data.links.push(link(`w-${i}`, `w-${i - 1}`, "FROM"));
	expect(buildLaneOrder(data).size).toEqual(count);
	expect(calculateLineageProjection(data).maxGeneration).toEqual(count - 1);
});

test("P6b: calculateTreeLayout handles dense simultaneous hub nodes without quadratic blowup", () => {
	const count = 2000;
	const items = Array.from({ length: count }, (_, i) =>
		item(`hub-${i}`, "2026-01-01T00:00:00.000Z", i > 0 ? "hub-0" : null),
	);
	const data = snapshot(items);
	for (let i = 1; i < count; i++) {
		data.links.push(link("hub-0", `hub-${i}`, "FROM"));
	}

	const start = performance.now();
	const layout = calculateTreeLayout(data, {
		width: 800,
		height: 600,
		projection: "chronology",
		projectX: () => 100, // all at same timestamp X
		camera: { k: 0.01, x: 0, y: 0 }, // zoomed out so all 2,000 nodes fall into the same screen cell bucket
	});
	const elapsed = performance.now() - start;

	expect(layout.lod).toEqual("overview");
	expect(layout.nodes.length).toEqual(1);
	expect(layout.nodes[0].count).toEqual(count);
	expect(elapsed < 2000, `Expected < 2000ms, got ${elapsed}ms`).toEqual(true);
});

test("calculateTreeWorldLayout separates world layout from camera pan", () => {
	const data = snapshot([
		item("n1", "2026-01-01T00:00:00.000Z"),
		item("n2", "2026-01-02T00:00:00.000Z", "n1"),
		item("n3", "2026-01-03T00:00:00.000Z", "n1"),
	]);
	data.links.push(link("n1", "n2", "FROM"));

	const worldLayout = calculateTreeWorldLayout(data, {
		height: 400,
		projection: "lineage",
		projectX: (t: number) => t / 1000,
		projectGeneration: (g: number) => g * 100 + 50,
		zoom: 1,
	});

	expect(worldLayout.nodes.length).toEqual(3);

	// Pan 1
	const screen1 = applyTreeCamera(worldLayout, { k: 1, x: 100, y: 50 });
	expect(screen1.nodes.map((n) => n.x)).toEqual(worldLayout.nodes.map((n) => n.worldX + 100));
	expect(screen1.nodes.map((n) => n.y)).toEqual(worldLayout.nodes.map((n) => n.worldY + 50));

	// Pan 2 (pure pan does not recompute lanes or generations)
	const screen2 = applyTreeCamera(worldLayout, { k: 1, x: -200, y: 300 });
	expect(screen2.nodes.map((n) => n.x)).toEqual(worldLayout.nodes.map((n) => n.worldX - 200));
	expect(screen2.nodes.map((n) => n.y)).toEqual(worldLayout.nodes.map((n) => n.worldY + 300));

	// All world positions match exactly
	expect(screen1.nodes.map((n) => n.worldX)).toEqual(screen2.nodes.map((n) => n.worldX));
	expect(screen1.nodes.map((n) => n.worldY)).toEqual(screen2.nodes.map((n) => n.worldY));
	expect(screen1.nodes.map((n) => n.lane)).toEqual(screen2.nodes.map((n) => n.lane));

	// Backward-compatible calculateTreeLayout produces matching screen coordinates
	const fullLayout = calculateTreeLayout(data, {
		width: 600,
		height: 400,
		projection: "lineage",
		projectX: (t: number) => t / 1000,
		projectGeneration: (g: number) => g * 100 + 50,
		camera: { k: 1, x: 100, y: 50 },
	});
	expect(fullLayout.nodes.map((n) => n.x)).toEqual(screen1.nodes.map((n) => n.x));
	expect(fullLayout.nodes.map((n) => n.y)).toEqual(screen1.nodes.map((n) => n.y));
});

test("P6b: calculateTreeWorldLayout handles deep 6,000-node FROM chain without stack overflow", () => {
	const count = 6000;
	const items = Array.from({ length: count }, (_, i) =>
		item(`w-${i}`, "2026-01-01T00:00:00.000Z", i > 0 ? `w-${i - 1}` : null),
	);
	const data = snapshot(items);
	for (let i = 0; i < count - 1; i++) {
		data.links.push(link(`w-${i}`, `w-${i + 1}`, "FROM"));
	}

	const worldLayout = calculateTreeWorldLayout(data, {
		height: 600,
		projection: "lineage",
		projectX: () => 0,
		projectGeneration: (g: number) => g * 80,
		zoom: 1,
	});
	expect(worldLayout.nodes.length).toEqual(count);
	expect(worldLayout.lineage?.maxGeneration).toEqual(count - 1);
});
