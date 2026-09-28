import type { LinkType, UnplacedWork } from "../domain/models.ts";
import { isSymmetricLinkType, LINK_TYPES } from "../domain/models.ts";
import { canonicalInternalReferenceMarkdown } from "../services/internal_reference.ts";
import type { InternalReferenceCompletion } from "../services/internal_reference_service.ts";
import { EMPTY_WORK_DISPLAY_NAME } from "../services/internal_reference_display.ts";

const WORK_SHORT_ID_LENGTH = 8;

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
		candidate.displayName.trim() !== EMPTY_WORK_DISPLAY_NAME
	);
}

export function relationTypeNames(names?: () => readonly LinkType[]): readonly LinkType[] {
	const available = names ? names() : LINK_TYPES;
	return available.length > 0 ? available : LINK_TYPES;
}

export function defaultRelationType(names?: () => readonly LinkType[]): LinkType {
	const available = names ? names() : LINK_TYPES;
	if (available.includes("RELATED" as LinkType)) return "RELATED" as LinkType;
	if (available.length > 0) return available[0];
	return "RELATED" as LinkType;
}

export function isSymmetricType(
	type: LinkType,
	custom?: (type: LinkType) => boolean,
): boolean {
	return custom ? custom(type) : isSymmetricLinkType(type);
}

export function inlineLinkCandidateCount(
	state: { candidates: readonly InternalReferenceCompletion[]; query: string; searching: boolean },
): number {
	return state.candidates.length + (state.query.trim() && !state.searching ? 1 : 0);
}

export function inlineLinkCandidateFromCreated(
	work: UnplacedWork,
	workLabel: string,
): InternalReferenceCompletion {
	const displayName = work.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ??
		`(空の${workLabel})`;
	return {
		scope: "work",
		id: work.workId,
		workId: work.workId,
		displayName,
		scopeLabel: "未配置",
		shortId: work.workId.slice(0, WORK_SHORT_ID_LENGTH),
		canonicalMarkdown: canonicalInternalReferenceMarkdown(displayName, "work", work.workId),
	};
}
