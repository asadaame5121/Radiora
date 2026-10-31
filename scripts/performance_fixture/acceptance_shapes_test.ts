// biome-ignore-all lint/style/noMagicNumbers: Expected indices and sizes are the shape algorithm oracle.
import { assertEquals } from "jsr:@std/assert@1";
import {
	ACCEPTANCE_SHAPES,
	type AcceptanceShape,
	applyAcceptanceShape,
	computeShapeLayout,
} from "./acceptance_shapes.ts";
import { createPerformanceFixture } from "./generator.ts";

Deno.test("computeShapeLayout produces expected parent indices for N=1", () => {
	assertEquals(computeShapeLayout(1, "all-roots"), {
		shape: "all-roots",
		parentIndices: [null],
		rootCount: 1,
		maximumDepth: 0,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(1, "wide"), {
		shape: "wide",
		parentIndices: [null],
		rootCount: 1,
		maximumDepth: 0,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(1, "balanced"), {
		shape: "balanced",
		parentIndices: [null],
		rootCount: 1,
		maximumDepth: 0,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(1, "deep-chain"), {
		shape: "deep-chain",
		parentIndices: [null],
		rootCount: 1,
		maximumDepth: 0,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(1, "deep-cycle"), {
		shape: "deep-cycle",
		parentIndices: [0],
		rootCount: 0,
		maximumDepth: null,
		cycleSize: 1,
	});
});

Deno.test("computeShapeLayout produces expected parent indices for N=2", () => {
	assertEquals(computeShapeLayout(2, "all-roots"), {
		shape: "all-roots",
		parentIndices: [null, null],
		rootCount: 2,
		maximumDepth: 0,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(2, "wide"), {
		shape: "wide",
		parentIndices: [null, 0],
		rootCount: 1,
		maximumDepth: 1,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(2, "balanced"), {
		shape: "balanced",
		parentIndices: [null, 0],
		rootCount: 1,
		maximumDepth: 1,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(2, "deep-chain"), {
		shape: "deep-chain",
		parentIndices: [null, 0],
		rootCount: 1,
		maximumDepth: 1,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(2, "deep-cycle"), {
		shape: "deep-cycle",
		parentIndices: [1, 0],
		rootCount: 0,
		maximumDepth: null,
		cycleSize: 2,
	});
});

Deno.test("computeShapeLayout produces expected parent indices for N=8", () => {
	assertEquals(computeShapeLayout(8, "all-roots"), {
		shape: "all-roots",
		parentIndices: [null, null, null, null, null, null, null, null],
		rootCount: 8,
		maximumDepth: 0,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(8, "wide"), {
		shape: "wide",
		parentIndices: [null, 0, 0, 0, 0, 0, 0, 0],
		rootCount: 1,
		maximumDepth: 1,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(8, "balanced"), {
		shape: "balanced",
		parentIndices: [null, 0, 0, 0, 0, 1, 1, 1],
		rootCount: 1,
		maximumDepth: 2,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(8, "deep-chain"), {
		shape: "deep-chain",
		parentIndices: [null, 0, 1, 2, 3, 4, 5, 6],
		rootCount: 1,
		maximumDepth: 7,
		cycleSize: null,
	});
	assertEquals(computeShapeLayout(8, "deep-cycle"), {
		shape: "deep-cycle",
		parentIndices: [7, 0, 1, 2, 3, 4, 5, 6],
		rootCount: 0,
		maximumDepth: null,
		cycleSize: 8,
	});
});

Deno.test("computeShapeLayout scales linearly to N=10,000 without stack overflow or n^2 traversal", () => {
	const n = 10_000;
	const chain = computeShapeLayout(n, "deep-chain");
	assertEquals(chain.parentIndices.length, n);
	assertEquals(chain.parentIndices[0], null);
	assertEquals(chain.parentIndices[n - 1], n - 2);
	assertEquals(chain.maximumDepth, n - 1);
	assertEquals(chain.rootCount, 1);
	assertEquals(chain.cycleSize, null);

	const cycle = computeShapeLayout(n, "deep-cycle");
	assertEquals(cycle.parentIndices.length, n);
	assertEquals(cycle.parentIndices[0], n - 1);
	assertEquals(cycle.parentIndices[n - 1], n - 2);
	assertEquals(cycle.maximumDepth, null);
	assertEquals(cycle.rootCount, 0);
	assertEquals(cycle.cycleSize, n);

	const wide = computeShapeLayout(n, "wide");
	assertEquals(wide.parentIndices[0], null);
	assertEquals(wide.parentIndices[n - 1], 0);
	assertEquals(wide.maximumDepth, 1);
	assertEquals(wide.rootCount, 1);

	const roots = computeShapeLayout(n, "all-roots");
	assertEquals(roots.rootCount, n);
	assertEquals(roots.maximumDepth, 0);

	const balanced = computeShapeLayout(n, "balanced");
	assertEquals(balanced.rootCount, 1);
	assertEquals(balanced.parentIndices[n - 1], Math.floor((n - 2) / 4));
});

Deno.test("applyAcceptanceShape preserves IDs, works, text, links and updates parentOccurrenceId/orderKey", () => {
	const baseline = createPerformanceFixture({ profile: "baseline", topicCount: 1_000, seed: 42 });
	const originalOccurrences = baseline.state.occurrences;

	for (const shape of ACCEPTANCE_SHAPES) {
		const result = applyAcceptanceShape(baseline.state, shape);

		// Non-occurrence state is identical by reference
		assertEquals(result.state.works, baseline.state.works);
		assertEquals(result.state.branches, baseline.state.branches);
		assertEquals(result.state.workingCopies, baseline.state.workingCopies);
		assertEquals(result.state.links, baseline.state.links);

		// Occurrences count matches
		assertEquals(result.state.occurrences.length, originalOccurrences.length);

		// IDs and workIds are preserved
		for (let i = 0; i < originalOccurrences.length; i++) {
			assertEquals(result.state.occurrences[i].id, originalOccurrences[i].id);
			assertEquals(result.state.occurrences[i].workId, originalOccurrences[i].workId);
			assertEquals(
				result.state.occurrences[i].revisionSelector,
				originalOccurrences[i].revisionSelector,
			);
		}

		if (shape === "all-roots") {
			assertEquals(result.metadata.rootCount, 1_000);
			assertEquals(result.metadata.maximumDepth, 0);
			for (let i = 0; i < result.state.occurrences.length; i++) {
				assertEquals(result.state.occurrences[i].parentOccurrenceId, null);
				assertEquals(result.state.occurrences[i].orderKey, (i + 1) * 1024);
			}
		} else if (shape === "deep-chain") {
			assertEquals(result.metadata.rootCount, 1);
			assertEquals(result.metadata.maximumDepth, 999);
			assertEquals(result.state.occurrences[0].parentOccurrenceId, null);
			assertEquals(result.state.occurrences[1].parentOccurrenceId, result.state.occurrences[0].id);
			assertEquals(
				result.state.occurrences[999].parentOccurrenceId,
				result.state.occurrences[998].id,
			);
		} else if (shape === "deep-cycle") {
			assertEquals(result.metadata.rootCount, 0);
			assertEquals(result.metadata.maximumDepth, null);
			assertEquals(result.metadata.cycleSize, 1_000);
			assertEquals(
				result.state.occurrences[0].parentOccurrenceId,
				result.state.occurrences[999].id,
			);
		}
	}
});
