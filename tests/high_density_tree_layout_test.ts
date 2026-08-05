import { assert, assertEquals, assertLess } from "jsr:@std/assert@1";
import { LINK_TYPES } from "../src/domain/models.ts";
import { BranchService } from "../src/services/branch_service.ts";
import { calculateTreeLayout } from "../src/ui/tree_layout.ts";
import {
	createHighDensityGraphFixture,
	HIGH_DENSITY_WORK_COUNT,
} from "./support/high_density_graph_fixture.ts";

Deno.test("high-density lineage layout stays within its performance budget", async () => {
	const fixture = await createHighDensityGraphFixture();
	const branches = new BranchService(fixture.store);
	const projection = await branches.listGlobalLineage({
		includeIsolated: true,
		linkTypes: [...LINK_TYPES],
		includeWorkIds: [],
	});
	assertEquals(projection.totalWorkCount, HIGH_DENSITY_WORK_COUNT);

	const started = performance.now();
	const layout = calculateTreeLayout(projection.snapshot, {
		width: 1400,
		height: 800,
		projection: "chronology",
		projectX: (timestamp) => timestamp / 1000,
		camera: { k: .5, x: 0, y: 0 },
	});
	const elapsedMs = performance.now() - started;

	assertLess(elapsedMs, 1_500, `layout took ${elapsedMs.toFixed(1)}ms`);
	assert(layout.nodes.some((node) => node.aggregate), "dense content is collapsed");
	assert(
		layout.nodes.reduce((total, node) => total + node.count, 0) === HIGH_DENSITY_WORK_COUNT,
		"every Work is represented exactly once",
	);
});

Deno.test("Lineage and Chronology share the same high-density cluster behavior", async () => {
	const fixture = await createHighDensityGraphFixture();
	const branches = new BranchService(fixture.store);
	const projection = await branches.listGlobalLineage({
		includeIsolated: false,
		linkTypes: ["RELATED"],
		includeWorkIds: [],
	});
	const options = {
		width: 1400,
		height: 800,
		projectX: (timestamp: number) => timestamp / 1000,
		projectGeneration: (generation: number) => generation * 160,
		camera: { k: .5, x: 0, y: 0 },
	};
	const chronology = calculateTreeLayout(projection.snapshot, {
		...options,
		projection: "chronology" as const,
	});
	const lineage = calculateTreeLayout(projection.snapshot, {
		...options,
		projection: "lineage" as const,
	});
	for (const layout of [chronology, lineage]) {
		const clusterIds = layout.nodes
			.filter((node) => node.aggregate)
			.map((node) => node.id);
		assert(clusterIds.length > 0, "both projections collapse dense content");
		assert(new Set(clusterIds).size === clusterIds.length, "cluster ids are unique");
		for (const cluster of layout.nodes.filter((node) => node.aggregate)) {
			assert(cluster.bounds, "clusters carry world bounds");
		}
	}
});
