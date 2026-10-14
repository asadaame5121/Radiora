import type { OutlineSnapshot, RelationTypeDefinition } from "../domain/models.ts";
import { isRelationTypeAdvancesGeneration } from "../domain/relation_type.ts";
import { findCyclicWorkIds } from "./tree_lineage_cycles.ts";

export interface LineageProjection {
	generationByWorkId: Map<string, number>;
	knotWorkIds: Set<string>;
	maxGeneration: number;
	knotGeneration: number | null;
}

type WorkGraph = Map<string, Set<string>>;

/** Generation advances along visible asserted links; cyclic Works occupy Knot. */
export function calculateLineageProjection(
	snapshot: OutlineSnapshot,
	relationTypeDefinitions?: readonly RelationTypeDefinition[],
): LineageProjection {
	const workIds = [...new Set(snapshot.items.map((item) => item.workId))].sort();
	const { children, parents } = generationGraph(snapshot, workIds, relationTypeDefinitions);
	const knotWorkIds = findCyclicWorkIds(workIds, children);
	const generationByWorkId = acyclicGenerations(workIds, children, parents, knotWorkIds);
	const maxGeneration = Math.max(0, ...generationByWorkId.values());
	return {
		generationByWorkId,
		knotWorkIds,
		maxGeneration,
		knotGeneration: knotWorkIds.size > 0 ? maxGeneration + 1 : null,
	};
}

function generationGraph(
	snapshot: OutlineSnapshot,
	workIds: string[],
	definitions?: readonly RelationTypeDefinition[],
): { children: WorkGraph; parents: WorkGraph } {
	const visible = new Set(workIds);
	const children = new Map(workIds.map((id) => [id, new Set<string>()]));
	const parents = new Map(workIds.map((id) => [id, new Set<string>()]));
	for (const link of snapshot.links) {
		if (
			!isRelationTypeAdvancesGeneration(link.type, definitions) ||
			!visible.has(link.fromId) || !visible.has(link.toId)
		) continue;
		children.get(link.fromId)?.add(link.toId);
		parents.get(link.toId)?.add(link.fromId);
	}
	return { children, parents };
}

function acyclicGenerations(
	workIds: string[],
	children: WorkGraph,
	parents: WorkGraph,
	knots: Set<string>,
): Map<string, number> {
	const generations = new Map<string, number>();
	const indegree = new Map<string, number>();
	const ready: string[] = [];
	for (const id of workIds) {
		if (knots.has(id)) continue;
		let degree = 0;
		for (const parent of parents.get(id) ?? []) {
			if (!knots.has(parent)) degree++;
		}
		indegree.set(id, degree);
		generations.set(id, 0);
		if (degree === 0) {
			ready.push(id);
		}
	}
	let head = 0;
	while (head < ready.length) {
		const parent = ready[head++];
		advanceChildren(parent, children, knots, { generations, indegree, ready });
	}
	return generations;
}

function advanceChildren(
	parent: string,
	children: WorkGraph,
	knots: Set<string>,
	state: { generations: Map<string, number>; indegree: Map<string, number>; ready: string[] },
): void {
	const { generations, indegree, ready } = state;
	const parentGen = generations.get(parent) ?? 0;
	for (const child of children.get(parent) ?? []) {
		if (knots.has(child)) continue;
		const currentGen = generations.get(child) ?? 0;
		if (parentGen + 1 > currentGen) {
			generations.set(child, parentGen + 1);
		}
		const nextDegree = (indegree.get(child) ?? 0) - 1;
		indegree.set(child, nextDegree);
		if (nextDegree === 0) {
			ready.push(child);
		}
	}
}
