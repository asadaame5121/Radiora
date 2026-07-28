import { assertEquals } from "jsr:@std/assert@1";
import type { RecoverySnapshot, WorkingCopy } from "../domain/models.ts";
import {
	DefaultSnapshotPolicy,
	SNAPSHOT_EDIT_IDLE_MS,
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
