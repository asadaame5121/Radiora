import type { Occurrence } from "../../src/domain/models.ts";
import type { GraphStateSnapshot } from "../../src/storage/graph_store.ts";

const ORDER_KEY_SPACING = 1024;
const BALANCED_BRANCHING_FACTOR = 4;

export const ACCEPTANCE_SHAPES = [
	"all-roots",
	"wide",
	"balanced",
	"deep-chain",
	"deep-cycle",
] as const;

export type AcceptanceShape = (typeof ACCEPTANCE_SHAPES)[number];

export interface ShapeLayoutMetadata {
	shape: AcceptanceShape;
	rootCount: number;
	maximumDepth: number | null;
	cycleSize: number | null;
}

export interface ShapeLayoutResult extends ShapeLayoutMetadata {
	parentIndices: Array<number | null>;
}

export function computeShapeLayout(nodeCount: number, shape: AcceptanceShape): ShapeLayoutResult {
	if (nodeCount <= 0) return emptyShapeLayout(shape);
	if (shape === "all-roots") return allRootsLayout(nodeCount);
	if (shape === "wide") return wideLayout(nodeCount);
	if (shape === "balanced") return balancedLayout(nodeCount);
	if (shape === "deep-chain") return deepChainLayout(nodeCount);
	if (shape === "deep-cycle") return deepCycleLayout(nodeCount);
	throw new Error(`Unknown acceptance shape: ${String(shape)}`);
}

function emptyShapeLayout(shape: AcceptanceShape): ShapeLayoutResult {
	return {
		shape,
		parentIndices: [],
		rootCount: 0,
		maximumDepth: 0,
		cycleSize: null,
	};
}

function allRootsLayout(nodeCount: number): ShapeLayoutResult {
	return {
		shape: "all-roots",
		parentIndices: Array(nodeCount).fill(null),
		rootCount: nodeCount,
		maximumDepth: 0,
		cycleSize: null,
	};
}

function wideLayout(nodeCount: number): ShapeLayoutResult {
	const parentIndices: Array<number | null> = Array(nodeCount).fill(0);
	parentIndices[0] = null;
	return {
		shape: "wide",
		parentIndices,
		rootCount: 1,
		maximumDepth: nodeCount > 1 ? 1 : 0,
		cycleSize: null,
	};
}

function balancedLayout(nodeCount: number): ShapeLayoutResult {
	const parentIndices: Array<number | null> = Array(nodeCount).fill(null);
	const depths = new Int32Array(nodeCount);
	let maximumDepth = 0;
	for (let index = 1; index < nodeCount; index++) {
		const parent = Math.floor((index - 1) / BALANCED_BRANCHING_FACTOR);
		parentIndices[index] = parent;
		const depth = depths[parent] + 1;
		depths[index] = depth;
		maximumDepth = Math.max(maximumDepth, depth);
	}
	return {
		shape: "balanced",
		parentIndices,
		rootCount: 1,
		maximumDepth,
		cycleSize: null,
	};
}

function deepChainLayout(nodeCount: number): ShapeLayoutResult {
	const parentIndices: Array<number | null> = Array(nodeCount).fill(null);
	for (let index = 1; index < nodeCount; index++) parentIndices[index] = index - 1;
	return {
		shape: "deep-chain",
		parentIndices,
		rootCount: 1,
		maximumDepth: nodeCount - 1,
		cycleSize: null,
	};
}

function deepCycleLayout(nodeCount: number): ShapeLayoutResult {
	const { parentIndices } = deepChainLayout(nodeCount);
	parentIndices[0] = nodeCount - 1;
	return {
		shape: "deep-cycle",
		parentIndices,
		rootCount: 0,
		maximumDepth: null,
		cycleSize: nodeCount,
	};
}

export function applyAcceptanceShape(
	state: GraphStateSnapshot,
	shape: AcceptanceShape,
): { state: GraphStateSnapshot; metadata: ShapeLayoutMetadata } {
	const nodeCount = state.occurrences.length;
	const layout = computeShapeLayout(nodeCount, shape);
	const nextOrder = new Map<string | null, number>();

	const occurrences: Occurrence[] = state.occurrences.map((occurrence, index) => {
		const parentIndex = layout.parentIndices[index];
		const parentOccurrenceId = parentIndex === null ? null : state.occurrences[parentIndex].id;
		const order = (nextOrder.get(parentOccurrenceId) ?? 0) + 1;
		nextOrder.set(parentOccurrenceId, order);
		const orderKey = order * ORDER_KEY_SPACING;

		return {
			...occurrence,
			parentOccurrenceId,
			orderKey,
		};
	});

	const { parentIndices: _, ...metadata } = layout;

	return {
		state: {
			...state,
			occurrences,
		},
		metadata,
	};
}
