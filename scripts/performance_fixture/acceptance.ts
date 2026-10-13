import { MemoryStateContainer } from "../../src/storage/memory_state_container.ts";
import { type AcceptanceShape, computeShapeLayout } from "./acceptance_shapes.ts";
import { parseSeed } from "./model.ts";

const ACCEPTANCE_TIME = "2026-01-01T00:00:00.000Z";
const ORDER_STEP = 1024;

export function createAcceptanceFixture(input: {
	seed: number;
	nodeCount: number;
	shape: AcceptanceShape;
}) {
	const seed = parseSeed(input.seed);
	const layout = computeShapeLayout(input.nodeCount, input.shape);
	const state = new MemoryStateContainer().capture();
	const id = (kind: string, index: number) => `${seed}-${kind}-${index}`;
	for (let index = 0; index < input.nodeCount; index++) {
		const workId = id("work", index);
		const branchId = id("branch", index);
		state.works.push({ id: workId, createdAt: ACCEPTANCE_TIME, updatedAt: ACCEPTANCE_TIME });
		state.branches.push({
			id: branchId,
			workId,
			name: "main",
			headRevisionId: null,
			createdAt: ACCEPTANCE_TIME,
		});
		state.workingCopies.push({
			branchId,
			workId,
			text: `Topic ${index}`,
			updatedAt: ACCEPTANCE_TIME,
		});
		const parentIndex = layout.parentIndices[index];
		state.occurrences.push({
			id: id("occurrence", index),
			workId,
			parentOccurrenceId: parentIndex === null ? null : id("occurrence", parentIndex),
			orderKey: (index + 1) * ORDER_STEP,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId },
		});
	}
	return { state, layout };
}
