import fc from "fast-check";
import { expect, test } from "vitest";
import type { OutlineItem, OutlineSnapshot } from "../../../../src/domain/models.ts";
import { applyTreeCamera, calculateTreeWorldLayout } from "../../../../src/ui/tree_layout.ts";
import {
	aggregateTreeAtZoom,
	projectTreeLayout,
	quantizeTreeZoom,
} from "../../../../src/ui/tree_zoom_layout.ts";

test("zoom steps never exceed the actual zoom and stay within one step of it", () => {
	void fc.assert(
		fc.property(fc.double({ min: 0.01, max: 24, noNaN: true }), (zoom) => {
			const step = quantizeTreeZoom(zoom);
			expect(step).toBeLessThanOrEqual(zoom);
			expect(step * 2 ** 0.25).toBeGreaterThan(zoom);
		}),
	);
	for (const exact of [0.25, 0.5, 1, 2 ** 0.25, 2 ** 0.75, 4]) {
		expect(quantizeTreeZoom(exact), `${exact} is its own step`).toBeCloseTo(exact, 12);
	}
});

test("a gesture inside one zoom step keeps the same zoom step", () => {
	const base = quantizeTreeZoom(0.6);
	expect(quantizeTreeZoom(0.6 * 1.05)).toEqual(base);
	expect(quantizeTreeZoom(0.6 * 1.2)).not.toEqual(base);
});

test("projecting an aggregated zoom layout matches applying the camera directly", () => {
	const world = calculateTreeWorldLayout(outline(12), {
		height: 400,
		projection: "chronology",
		projectX: (timestamp) => timestamp / 1_000,
	});
	void fc.assert(
		fc.property(
			fc.constantFrom(0.05, 0.4, 1, 3),
			fc.integer({ min: -800, max: 800 }),
			fc.integer({ min: -800, max: 800 }),
			(k, x, y) => {
				const camera = { k, x, y };
				const direct = applyTreeCamera(world, camera);
				const projected = projectTreeLayout(aggregateTreeAtZoom(world, k), camera);
				expect(projected.lod).toEqual(direct.lod);
				expect(projected.nodes.map((node) => node.itemIds)).toEqual(
					direct.nodes.map((node) => node.itemIds),
				);
				for (const node of projected.nodes) {
					expect(node.x).toBeCloseTo(node.worldX * k + x, 9);
					expect(node.y).toBeCloseTo(node.worldY * k + y, 9);
				}
				expect(projected.edges.map((edge) => edge.id)).toEqual(direct.edges.map((edge) => edge.id));
				const byId = new Map(projected.nodes.map((node) => [node.id, node]));
				for (const edge of projected.edges) {
					expect(edge.source, "edges point at the projected nodes").toBe(byId.get(edge.source.id));
					expect(edge.target).toBe(byId.get(edge.target.id));
				}
			},
		),
	);
});

test("a pan reuses the zoom layout without regrouping clusters", () => {
	const world = calculateTreeWorldLayout(outline(40), {
		height: 400,
		projection: "chronology",
		projectX: () => 50,
	});
	const zoomLayout = aggregateTreeAtZoom(world, 0.4);
	const left = projectTreeLayout(zoomLayout, { k: 0.4, x: -300, y: 20 });
	const right = projectTreeLayout(zoomLayout, { k: 0.4, x: 500, y: -90 });
	expect(left.nodes.some((node) => node.aggregate)).toBe(true);
	expect(left.nodes.map((node) => node.id)).toEqual(right.nodes.map((node) => node.id));
	expect(left.nodes.reduce((total, node) => total + node.count, 0)).toEqual(40);
});

function outline(count: number): OutlineSnapshot {
	const items: OutlineItem[] = Array.from({ length: count }, (_, index) => {
		const id = `item-${String(index).padStart(3, "0")}`;
		return {
			id,
			workId: id,
			text: `項目 ${index}`,
			parentId: index > 0 && index % 3 !== 0 ? `item-${String(index - 1).padStart(3, "0")}` : null,
			orderKey: index,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "branch" },
			createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index * 7)).toISOString(),
			updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index * 7)).toISOString(),
		};
	});
	const links: OutlineSnapshot["links"] = items.slice(1).map((item, index) => ({
		id: `link-${index}`,
		fromId: items[index].workId,
		toId: item.workId,
		from: { scope: "work", workId: items[index].workId },
		to: { scope: "work", workId: item.workId },
		type: "FROM",
		status: "asserted",
		origin: "human",
		createdAt: "2026-01-01T00:00:00.000Z",
	}));
	return { items, links, knots: [], stashItemIds: [] };
}
