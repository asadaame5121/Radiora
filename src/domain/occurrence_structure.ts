import type { Occurrence } from "./models.ts";

/** Parent and Work changes invalidate the derived outline Knot projection. */
export function hasOccurrenceStructureChanged(
	previous: Occurrence | undefined,
	next: Occurrence,
): boolean {
	return previous !== undefined && (
		previous.parentOccurrenceId !== next.parentOccurrenceId || previous.workId !== next.workId
	);
}
