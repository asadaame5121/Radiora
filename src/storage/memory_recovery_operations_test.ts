import { assertEquals, assertThrows } from "jsr:@std/assert";
import type { Branch, RecoverySnapshot, Revision, Work, WorkingCopy } from "../domain/models.ts";
import { MemoryStateContainer } from "./memory_state_container.ts";
import {
	appendRevisionToBranch,
	applyRecoverySnapshotPromotion,
	applyRecoverySnapshotRestore,
	validateAndCreateRecoverySnapshot,
} from "./memory_recovery_operations.ts";

Deno.test("appendRevisionToBranch - adds revision and updates branch head", () => {
	const state = new MemoryStateContainer();
	const now = "2026-08-01T00:00:00.000Z";
	state.branches = [{ id: "b1", workId: "w1", name: "main", headRevisionId: null, createdAt: now }];
	const rev: Revision = {
		id: "r1",
		workId: "w1",
		text: "rev-text",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: now,
	};
	appendRevisionToBranch(state, rev, "b1");

	assertEquals(state.revisions.length, 1);
	assertEquals(state.revisions[0].id, "r1");
	assertEquals(state.branches[0].headRevisionId, "r1");
});

Deno.test("validateAndCreateRecoverySnapshot - adds valid snapshot and throws on duplicate", () => {
	const state = new MemoryStateContainer();
	const now = "2026-08-01T00:00:00.000Z";
	state.workingCopies = [{ workId: "w1", branchId: "b1", text: "text", updatedAt: now }];
	const snap: RecoverySnapshot = {
		id: "snap-1",
		workId: "w1",
		branchId: "b1",
		text: "text",
		contentHash: "hash-1",
		createdAt: now,
		sourceRevisionId: null,
	};

	validateAndCreateRecoverySnapshot(state, snap);
	assertEquals(state.recoverySnapshots.length, 1);

	assertThrows(
		() => validateAndCreateRecoverySnapshot(state, snap),
		Error,
		"Recovery Snapshot already exists",
	);

	assertThrows(
		() =>
			validateAndCreateRecoverySnapshot(state, {
				...snap,
				id: "snap-2",
				branchId: "b-other",
			}),
		Error,
		"Working Copy not found for Snapshot",
	);
});

Deno.test("applyRecoverySnapshotRestore - restores working copy text and appends beforeRestore", () => {
	const state = new MemoryStateContainer();
	const now = "2026-08-01T00:00:00.000Z";
	state.works = [{ id: "w1", createdAt: now, updatedAt: now }];
	state.workingCopies = [{ workId: "w1", branchId: "b1", text: "current-text", updatedAt: now }];
	state.recoverySnapshots = [{
		id: "snap-1",
		workId: "w1",
		branchId: "b1",
		text: "restored-text",
		contentHash: "hash-1",
		createdAt: now,
		sourceRevisionId: null,
	}];

	applyRecoverySnapshotRestore(
		state,
		"snap-1",
		{
			id: "snap-before",
			workId: "w1",
			branchId: "b1",
			text: "current-text",
			contentHash: "hash-before",
			createdAt: now,
			sourceRevisionId: null,
		},
		now,
	);

	assertEquals(state.workingCopies[0].text, "restored-text");
	assertEquals(state.recoverySnapshots.length, 2);
	assertEquals(state.recoverySnapshots[1].id, "snap-before");
});

Deno.test("applyRecoverySnapshotPromotion - creates revision and protects snapshot", () => {
	const state = new MemoryStateContainer();
	const now = "2026-08-01T00:00:00.000Z";
	state.branches = [{ id: "b1", workId: "w1", name: "main", headRevisionId: null, createdAt: now }];
	state.recoverySnapshots = [{
		id: "snap-1",
		workId: "w1",
		branchId: "b1",
		text: "content",
		contentHash: "hash-1",
		createdAt: now,
		sourceRevisionId: null,
	}];

	const rev: Revision = {
		id: "r1",
		workId: "w1",
		text: "content",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: now,
	};

	applyRecoverySnapshotPromotion(state, "snap-1", rev, "b1", now);

	assertEquals(state.revisions.length, 1);
	assertEquals(state.branches[0].headRevisionId, "r1");
	assertEquals(state.recoverySnapshots[0].protection?.reason, "revision-source");
});
