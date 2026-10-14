import type {
	Bookmark,
	Branch,
	Occurrence,
	ResumePosition,
	Revision,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { type SqliteDiffOperations, validateStoredPayload } from "./sqlite_records.ts";

export interface TargetedMutableState {
	works: Work[];
	branches: Branch[];
	workingCopies: WorkingCopy[];
	occurrences: Occurrence[];
	revisions: Revision[];
	bookmarks: Bookmark[];
	resumePosition: ResumePosition | null;
}

export interface TargetedMutationStep<T = void> {
	execute: () => Promise<T>;
	rollback: () => void;
	diff: SqliteDiffOperations;
}

function validateOccurrenceSelector(state: TargetedMutableState, occurrence: Occurrence): void {
	const selector = occurrence.revisionSelector;
	const valid = selector.mode === "branch"
		? state.branches.some((branch) =>
			branch.id === selector.branchId && branch.workId === occurrence.workId
		)
		: state.revisions.some((revision) =>
			revision.id === selector.revisionId && revision.workId === occurrence.workId
		);
	if (!valid) {
		const name = selector.mode === "branch" ? "Branch" : "Revision";
		throw new Error(`Invalid Occurrence ${name} selector: ${occurrence.id}`);
	}
}

function validateOccurrenceWorkChange(
	state: TargetedMutableState,
	previous: Occurrence,
	next: Occurrence,
): void {
	if (previous.workId === next.workId) return;
	for (const bookmark of state.bookmarks) {
		if (bookmark.occurrenceId === next.id && bookmark.workId !== next.workId) {
			throw new Error(`Invalid Bookmark workId reference for Occurrence: ${next.id}`);
		}
	}
	const position = state.resumePosition;
	if (position?.occurrenceId === next.id && position.workId !== next.workId) {
		throw new Error(`Invalid ResumePosition workId reference for Occurrence: ${next.id}`);
	}
}

export function planTargetedOccurrenceUpdate(
	state: TargetedMutableState,
	occurrence: Occurrence,
): TargetedMutationStep {
	const occIndex = state.occurrences.findIndex((candidate) => candidate.id === occurrence.id);
	if (occIndex < 0) {
		return {
			execute: () => Promise.resolve(),
			rollback: () => Promise.resolve(),
			diff: { deletes: [], upserts: [] },
		};
	}

	const nextOccurrence = structuredClone(occurrence);
	validateStoredPayload("occurrence", nextOccurrence);

	const work = state.works.find((candidate) => candidate.id === nextOccurrence.workId);
	if (!work) {
		throw new Error(`Occurrence Work not found: ${nextOccurrence.workId}`);
	}
	validateOccurrenceSelector(state, nextOccurrence);
	const prevOccurrence = state.occurrences[occIndex];
	validateOccurrenceWorkChange(state, prevOccurrence, nextOccurrence);

	return {
		execute: () => {
			state.occurrences[occIndex] = nextOccurrence;
			return Promise.resolve();
		},
		rollback: () => {
			state.occurrences[occIndex] = prevOccurrence;
		},
		diff: {
			deletes: [],
			upserts: [{
				table: "occurrence",
				id: occurrence.id,
				position: occIndex,
				payload: nextOccurrence,
			}],
		},
	};
}

export function planTargetedResumePositionSet(
	state: TargetedMutableState,
	position: ResumePosition,
): TargetedMutationStep {
	if (!Number.isSafeInteger(position.caretOffset) || position.caretOffset < 0) {
		throw new Error(`Invalid caret offset: ${position.caretOffset}`);
	}
	const occurrence = state.occurrences.find((candidate) => candidate.id === position.occurrenceId);
	const work = state.works.find((candidate) =>
		candidate.id === position.workId && !candidate.deletedAt
	);
	if (!work || occurrence?.workId !== position.workId) {
		throw new Error("Resume Work and Occurrence must exist and match");
	}
	const prevPosition = state.resumePosition;
	const nextPosition = structuredClone(position);
	validateStoredPayload("resume_position", nextPosition);

	return {
		execute: () => {
			state.resumePosition = nextPosition;
			return Promise.resolve();
		},
		rollback: () => {
			state.resumePosition = prevPosition;
		},
		diff: {
			deletes: [],
			upserts: [{
				table: "resume_position",
				id: "current",
				position: 0,
				payload: nextPosition,
			}],
		},
	};
}

export function planTargetedResumePositionClear(
	state: TargetedMutableState,
): TargetedMutationStep {
	const prevPosition = state.resumePosition;
	return {
		execute: () => {
			state.resumePosition = null;
			return Promise.resolve();
		},
		rollback: () => {
			state.resumePosition = prevPosition;
		},
		diff: {
			deletes: prevPosition ? [{ table: "resume_position", id: "current" }] : [],
			upserts: [],
		},
	};
}

export function planTargetedBranchWorkingCopyUpdate(
	state: TargetedMutableState,
	branchId: string,
	text: string,
	updatedAt: string,
): TargetedMutationStep {
	const copyIndex = state.workingCopies.findIndex((candidate) => candidate.branchId === branchId);
	if (copyIndex < 0) {
		throw new Error(`Working Copy not found for Branch: ${branchId}`);
	}
	const prevCopy = state.workingCopies[copyIndex];
	const workIndex = state.works.findIndex((candidate) => candidate.id === prevCopy.workId);
	const prevWork = workIndex >= 0 ? state.works[workIndex] : null;

	const nextCopy: WorkingCopy = { ...prevCopy, text, updatedAt };
	validateStoredPayload("working_copy", nextCopy);
	const nextWork: Work | null = prevWork ? { ...prevWork, updatedAt } : null;
	if (nextWork) {
		validateStoredPayload("work", nextWork);
	}

	const upserts: SqliteDiffOperations["upserts"] = [];
	if (nextWork && prevWork) {
		upserts.push({ table: "work", id: prevWork.id, position: workIndex, payload: nextWork });
	}
	upserts.push({ table: "working_copy", id: branchId, position: copyIndex, payload: nextCopy });

	return {
		execute: () => {
			state.workingCopies[copyIndex] = nextCopy;
			if (nextWork && prevWork) {
				state.works[workIndex] = nextWork;
			}
			return Promise.resolve();
		},
		rollback: () => {
			state.workingCopies[copyIndex] = prevCopy;
			if (prevWork) {
				state.works[workIndex] = prevWork;
			}
		},
		diff: { deletes: [], upserts },
	};
}
