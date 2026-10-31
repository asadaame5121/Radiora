import { detectOutlineKnots } from "../services/occurrence_knot_detection.ts";
import { InvocationQueue } from "./invocation_queue.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";
import type { MemoryStateContainer } from "./memory_state_container.ts";

export function reconcileOutlineKnots(
	state: Pick<GraphStateSnapshot, "works" | "occurrences" | "knots">,
	restored = false,
): void {
	const activeWorkIds = new Set(
		state.works.filter((work) => !work.deletedAt && !work.mergedIntoWorkId).map((work) => work.id),
	);
	const items = state.occurrences
		.filter((occurrence) => activeWorkIds.has(occurrence.workId))
		.map((occurrence) => ({ id: occurrence.id, parentId: occurrence.parentOccurrenceId }));
	const previousByCycle = new Map(
		state.knots.map((knot) => [JSON.stringify([...knot.cycleIds].sort()), knot]),
	);
	const restoredAt = state.works.reduce(
		(latest, work) => (work.updatedAt > latest ? work.updatedAt : latest),
		"1970-01-01T00:00:00.000Z",
	);
	state.knots = detectOutlineKnots(items, state.knots).map((knot) => {
		const previous = previousByCycle.get(JSON.stringify([...knot.cycleIds].sort()));
		if (previous) return structuredClone(previous);
		return restored ? { ...knot, createdAt: restoredAt } : knot;
	});
}

/** Owns rollback and defers the derived projection until the outer batch succeeds. */
export class MemoryOutlineBatch {
	private readonly queue = new InvocationQueue();
	private dirty = false;

	get isCurrent(): boolean {
		return this.queue.isCurrent;
	}

	structureChanged(reconcile: () => void): void {
		if (this.isCurrent) this.dirty = true;
		else reconcile();
	}

	async run<T>(
		state: MemoryStateContainer,
		operation: () => Promise<T>,
		reconcile: () => void,
	): Promise<T> {
		if (this.isCurrent) return await operation();
		return await this.queue.run(async () => {
			const before = state.capture();
			try {
				const result = await operation();
				if (this.dirty) reconcile();
				return result;
			} catch (cause) {
				state.rollback(before);
				throw cause;
			} finally {
				this.dirty = false;
			}
		});
	}
}
