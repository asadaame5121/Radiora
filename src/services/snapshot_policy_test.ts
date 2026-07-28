import { assertEquals } from "jsr:@std/assert@1";
import type { RecoverySnapshot, WorkingCopy } from "../domain/models.ts";
import {
	DefaultSnapshotPolicy,
	SNAPSHOT_DAILY_RETENTION_MS,
	SNAPSHOT_EDIT_IDLE_MS,
	SNAPSHOT_HOURLY_RETENTION_MS,
	SNAPSHOT_KEEP_ALL_MS,
	SNAPSHOT_MINIMUM_INTERVAL_MS,
} from "./snapshot_policy.ts";

const policy = new DefaultSnapshotPolicy();
const now = "2026-07-28T12:00:00.000Z";

function copy(updatedAt = "2026-07-28T11:59:50.000Z"): WorkingCopy {
	return { workId: "work", branchId: "branch", text: "current", updatedAt };
}

function snapshot(
	id: string,
	createdAt: string,
	options: Partial<RecoverySnapshot> = {},
): RecoverySnapshot {
	return {
		id,
		workId: "work",
		branchId: "branch",
		text: id,
		contentHash: id,
		createdAt,
		sourceRevisionId: null,
		...options,
	};
}

Deno.test("Snapshot policy waits for exactly ten seconds and enforces a per-Working-Copy minute", () => {
	assertEquals(
		policy.shouldCreate({
			workingCopy: copy("2026-07-28T11:59:50.001Z"),
			snapshots: [],
			now,
			contentHash: "new",
		}),
		{ create: false, reason: "editing" },
	);
	assertEquals(
		policy.shouldCreate({ workingCopy: copy(), snapshots: [], now, contentHash: "new" }),
		{ create: true },
	);
	assertEquals(
		policy.shouldCreate({
			workingCopy: copy(),
			snapshots: [snapshot("old", "2026-07-28T11:59:00.001Z")],
			now,
			contentHash: "new",
		}),
		{ create: false, reason: "minimum-interval" },
	);
	assertEquals(SNAPSHOT_EDIT_IDLE_MS, 10_000);
	assertEquals(SNAPSHOT_MINIMUM_INTERVAL_MS, 60_000);
});

Deno.test("Snapshot policy excludes unchanged content before applying time rules", () => {
	const previous = snapshot("old", "2026-07-28T11:59:59.999Z", { contentHash: "same" });
	assertEquals(
		policy.shouldCreate({
			workingCopy: copy("2026-07-28T11:59:59.999Z"),
			snapshots: [previous],
			now,
			contentHash: "same",
		}),
		{ create: false, reason: "unchanged" },
	);
});

Deno.test("Snapshot policy isolates minimum intervals by Working Copy", () => {
	const anotherCopy = { ...copy(), branchId: "another-branch" };
	assertEquals(
		policy.shouldCreate({
			workingCopy: anotherCopy,
			snapshots: [snapshot("old", "2026-07-28T11:59:59.999Z")],
			now,
			contentHash: "new",
		}),
		{ create: true },
	);
});

Deno.test("Snapshot retention fixes the 7-day, 30-day, and 1-year boundaries", () => {
	const atAge = (id: string, age: number) =>
		snapshot(id, new Date(Date.parse(now) - age).toISOString());
	const snapshots = [
		atAge("seven-days", SNAPSHOT_KEEP_ALL_MS),
		atAge("after-seven-days", SNAPSHOT_KEEP_ALL_MS + 1),
		atAge("thirty-days", SNAPSHOT_HOURLY_RETENTION_MS),
		atAge("after-thirty-days", SNAPSHOT_HOURLY_RETENTION_MS + 1),
		atAge("one-year", SNAPSHOT_DAILY_RETENTION_MS),
		atAge("after-one-year", SNAPSHOT_DAILY_RETENTION_MS + 1),
	];

	const decision = policy.decideRetention({ snapshots, now });
	assertEquals(decision.keep.map((candidate) => candidate.id), [
		"after-one-year",
		"one-year",
		"after-thirty-days",
		"thirty-days",
		"after-seven-days",
		"seven-days",
	]);
	assertEquals(decision.prune, []);
});

Deno.test("Snapshot retention keeps the last unprotected Snapshot in each UTC bucket", () => {
	const snapshots = [
		snapshot("hour-early", "2026-07-18T03:01:00.000Z"),
		snapshot("hour-last", "2026-07-18T03:59:00.000Z"),
		snapshot("hour-next", "2026-07-18T04:01:00.000Z"),
		snapshot("day-early", "2026-06-01T01:00:00.000Z"),
		snapshot("day-last", "2026-06-01T23:00:00.000Z"),
		snapshot("day-next", "2026-06-02T01:00:00.000Z"),
		snapshot("month-early", "2024-05-01T00:00:00.000Z"),
		snapshot("month-last", "2024-05-31T23:59:00.000Z"),
		snapshot("month-next", "2024-06-01T00:00:00.000Z"),
	];

	const decision = policy.decideRetention({ snapshots, now });
	assertEquals(decision.keep.map((candidate) => candidate.id), [
		"month-last",
		"month-next",
		"day-last",
		"day-next",
		"hour-last",
		"hour-next",
	]);
	assertEquals(decision.prune.map((candidate) => candidate.id), [
		"month-early",
		"day-early",
		"hour-early",
	]);
});

Deno.test("Snapshot retention preserves named and active protection outside representative slots", () => {
	const snapshots = [
		snapshot("hour-last", "2026-07-18T03:59:00.000Z"),
		snapshot("named", "2026-07-18T03:01:00.000Z", { name: "checkpoint" }),
		snapshot("protected", "2026-07-18T03:02:00.000Z", {
			protection: {
				reason: "user",
				protectedAt: "2026-07-18T03:02:00.000Z",
				expiresAt: "2026-07-28T12:00:00.001Z",
			},
		}),
		snapshot("expired", "2026-07-18T03:03:00.000Z", {
			protection: {
				reason: "import",
				protectedAt: "2026-07-18T03:03:00.000Z",
				expiresAt: now,
			},
		}),
	];

	const decision = policy.decideRetention({ snapshots, now });
	assertEquals(decision.keep.map((candidate) => candidate.id), [
		"named",
		"protected",
		"hour-last",
	]);
	assertEquals(decision.prune.map((candidate) => candidate.id), ["expired"]);
});

Deno.test("Snapshot retention isolates buckets per Working Copy and ignores input order", () => {
	const snapshots = [
		snapshot("branch-a-last", "2026-07-18T03:59:00.000Z"),
		snapshot("branch-a-early", "2026-07-18T03:01:00.000Z"),
		snapshot("branch-b-last", "2026-07-18T03:40:00.000Z", { branchId: "branch-b" }),
		snapshot("branch-b-early", "2026-07-18T03:20:00.000Z", { branchId: "branch-b" }),
		snapshot("work-b-last", "2026-07-18T03:30:00.000Z", {
			workId: "work-b",
			branchId: "branch",
		}),
		snapshot("work-b-early", "2026-07-18T03:10:00.000Z", {
			workId: "work-b",
			branchId: "branch",
		}),
	];

	const forward = policy.decideRetention({ snapshots, now });
	const reversed = policy.decideRetention({ snapshots: snapshots.toReversed(), now });
	assertEquals(forward, reversed);
	assertEquals(forward.keep.map((candidate) => candidate.id), [
		"branch-a-last",
		"branch-b-last",
		"work-b-last",
	]);
	assertEquals(forward.prune.map((candidate) => candidate.id), [
		"branch-a-early",
		"branch-b-early",
		"work-b-early",
	]);
});
