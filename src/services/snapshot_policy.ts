import type { RecoverySnapshot, WorkingCopy } from "../domain/models.ts";

export const SNAPSHOT_EDIT_IDLE_MS = 10_000;
export const SNAPSHOT_MINIMUM_INTERVAL_MS = 60_000;

export interface SnapshotCreationRequest {
	workingCopy: WorkingCopy;
	snapshots: readonly RecoverySnapshot[];
	now: string;
	contentHash: string;
}

export type SnapshotCreationDecision =
	| { create: true }
	| { create: false; reason: "editing" | "minimum-interval" | "unchanged" };

/** Replaceable pure policy for deciding whether to create a Recovery Snapshot. */
export interface SnapshotPolicy {
	shouldCreate(request: SnapshotCreationRequest): SnapshotCreationDecision;
}

/** The initial SnapshotPolicy creation rules from product-direction §4.3. */
export class DefaultSnapshotPolicy implements SnapshotPolicy {
	shouldCreate(request: SnapshotCreationRequest): SnapshotCreationDecision {
		const now = asTime(request.now, "now");
		const latest = latestForWorkingCopy(request.snapshots, request.workingCopy);

		if (latest?.contentHash === request.contentHash) return { create: false, reason: "unchanged" };
		if (
			now - asTime(request.workingCopy.updatedAt, "Working Copy updatedAt") < SNAPSHOT_EDIT_IDLE_MS
		) {
			return { create: false, reason: "editing" };
		}
		if (
			latest && now - asTime(latest.createdAt, "Snapshot createdAt") < SNAPSHOT_MINIMUM_INTERVAL_MS
		) {
			return { create: false, reason: "minimum-interval" };
		}
		return { create: true };
	}
}

function latestForWorkingCopy(
	snapshots: readonly RecoverySnapshot[],
	workingCopy: WorkingCopy,
): RecoverySnapshot | undefined {
	return snapshots
		.filter((snapshot) =>
			snapshot.workId === workingCopy.workId && snapshot.branchId === workingCopy.branchId
		)
		.reduce<RecoverySnapshot | undefined>(
			(latest, snapshot) =>
				!latest || compareSnapshotOrder(latest, snapshot) < 0 ? snapshot : latest,
			undefined,
		);
}

function compareSnapshotOrder(left: RecoverySnapshot, right: RecoverySnapshot): number {
	const byTime = asTime(left.createdAt, "Snapshot createdAt") -
		asTime(right.createdAt, "Snapshot createdAt");
	return byTime || left.id.localeCompare(right.id);
}

function asTime(value: string, label: string): number {
	const time = Date.parse(value);
	if (Number.isNaN(time)) throw new Error(`Invalid ${label}: ${value}`);
	return time;
}
