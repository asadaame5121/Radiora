import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert";
import type { Branch, Occurrence, Work, WorkingCopy } from "../src/domain/models.ts";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";
import type { WorkBundle } from "../src/storage/graph_store.ts";

class CountingMemoryGraphStore extends MemoryGraphStore {
	reconcileCount = 0;
	structureChangedCount = 0;

	override afterOutlineStructureChanged(): void {
		this.structureChangedCount++;
		super.afterOutlineStructureChanged();
	}

	override reconcileOutlineKnots(): void {
		this.reconcileCount++;
		super.reconcileOutlineKnots();
	}
}

function makeBundle(
	workId: string,
	occurrenceId: string,
	parentId: string | null = null,
): WorkBundle {
	const now = "2026-10-13T10:00:00.000Z";
	const work: Work = {
		id: workId,
		createdAt: now,
		updatedAt: now,
	};
	const branch: Branch = {
		id: `branch-${workId}`,
		workId,
		name: "main",
		headRevisionId: null,
		createdAt: now,
	};
	const workingCopy: WorkingCopy = {
		branchId: branch.id,
		workId,
		text: `Content ${workId}`,
		updatedAt: now,
	};
	const occurrence: Occurrence = {
		id: occurrenceId,
		workId,
		parentOccurrenceId: parentId,
		orderKey: 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: branch.id },
	};
	return { work, branch, workingCopy, occurrence };
}

Deno.test("MemoryGraphStore - structural changes trigger Knot reconciliation and maintain createdAt", async () => {
	const store = new CountingMemoryGraphStore();
	await store.initialize();

	// 1. Initial bundle creation triggers structure change
	const b1 = makeBundle("w1", "occ-1", null);
	await store.createWorkBundle(b1.work, b1.branch, b1.workingCopy, b1.occurrence);
	assertEquals(store.structureChangedCount, 1);
	assertEquals(store.reconcileCount, 1);
	assertEquals((await store.listKnots()).length, 0);

	// 2. Add second bundle
	const b2 = makeBundle("w2", "occ-2", "occ-1");
	await store.createWorkBundle(b2.work, b2.branch, b2.workingCopy, b2.occurrence);
	assertEquals(store.structureChangedCount, 2);
	assertEquals(store.reconcileCount, 2);
	assertEquals((await store.listKnots()).length, 0);

	// 3. Create cycle by updating occ-1 parent to occ-2
	const updatedOcc1: Occurrence = {
		...b1.occurrence,
		parentOccurrenceId: "occ-2",
	};
	await store.updateOccurrence(updatedOcc1);
	assertEquals(store.structureChangedCount, 3);
	assertEquals(store.reconcileCount, 3);
	const knotsAfterCycle = await store.listKnots();
	assertEquals(knotsAfterCycle.length, 1);
	assertEquals(knotsAfterCycle[0].cycleIds.sort(), ["occ-1", "occ-2"].sort());
	const originalKnotCreatedAt = knotsAfterCycle[0].createdAt;

	// 3b. Add an unrelated bundle: triggers reconciliation, but existing Knot createdAt must be preserved
	const bTemp = makeBundle("w-temp", "occ-temp", null);
	await store.createWorkBundle(bTemp.work, bTemp.branch, bTemp.workingCopy, bTemp.occurrence);
	assertEquals(store.structureChangedCount, 4);
	assertEquals(store.reconcileCount, 4);
	const knotsAfterTemp = await store.listKnots();
	assertEquals(knotsAfterTemp.length, 1);
	assertEquals(
		knotsAfterTemp[0].createdAt,
		originalKnotCreatedAt,
		"Existing Knot createdAt must be preserved",
	);

	// 4. Non-structural update (collapse toggle) must NOT trigger structure change or reconciliation
	const collapsedOcc1: Occurrence = {
		...updatedOcc1,
		collapsed: true,
	};
	await store.updateOccurrence(collapsedOcc1);
	assertEquals(
		store.structureChangedCount,
		4,
		"Collapsed update should not notify structure change",
	);
	assertEquals(store.reconcileCount, 4, "Collapsed update should not trigger reconciliation");

	// 5. Non-structural update (working copy text update) must NOT trigger reconciliation
	await store.updateWorkingCopy("w1", "Updated content", "2026-10-13T10:05:00.000Z");
	assertEquals(store.structureChangedCount, 4);
	assertEquals(store.reconcileCount, 4);

	// 6. Break cycle by updating occ-1 parent back to null -> Knot eliminated
	const normalOcc1: Occurrence = {
		...collapsedOcc1,
		parentOccurrenceId: null,
	};
	await store.updateOccurrence(normalOcc1);
	assertEquals(store.structureChangedCount, 5);
	assertEquals(store.reconcileCount, 5);
	assertEquals((await store.listKnots()).length, 0);

	// 7. Import valid bundles
	const b3 = makeBundle("w3", "occ-3", null);
	const b4 = makeBundle("w4", "occ-4", "occ-3");
	await store.importWorkBundles([b3, b4]);
	assertEquals(store.structureChangedCount, 6);
	assertEquals(store.reconcileCount, 6);
	assertEquals((await store.listKnots()).length, 0);

	// Form cycle by updating occ-3 parent to occ-4
	const cycleOcc3: Occurrence = {
		...b3.occurrence,
		parentOccurrenceId: "occ-4",
	};
	await store.updateOccurrence(cycleOcc3);
	assertEquals(store.structureChangedCount, 7);
	assertEquals(store.reconcileCount, 7);
	const knotsAfterImportCycle = await store.listKnots();
	assertEquals(knotsAfterImportCycle.length, 1);
	assertEquals(knotsAfterImportCycle[0].cycleIds.sort(), ["occ-3", "occ-4"].sort());

	// 8. Trash works w3 and w4 -> both inactive, cycle broken, Knot eliminated
	await store.trashWork("w3", "2026-10-13T10:10:00.000Z");
	await store.trashWork("w4", "2026-10-13T10:10:00.000Z");
	assertEquals(store.structureChangedCount, 9);
	assertEquals(store.reconcileCount, 9);
	assertEquals((await store.listKnots()).length, 0);

	// 9. Restore work w3 and w4 -> cycle restored, Knot restored and createdAt preserved!
	await store.restoreWork("w3");
	await store.restoreWork("w4");
	assertEquals(store.structureChangedCount, 11);
	assertEquals(store.reconcileCount, 11);
	const knotsAfterRestore = await store.listKnots();
	assertEquals(knotsAfterRestore.length, 1);
	assertEquals(knotsAfterRestore[0].cycleIds.sort(), ["occ-3", "occ-4"].sort());
	assertNotEquals(knotsAfterRestore[0].createdAt, "");

	// 10. Delete occurrence occ-4 -> cycle broken, occ-3 parent is now missing -> orphan knot
	await store.deleteOccurrence("occ-4");
	assertEquals(store.structureChangedCount, 12);
	assertEquals(store.reconcileCount, 12);
	const knotsAfterDeleteOcc = await store.listKnots();
	assertEquals(knotsAfterDeleteOcc.length, 1);
	assertEquals(knotsAfterDeleteOcc[0].cycleIds, ["occ-3"]);

	// 11. Trash and purge work w3 -> occ-3 purged, Knot eliminated
	await store.trashWork("w3", "2026-10-13T10:15:00.000Z");
	assertEquals(store.structureChangedCount, 13);
	assertEquals(store.reconcileCount, 13);
	assertEquals((await store.listKnots()).length, 0);

	await store.purgeWork("w3");
	assertEquals(store.structureChangedCount, 14);
	assertEquals(store.reconcileCount, 14);
	assertEquals((await store.listKnots()).length, 0);
});

Deno.test("MemoryGraphStore - failed mutation does not notify structure change", async () => {
	const store = new CountingMemoryGraphStore();
	await store.initialize();

	const countBefore = store.structureChangedCount;
	// Attempt to merge non-existent works
	await assertRejects(() =>
		store.mergeWorks({
			sourceWorkId: "missing-1",
			survivorWorkId: "missing-2",
			mergedAt: "2026-01-01T00:00:00.000Z",
		}),
	);
	assertEquals(store.structureChangedCount, countBefore);
	assertEquals(store.reconcileCount, countBefore);
});
