import { assert, assertEquals, assertLessOrEqual } from "jsr:@std/assert@1";
import type { OutlineItem } from "../src/domain/models.ts";
import { aggregateScreenCells } from "../src/ui/tree_spatial_aggregation.ts";
import {
	lodForScreenCollisions,
	type RawEdge,
	type TreeLayoutNode,
} from "../src/ui/tree_layout.ts";

function node(id: string, x: number, y: number, order: number): TreeLayoutNode {
	const timestamp = new Date(Date.UTC(2026, 0, order)).toISOString();
	const item: OutlineItem = {
		id,
		workId: id,
		text: id,
		parentId: null,
		orderKey: order,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: id },
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	return {
		id,
		item,
		itemIds: [id],
		x,
		y,
		worldX: x,
		worldY: y,
		lane: order % 5,
		label: id,
		labelLines: [id],
		labelWidth: id.length * 8,
		radius: 4,
		count: 1,
		aggregate: false,
		isKnot: order % 7 === 0,
		isLineageKnot: order % 11 === 0,
	};
}

function collides(a: TreeLayoutNode, b: TreeLayoutNode): boolean {
	return Math.abs(a.x - b.x) < 48 && Math.abs(a.y - b.y) < 36;
}

function connectOraclePairs(
	nodes: readonly TreeLayoutNode[],
	neighbors: Map<string, Set<string>>,
): void {
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			if (!collides(nodes[i], nodes[j])) continue;
			neighbors.get(nodes[i].id)?.add(nodes[j].id);
			neighbors.get(nodes[j].id)?.add(nodes[i].id);
		}
	}
}

function oracleComponent(
	startId: string,
	neighbors: ReadonlyMap<string, Set<string>>,
	visited: Set<string>,
): string[] {
	const pending = [startId];
	const component: string[] = [];
	while (pending.length) {
		const id = pending.pop();
		if (id === undefined || visited.has(id)) continue;
		visited.add(id);
		component.push(id);
		pending.push(...(neighbors.get(id) ?? []));
	}
	return component.sort();
}

function oracleComponents(nodes: readonly TreeLayoutNode[]): string[][] {
	const neighbors = new Map(nodes.map((entry) => [entry.id, new Set<string>()]));
	connectOraclePairs(nodes, neighbors);
	const visited = new Set<string>();
	const components: string[][] = [];
	for (const entry of nodes) {
		if (visited.has(entry.id)) continue;
		components.push(oracleComponent(entry.id, neighbors, visited));
	}
	return components.sort((a, b) => a[0].localeCompare(b[0]));
}

function oracleLod(nodes: readonly TreeLayoutNode[]): "detail" | "context" | "overview" {
	const colliding = new Set<string>();
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			if (!collides(nodes[i], nodes[j])) continue;
			colliding.add(nodes[i].id);
			colliding.add(nodes[j].id);
		}
	}
	const fraction = colliding.size / nodes.length;
	return fraction >= 0.5 ? "overview" : fraction > 0 ? "context" : "detail";
}

function assertMatchesOracle(nodes: TreeLayoutNode[], edges: RawEdge[] = []): void {
	const expected = oracleComponents(nodes);
	assertEquals(lodForScreenCollisions(nodes), oracleLod(nodes));
	const actual = aggregateScreenCells(nodes, edges, "overview", 240);
	const groups = actual.nodes
		.map((entry) => [...entry.itemIds].sort())
		.sort((a, b) => a[0].localeCompare(b[0]));
	assertEquals(groups, expected);
	for (const members of expected) {
		const projected = actual.nodes.find(
			(entry) =>
				entry.itemIds.length === members.length &&
				members.every((id) => entry.itemIds.includes(id)),
		);
		assert(projected);
		if (members.length === 1) {
			assertEquals(projected.id, members[0]);
			continue;
		}
		const originals = members.map((id) => {
			const original = nodes.find((entry) => entry.id === id);
			if (!original) throw new Error(`Missing source node ${id}`);
			return original;
		});
		const representative = [...originals]
			.sort((a, b) => a.item.updatedAt.localeCompare(b.item.updatedAt) || a.id.localeCompare(b.id))
			.at(-1);
		if (!representative) throw new Error("Cluster has no representative node");
		assertEquals(projected.id, `cluster:${members.join(":")}`);
		assertEquals(projected.item.id, representative.item.id);
		assertEquals(projected.lane, Math.min(...originals.map((entry) => entry.lane)));
		assertEquals(projected.bounds, {
			minX: Math.min(...originals.map((entry) => entry.worldX)),
			minY: Math.min(...originals.map((entry) => entry.worldY)),
			maxX: Math.max(...originals.map((entry) => entry.worldX)),
			maxY: Math.max(...originals.map((entry) => entry.worldY)),
		});
	}
	const clusterById = new Map(
		actual.nodes.flatMap((entry) => entry.itemIds.map((id) => [id, entry.id] as const)),
	);
	const edgeCounts = new Map<string, number>();
	for (const edge of edges) {
		const source = clusterById.get(edge.sourceId);
		const target = clusterById.get(edge.targetId);
		if (!source || !target || source === target) continue;
		const key = `${source}:${target}:${edge.type}`;
		edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
	}
	assertEquals(
		actual.edges.map((edge) => `${edge.id}:${edge.count}`).sort(),
		[...edgeCounts].map(([id, count]) => `${id}:${count}`).sort(),
	);
}

Deno.test("spatial aggregation matches full-pair collision components at strict boundaries", () => {
	const epsilon = 0.001;
	for (const positions of [
		[[0, 0]],
		Array.from({ length: 8 }, (_, index) => [index * 2, index * 2]),
		[
			[0, 0],
			[48, 0],
		],
		[
			[0, 0],
			[47.999, 0],
			[48, 0],
		],
		[
			[0, 0],
			[0, 36],
		],
		[
			[0, 0],
			[0, 35.999],
			[0, 36],
		],
		[
			[0, 0],
			[48 - epsilon, 36 - epsilon],
			[48, 35],
		],
		[
			[0, 0],
			[48 - epsilon, 36 + epsilon],
			[48, 0],
		],
		[
			[10, 10],
			[10, 10],
			[58, 10],
		],
	]) {
		const nodes = positions.map(([x, y], index) => node(`n${index}`, x, y, index + 1));
		const edges = [
			{ sourceId: "n0", targetId: "n1", type: "RELATED" },
			{ sourceId: "n1", targetId: "n2", type: "RELATED" },
		] satisfies RawEdge[];
		assertMatchesOracle(nodes, edges);
		assertMatchesOracle([...nodes].reverse(), [...edges].reverse());
	}
});

Deno.test("diagonal sweep finds collisions and rejects single-axis contact", () => {
	assertMatchesOracle([node("a", 0, 0, 1), node("b", 48 - 0.01, 36 - 0.01, 2)]);
	assertMatchesOracle([node("a", 0, 0, 1), node("b", 48 - 0.01, 36 + 0.01, 2)]);
	assertMatchesOracle([node("a", 0, 36, 1), node("b", 48 - 0.01, 0, 2)]);
});

Deno.test("pure pan preserves cluster membership while zoom is compared to the oracle", () => {
	const nodes = [
		node("a", 0, 0, 1),
		node("b", 20, 8, 2),
		node("c", 55, 0, 3),
		node("d", 115, 70, 4),
		node("e", 150, 70, 5),
	];
	const original = oracleComponents(nodes);
	assertMatchesOracle(nodes);
	assertMatchesOracle(nodes.map((entry) => ({ ...entry, x: entry.x + 211, y: entry.y - 73 })));
	assertEquals(
		oracleComponents(nodes.map((entry) => ({ ...entry, x: entry.x + 211, y: entry.y - 73 }))),
		original,
	);
	assertMatchesOracle(nodes.map((entry) => ({ ...entry, x: entry.x * 0.5, y: entry.y * 0.5 })));
});

Deno.test("adjacent noncolliding buckets use linear bridge comparisons", () => {
	for (const size of [1000, 2000, 4000]) {
		const nodes = Array.from({ length: size }, (_, index) =>
			node(`n${index}`, index < size / 2 ? 0 : 95, 0, index + 1),
		);
		let checks = 0;
		const result = aggregateScreenCells(nodes, [], "overview", 240, () => checks++);
		assertEquals(result.nodes.filter((entry) => entry.aggregate).length, 2);
		assertLessOrEqual(checks, size * 4);
		let lodChecks = 0;
		assertEquals(
			lodForScreenCollisions(nodes, () => lodChecks++),
			"overview",
		);
		assertLessOrEqual(lodChecks, size * 4);

		const diagonal = Array.from({ length: size }, (_, index) =>
			index < size / 2
				? node(`a${index}`, (index / (size / 2)) * 47.99, 0, index + 1)
				: node(`b${index}`, 48, 71, index + 1),
		);
		let diagonalChecks = 0;
		const diagonalResult = aggregateScreenCells(
			diagonal,
			[],
			"overview",
			240,
			() => diagonalChecks++,
		);
		assertEquals(diagonalResult.nodes.filter((entry) => entry.aggregate).length, 2);
		assertLessOrEqual(diagonalChecks, size * 4);
	}
});
