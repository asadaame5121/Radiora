import { beforeAll, expect, test } from "vitest";
import { LINK_TYPES, type OutlineSnapshot } from "../../../src/domain/models.ts";
import { BranchService } from "../../../src/services/branch_service.ts";
import { buildSparseOutline } from "../../../src/services/sparse_outline.ts";
import { calculateTreeLayout, calculateTreeWorldLayout } from "../../../src/ui/tree_layout.ts";
import { aggregateTreeAtZoom, projectTreeLayout } from "../../../src/ui/tree_zoom_layout.ts";
import {
	createHighDensityGraphFixture,
	type HighDensityGraphFixture,
} from "../../../tests/support/high_density_graph_fixture.ts";

// Budgets are medians of serial runs after one warm-up, so one GC pause or a busy
// neighbour process does not fail the gate. Correctness lives in the unit project.
const RUNS = 5;
const FIXTURE_TIMEOUT_MS = 60_000;
const FRAME_BUDGET_MS = 16;

let fixture: HighDensityGraphFixture;
let lineage: OutlineSnapshot;

beforeAll(async () => {
	fixture = await createHighDensityGraphFixture();
	const projection = await new BranchService(fixture.store).listGlobalLineage({
		includeIsolated: true,
		linkTypes: [...LINK_TYPES],
		includeWorkIds: [],
	});
	lineage = projection.snapshot;
}, FIXTURE_TIMEOUT_MS);

function medianMs(run: () => unknown): number {
	run();
	const samples: number[] = [];
	for (let index = 0; index < RUNS; index++) {
		const started = performance.now();
		run();
		samples.push(performance.now() - started);
	}
	samples.sort((left, right) => left - right);
	return samples[Math.floor(RUNS / 2)];
}

test("high-density Tree layout stays within its budget", () => {
	const elapsed = medianMs(() =>
		calculateTreeLayout(lineage, {
			width: 1400,
			height: 800,
			projection: "chronology",
			projectX: (timestamp) => timestamp / 1000,
			camera: { k: 0.5, x: 0, y: 0 },
		}),
	);
	expect(elapsed, `layout median ${elapsed.toFixed(1)}ms`).toBeLessThan(1_500);
});

test("a Tree pan frame only reprojects the zoom layout", () => {
	const zoom = 2;
	const world = calculateTreeWorldLayout(lineage, {
		height: 800,
		projection: "chronology",
		projectX: (timestamp) => timestamp / 1000,
		zoom,
	});
	const zoomLayout = aggregateTreeAtZoom(world, zoom);
	let offset = 0;
	const elapsed = medianMs(() => {
		offset += 7;
		return projectTreeLayout(zoomLayout, { k: zoom, x: offset, y: -offset });
	});
	expect(elapsed, `pan frame median ${elapsed.toFixed(2)}ms`).toBeLessThan(FRAME_BUDGET_MS);
});

test("dense Sparse Outline stays within its budget", () => {
	const { items, links, projectionResults } = fixture;
	const elapsed = medianMs(() => buildSparseOutline(projectionResults, items, links));
	expect(elapsed, `Sparse Outline median ${elapsed.toFixed(1)}ms`).toBeLessThan(2_500);
});

test("2,000 simultaneous hub nodes collapse without quadratic blowup", () => {
	const createdAt = "2026-01-01T00:00:00.000Z";
	const hub: OutlineSnapshot = { items: [], links: [], knots: [], stashItemIds: [] };
	for (let index = 0; index < 2_000; index++) {
		const id = `hub-${index}`;
		hub.items.push({
			id,
			workId: id,
			text: id,
			parentId: index > 0 ? "hub-0" : null,
			orderKey: index + 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: id },
			createdAt,
			updatedAt: createdAt,
		});
		if (index > 0) {
			hub.links.push({
				id: `FROM-hub-0-${id}`,
				fromId: "hub-0",
				toId: id,
				from: { scope: "work", workId: "hub-0" },
				to: { scope: "work", workId: id },
				type: "FROM",
				status: "asserted",
				origin: "human",
				createdAt,
			});
		}
	}
	const elapsed = medianMs(() =>
		calculateTreeLayout(hub, {
			width: 800,
			height: 600,
			projection: "chronology",
			projectX: () => 100,
			camera: { k: 0.01, x: 0, y: 0 },
		}),
	);
	expect(elapsed, `hub layout median ${elapsed.toFixed(1)}ms`).toBeLessThan(2_000);
});
