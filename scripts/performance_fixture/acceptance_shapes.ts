export type AcceptanceShape = "deep-chain" | "deep-cycle" | "balanced";

const BALANCED_CHILDREN = 4;

/** Deterministic topology for stack-safety and linear-traversal acceptance tests. */
export function computeShapeLayout(nodeCount: number, shape: AcceptanceShape) {
	if (!Number.isSafeInteger(nodeCount) || nodeCount <= 0) {
		throw new Error("nodeCount must be a positive safe integer");
	}
	const parentIndices: Array<number | null> = [];
	const depths: number[] = [];
	for (let index = 0; index < nodeCount; index++) {
		const parent = index === 0
			? null
			: shape === "balanced"
			? Math.floor((index - 1) / BALANCED_CHILDREN)
			: index - 1;
		parentIndices.push(parent);
		depths.push(parent === null ? 0 : depths[parent] + 1);
	}
	if (shape === "deep-cycle") parentIndices[0] = nodeCount - 1;
	return {
		parentIndices,
		maximumDepth: shape === "deep-cycle" ? null : depths[nodeCount - 1],
		rootCount: shape === "deep-cycle" ? 0 : 1,
		cycleSize: shape === "deep-cycle" ? nodeCount : 0,
	};
}
