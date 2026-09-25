import type { RecoverySnapshot, Revision } from "../domain/models.ts";
import { validateRevisionCreation } from "./graph_store.ts";
import type { MemoryStateContainer } from "./memory_state_container.ts";

export type MutableRecoveryState = Pick<
	MemoryStateContainer,
	| "works"
	| "branches"
	| "workingCopies"
	| "revisions"
	| "recoverySnapshots"
>;

export function appendRevisionToBranch(
	state: Pick<MutableRecoveryState, "revisions" | "branches">,
	revision: Revision,
	branchId: string,
): void {
	state.revisions.push(structuredClone(revision));
	state.branches = state.branches.map((candidate) =>
		candidate.id === branchId ? { ...candidate, headRevisionId: revision.id } : candidate
	);
}

export function validateAndCreateRecoverySnapshot(
	state: Pick<MutableRecoveryState, "recoverySnapshots" | "workingCopies">,
	snapshot: RecoverySnapshot,
): void {
	if (state.recoverySnapshots.some((candidate) => candidate.id === snapshot.id)) {
		throw new Error(`Recovery Snapshot already exists: ${snapshot.id}`);
	}
	const copy = state.workingCopies.find((candidate) => candidate.branchId === snapshot.branchId);
	if (!copy || copy.workId !== snapshot.workId) {
		throw new Error(`Working Copy not found for Snapshot: ${snapshot.branchId}`);
	}
	state.recoverySnapshots.push(structuredClone(snapshot));
}

export function applyRecoverySnapshotRestore(
	state: Pick<MutableRecoveryState, "recoverySnapshots" | "workingCopies" | "works">,
	snapshotId: string,
	beforeRestore: RecoverySnapshot,
	updatedAt: string,
): void {
	const target = state.recoverySnapshots.find((candidate) => candidate.id === snapshotId);
	if (!target) throw new Error(`Recovery Snapshot not found: ${snapshotId}`);
	const copy = state.workingCopies.find((candidate) => candidate.branchId === target.branchId);
	if (
		!copy || copy.workId !== target.workId ||
		beforeRestore.workId !== target.workId ||
		beforeRestore.branchId !== target.branchId
	) {
		throw new Error("Recovery Snapshot scope does not match Working Copy");
	}
	if (state.recoverySnapshots.some((candidate) => candidate.id === beforeRestore.id)) {
		throw new Error(`Recovery Snapshot already exists: ${beforeRestore.id}`);
	}
	if (beforeRestore.text !== copy.text) {
		throw new Error("Recovery Snapshot does not capture current Working Copy");
	}
	state.recoverySnapshots.push(structuredClone(beforeRestore));
	state.workingCopies = state.workingCopies.map((candidate) =>
		candidate.branchId === target.branchId
			? { ...candidate, text: target.text, updatedAt }
			: candidate
	);
	state.works = state.works.map((work) =>
		work.id === target.workId ? { ...work, updatedAt } : work
	);
}

export function applyRecoverySnapshotPromotion(
	state: Pick<MutableRecoveryState, "recoverySnapshots" | "branches" | "revisions">,
	snapshotId: string,
	revision: Revision,
	branchId: string,
	protectedAt: string,
): void {
	const snapshot = state.recoverySnapshots.find((candidate) => candidate.id === snapshotId);
	const branch = state.branches.find((candidate) => candidate.id === branchId);
	if (!snapshot) throw new Error(`Recovery Snapshot not found: ${snapshotId}`);
	if (
		snapshot.branchId !== branchId || snapshot.workId !== revision.workId ||
		branch?.workId !== snapshot.workId || revision.text !== snapshot.text
	) {
		throw new Error("Recovery Snapshot scope does not match Revision");
	}
	validateRevisionCreation(revision, branch, state.revisions);
	appendRevisionToBranch(state, revision, branchId);
	state.recoverySnapshots = state.recoverySnapshots.map((candidate) =>
		candidate.id === snapshotId
			? { ...candidate, protection: { reason: "revision-source", protectedAt } }
			: candidate
	);
}
