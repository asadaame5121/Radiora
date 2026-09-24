import type { Occurrence, PurgeManifest } from "../domain/models.ts";
import type { MemoryStateContainer } from "./memory_state_container.ts";

export type MutableWorkLifecycleState = Pick<
	MemoryStateContainer,
	| "works"
	| "branches"
	| "workingCopies"
	| "revisions"
	| "recoverySnapshots"
	| "bookmarks"
	| "resumePosition"
	| "occurrences"
	| "links"
	| "purgeManifests"
>;

export function applyWorkTrash(
	state: Pick<MutableWorkLifecycleState, "works">,
	workId: string,
	deletedAt: string,
): void {
	state.works = state.works.map((work) =>
		work.id === workId ? { ...work, deletedAt, updatedAt: deletedAt } : work
	);
}

export function applyWorkRestore(
	state: Pick<MutableWorkLifecycleState, "works" | "occurrences">,
	workId: string,
): void {
	state.works = state.works.map((work) => {
		if (work.id !== workId) return work;
		const restored = { ...work };
		delete restored.deletedAt;
		return restored;
	});
	cleanupOrphanOccurrences(state.occurrences, (occ) => occ.workId === workId);
}

function cleanupOrphanOccurrences(
	occurrences: Occurrence[],
	predicate: (occurrence: Occurrence) => boolean,
): void {
	const occurrenceIds = new Set(occurrences.map((occurrence) => occurrence.id));
	for (const occurrence of occurrences) {
		if (
			predicate(occurrence) &&
			occurrence.parentOccurrenceId &&
			!occurrenceIds.has(occurrence.parentOccurrenceId)
		) {
			occurrence.parentOccurrenceId = null;
		}
	}
}

export function applyWorkPurge(
	state: MutableWorkLifecycleState,
	workId: string,
): PurgeManifest {
	const work = state.works.find((candidate) => candidate.id === workId);
	if (!work?.deletedAt) {
		throw new Error(`Work must be in trash before it can be purged: ${workId}`);
	}
	const branchIds = new Set(
		state.branches.filter((branch) => branch.workId === workId).map((branch) => branch.id),
	);
	const manifest: PurgeManifest = {
		id: crypto.randomUUID(),
		workId,
		occurrenceIds: state.occurrences
			.filter((occurrence) => occurrence.workId === workId)
			.map((occurrence) => occurrence.id),
		branchIds: [...branchIds],
		revisionIds: state.revisions
			.filter((revision) => revision.workId === workId)
			.map((revision) => revision.id),
		linkIds: state.links
			.filter((link) => link.from.workId === workId || link.to.workId === workId)
			.map((link) => link.id),
		purgedAt: new Date().toISOString(),
	};
	state.purgeManifests.push(manifest);
	purgeAssociatedEntities(state, workId, branchIds);
	cleanupOrphanOccurrences(state.occurrences, () => true);
	return manifest;
}

function purgeAssociatedEntities(
	state: MutableWorkLifecycleState,
	workId: string,
	branchIds: ReadonlySet<string>,
): void {
	state.works = state.works.filter((work) => work.id !== workId);
	state.branches = state.branches.filter((branch) => branch.workId !== workId);
	state.workingCopies = state.workingCopies.filter((copy) =>
		copy.workId !== workId && !branchIds.has(copy.branchId)
	);
	state.revisions = state.revisions.filter((revision) => revision.workId !== workId);
	state.recoverySnapshots = state.recoverySnapshots.filter((snapshot) =>
		snapshot.workId !== workId
	);
	state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.workId !== workId);
	if (state.resumePosition?.workId === workId) state.resumePosition = null;
	state.occurrences = state.occurrences.filter((occurrence) => occurrence.workId !== workId);
	state.links = state.links.filter((link) =>
		link.from.workId !== workId && link.to.workId !== workId
	);
}
