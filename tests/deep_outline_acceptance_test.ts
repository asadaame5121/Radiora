import { assert, assertEquals } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";
import { OccurrenceOperations } from "../src/services/occurrence_operations.ts";
import { projectBrowsingOutline } from "../src/services/browsing_navigation_state.ts";
import { ManuscriptProjectionService } from "../src/services/manuscript_projection.ts";
import { buildVisibleRows } from "../src/ui/outline_view_model.ts";
import { findCyclicWorkIds } from "../src/ui/tree_lineage_cycles.ts";
import { markRecursivePlacements } from "../src/services/occurrence_knot_detection.ts";
import { computeShapeLayout } from "../scripts/performance_fixture/acceptance_shapes.ts";
import { createAcceptanceFixture } from "../scripts/performance_fixture/acceptance.ts";
import type { OutlineItem } from "../src/domain/models.ts";

Deno.test("Deep 10,000-chain outline: public services execute without stack overflow", async () => {
	const chainFixture = createAcceptanceFixture({
		seed: 42,
		nodeCount: 10_000,
		shape: "deep-chain",
	});

	const store = new MemoryGraphStore();
	await store.restoreGraphState(chainFixture.state);

	const operations = new OccurrenceOperations(store);

	// 1. listOutline executes knot detection and recursive placement marking
	const outline = await operations.listOutline();
	assertEquals(outline.items.length, 10_000);
	assertEquals(outline.knots.length, 0); // Pure chain has no knots
	assertEquals(outline.stashItemIds.length, 0);

	// 2. projectBrowsingOutline with hoisted node
	const hoisted = projectBrowsingOutline(outline, outline.items[5000].id);
	assertEquals(hoisted.rootOccurrenceIds, [outline.items[5000].id]);
	// 5000 descendants (5000..9999 inclusive)
	assertEquals(hoisted.items.length, 5000);
	assertEquals(hoisted.breadcrumb.length, 5000); // 0..4999 ancestors

	// 3. ManuscriptProjectionService projects down the deep chain
	const manuscriptService = new ManuscriptProjectionService(store);
	const sections = await manuscriptService.project(outline.items[0].id);
	assertEquals(sections.length, 10_000);
	assertEquals(sections[0].depth, 0);
	assertEquals(sections[9999].depth, 9999);

	// 4. buildVisibleRows on hoisted projection
	const visibleRows = buildVisibleRows(outline, hoisted, [], false);
	assertEquals(visibleRows.length > 0, true);
});

Deno.test("Deep 10,000-cycle outline: public services handle cycles, stubs and knots cleanly", async () => {
	const cycleFixture = createAcceptanceFixture({
		seed: 42,
		nodeCount: 10_000,
		shape: "deep-cycle",
	});

	const store = new MemoryGraphStore();
	await store.restoreGraphState(cycleFixture.state);

	const operations = new OccurrenceOperations(store);

	// 1. listOutline detects knots and stubs in deep cycle
	const outline = await operations.listOutline();
	assertEquals(outline.items.length, 10_000);
	assertEquals(outline.knots.length, 1);
	assertEquals(outline.knots[0].cycleIds.length, 10_000);
	assertEquals(outline.stashItemIds.length, 10_000);

	// All items in the cycle are marked as reference stub
	for (const item of outline.items) {
		assertEquals(item.referenceStub, true);
	}

	// 2. Tree lineage cycles (Tarjan SCC) handles 10,000-node cycle iteratively
	const childMap = new Map<string, Set<string>>();
	for (let i = 0; i < 10_000; i++) {
		const next = (i + 1) % 10_000;
		childMap.set(`work-${i}`, new Set([`work-${next}`]));
	}
	const workIds = Array.from({ length: 10_000 }, (_, i) => `work-${i}`);
	const cyclicWorkIds = findCyclicWorkIds(workIds, childMap);
	assertEquals(cyclicWorkIds.size, 10_000);
});

Deno.test("100,000-node algorithmic stress test: chain, cycle, and balanced trees execute without stack overflow", () => {
	const n = 100_000;

	// 1. Deep chain (100k nodes)
	const chainLayout = computeShapeLayout(n, "deep-chain");
	assertEquals(chainLayout.maximumDepth, n - 1);
	assertEquals(chainLayout.rootCount, 1);

	// 2. Deep cycle (100k nodes)
	const cycleLayout = computeShapeLayout(n, "deep-cycle");
	assertEquals(cycleLayout.cycleSize, n);
	assertEquals(cycleLayout.rootCount, 0);

	// 3. Balanced 4-ary tree (100k nodes)
	const balancedLayout = computeShapeLayout(n, "balanced");
	assertEquals(balancedLayout.rootCount, 1);
	assert(balancedLayout.maximumDepth !== null);
	assert(balancedLayout.maximumDepth > 8);

	// 4. markRecursivePlacements on 100,000-node deep-chain
	const chainItems: OutlineItem[] = Array.from({ length: n }, (_, i) => ({
		id: `item-${i}`,
		workId: `work-${i}`,
		text: `Topic ${i}`,
		parentId: i === 0 ? null : `item-${i - 1}`,
		orderKey: 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `b-${i}` },
		createdAt: "2020-01-01T00:00:00.000Z",
		updatedAt: "2020-01-01T00:00:00.000Z",
		referenceStub: false,
	}));

	const processedChain = markRecursivePlacements(chainItems);
	assertEquals(processedChain.length, n);
	// No cycles in chain, no reference stubs
	assertEquals(processedChain[0].referenceStub, false);
	assertEquals(processedChain[n - 1].referenceStub, false);

	// 5. Lineage cycles (Tarjan SCC) on 100,000-node graph
	const childMap = new Map<string, Set<string>>();
	for (let i = 0; i < n; i++) {
		const next = (i + 1) % n;
		childMap.set(`w-${i}`, new Set([`w-${next}`]));
	}
	const workIds = Array.from({ length: n }, (_, i) => `w-${i}`);
	const cyclicIds = findCyclicWorkIds(workIds, childMap);
	assertEquals(cyclicIds.size, n);
});
