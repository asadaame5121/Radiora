import type { RecoverySnapshot, WorkingCopy } from "../domain/models.ts";

export const SNAPSHOT_EDIT_IDLE_MS = 10_000;
export const SNAPSHOT_MINIMUM_INTERVAL_MS = 60_000;
export const SNAPSHOT_KEEP_ALL_MS = 7 * 24 * 60 * 60 * 1_000;
export const SNAPSHOT_HOURLY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const SNAPSHOT_DAILY_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;

export interface SnapshotCreationRequest {
	workingCopy: WorkingCopy;
	snapshots: readonly RecoverySnapshot[];
	now: string;
	contentHash: string;
}

export type SnapshotCreationDecision =
	| { create: true }
	| { create: false; reason: "editing" | "minimum-interval" | "unchanged" };

export interface SnapshotRetentionRequest {
	snapshots: readonly RecoverySnapshot[];
	now: string;
}

export interface SnapshotRetentionDecision {
	keep: RecoverySnapshot[];
	prune: RecoverySnapshot[];
}

/** Replaceable pure policy for creating and retaining Recovery Snapshots. */
export interface SnapshotPolicy {
	shouldCreate(request: SnapshotCreationRequest): SnapshotCreationDecision;
	decideRetention(request: SnapshotRetentionRequest): SnapshotRetentionDecision;
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

	decideRetention(request: SnapshotRetentionRequest): SnapshotRetentionDecision {
		const now = asTime(request.now, "now");
		const ordered = [...request.snapshots].sort(compareSnapshotScopeAndOrder);
		const keepIds = new Set<string>();
		const representatives = new Map<string, RecoverySnapshot>();

		for (const snapshot of ordered) {
			const createdAt = asTime(snapshot.createdAt, "Snapshot createdAt");
			if (isProtected(snapshot, now) || now - createdAt <= SNAPSHOT_KEEP_ALL_MS) {
				keepIds.add(snapshot.id);
				continue;
			}

			const bucket = retentionBucket(snapshot, now - createdAt);
			const previous = representatives.get(bucket);
			if (!previous || compareSnapshotOrder(previous, snapshot) < 0) {
				representatives.set(bucket, snapshot);
			}
		}

		for (const representative of representatives.values()) keepIds.add(representative.id);
		return {
			keep: ordered.filter((snapshot) => keepIds.has(snapshot.id)),
			prune: ordered.filter((snapshot) => !keepIds.has(snapshot.id)),
		};
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

function compareSnapshotScopeAndOrder(
	left: RecoverySnapshot,
	right: RecoverySnapshot,
): number {
	return left.workId.localeCompare(right.workId) ||
		left.branchId.localeCompare(right.branchId) ||
		compareSnapshotOrder(left, right);
}

function isProtected(snapshot: RecoverySnapshot, now: number): boolean {
	if (snapshot.name !== undefined) return true;
	if (!snapshot.protection) return false;
	return snapshot.protection.expiresAt === undefined ||
		asTime(snapshot.protection.expiresAt, "Snapshot protection expiresAt") > now;
}

function retentionBucket(snapshot: RecoverySnapshot, age: number): string {
	const createdAt = new Date(asTime(snapshot.createdAt, "Snapshot createdAt"));
	const scope = `${snapshot.workId}\u0000${snapshot.branchId}`;
	if (age <= SNAPSHOT_HOURLY_RETENTION_MS) {
		return `${scope}\u0000hour\u0000${createdAt.toISOString().slice(0, 13)}`;
	}
	if (age <= SNAPSHOT_DAILY_RETENTION_MS) {
		return `${scope}\u0000day\u0000${createdAt.toISOString().slice(0, 10)}`;
	}
	return `${scope}\u0000month\u0000${createdAt.toISOString().slice(0, 7)}`;
}

function asTime(value: string, label: string): number {
	const time = Date.parse(value);
	if (Number.isNaN(time)) throw new Error(`Invalid ${label}: ${value}`);
	return time;
}
