import type { Revision } from "../domain/models.ts";

export function assertRevisionDag(revisions: readonly Revision[]): void {
	const parents = new Map(revisions.map((revision) => [revision.id, revision.parentRevisionIds]));
	const visiting = new Map<string, boolean>();
	for (const startId of parents.keys()) {
		if (visiting.has(startId)) continue;
		visitFrom(startId, parents, visiting);
	}
}

function visitFrom(
	startId: string,
	parents: ReadonlyMap<string, readonly string[]>,
	visiting: Map<string, boolean>,
): void {
	visiting.set(startId, true);
	const stack = [{ id: startId, parentIds: parents.get(startId) ?? [], index: 0 }];
	while (stack.length > 0) {
		const f = stack[stack.length - 1];
		if (f.index >= f.parentIds.length) {
			visiting.set(f.id, false);
			stack.pop();
			continue;
		}
		const pId = f.parentIds[f.index++];
		if (visiting.get(pId) === true) throw new Error(`Revision cycle: ${pId}`);
		if (!visiting.has(pId)) {
			visiting.set(pId, true);
			stack.push({ id: pId, parentIds: parents.get(pId) ?? [], index: 0 });
		}
	}
}
