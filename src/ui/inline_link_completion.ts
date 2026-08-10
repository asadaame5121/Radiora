import type { InternalReferenceCompletion } from "../services/internal_reference_service.ts";

export interface InlineLinkTriggerIdentity {
	itemId: string;
	query: string;
	range: { start: number; end: number };
}

export function isSameInlineLinkTrigger(
	current: InlineLinkTriggerIdentity | null,
	itemId: string,
	trigger: { query: string; range: { start: number; end: number } },
): boolean {
	return current?.itemId === itemId && current.query === trigger.query &&
		current.range.start === trigger.range.start && current.range.end === trigger.range.end;
}

export function filterInlineLinkCandidates(
	candidates: readonly InternalReferenceCompletion[],
	sourceWorkId: string | undefined,
): InternalReferenceCompletion[] {
	return candidates.filter((candidate) =>
		candidate.scope === "work" && candidate.workId !== sourceWorkId &&
		candidate.displayName.trim() !== "(空の項目)"
	);
}
