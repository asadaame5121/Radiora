import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { QuickCaptureService } from "./quick_capture_service.ts";
import { OutlineService } from "./outline_service.ts";
import { StubService } from "./stub_service.ts";

const NOW = "2026-07-29T03:04:05.000Z";
const WORK_ID = "00000000-0000-4000-8000-000000000001";
const BRANCH_ID = "00000000-0000-4000-8000-000000000002";

function deterministicCapture(store: MemoryGraphStore): QuickCaptureService {
	const ids = [WORK_ID, BRANCH_ID];
	return new QuickCaptureService(store, () => NOW, () => ids.shift()!);
}

Deno.test("Quick Capture atomically creates exactly Work, main Branch, and Working Copy", async () => {
	const store = new MemoryGraphStore();
	const capture = deterministicCapture(store);

	assertEquals(await capture.capture("idea #inbox"), {
		workId: WORK_ID,
		branchId: BRANCH_ID,
		text: "idea #inbox",
		createdAt: NOW,
		updatedAt: NOW,
	});
	assertEquals((await store.listWorks()).length, 1);
	assertEquals(await store.listBranches(), [{
		id: BRANCH_ID,
		workId: WORK_ID,
		name: "main",
		headRevisionId: null,
		createdAt: NOW,
	}]);
	assertEquals((await store.listWorkingCopies())[0].text, "idea #inbox");
	assertEquals(await store.listOccurrences(), []);
});

Deno.test("Quick Capture rejects blank and collision without partial writes", async () => {
	const store = new MemoryGraphStore();
	await assertRejects(() => deterministicCapture(store).capture("  "), Error, "must not be blank");
	assertEquals(await store.listWorks(), []);

	await deterministicCapture(store).capture("first");
	const before = await Promise.all([
		store.listWorks(true),
		store.listBranches(),
		store.listWorkingCopies(),
		store.listOccurrences(true),
	]);
	await assertRejects(
		() => deterministicCapture(store).capture("collision"),
		Error,
		"already exists",
	);
	assertEquals(
		await Promise.all([
			store.listWorks(true),
			store.listBranches(),
			store.listWorkingCopies(),
			store.listOccurrences(true),
		]),
		before,
	);
});

Deno.test("atomic unplaced creation rejects inconsistent identities and timestamps", async () => {
	const store = new MemoryGraphStore();
	const work = { id: WORK_ID, createdAt: NOW, updatedAt: NOW };
	const branch = {
		id: BRANCH_ID,
		workId: WORK_ID,
		name: "main",
		headRevisionId: null,
		createdAt: NOW,
	};
	await assertRejects(
		() =>
			store.createUnplacedWork(
				work,
				branch,
				{ branchId: BRANCH_ID, workId: "other", text: "text", updatedAt: NOW },
			),
		Error,
		"identity must match",
	);
	await assertRejects(
		() =>
			store.createUnplacedWork(
				{ ...work, createdAt: "not-an-instant", updatedAt: "not-an-instant" },
				{ ...branch, createdAt: "not-an-instant" },
				{ branchId: BRANCH_ID, workId: WORK_ID, text: "text", updatedAt: "not-an-instant" },
			),
		Error,
		"valid ISO",
	);
	assertEquals(await store.listWorks(true), []);
	assertEquals(await store.listBranches(), []);
	assertEquals(await store.listWorkingCopies(), []);
});

Deno.test("unplaced Work can be edited, tagged, placed, and returns after last removal", async () => {
	const store = new MemoryGraphStore();
	const capture = deterministicCapture(store);
	const outline = new OutlineService(store);
	await capture.capture("draft");

	await outline.updateUnplacedWorkText(WORK_ID, "edited #quick");
	assertEquals((await outline.listUnplacedWorks())[0].text, "edited #quick");
	assertEquals(await outline.listTags(), [{ name: "quick", count: 1 }]);

	const occurrence = await outline.placeUnplacedWork({ workId: WORK_ID, parentId: null });
	assertEquals(occurrence.text, "edited #quick");
	assertEquals((await store.listOccurrences()).length, 1);
	assertEquals(await outline.listUnplacedWorks(), []);

	await outline.deleteItem(occurrence.id);
	assertEquals((await outline.listUnplacedWorks()).map((entry) => entry.workId), [WORK_ID]);
});

Deno.test("blank non-Stub unplaced Works are recoverably trashed and Stubs stay in Stub list", async () => {
	const store = new MemoryGraphStore();
	const outline = new OutlineService(store);
	const empty = await outline.createItem({ text: "", parentId: null });
	await outline.deleteItem(empty.id);

	assertEquals(await outline.listUnplacedWorks(), []);
	assertEquals(
		(await store.listWorks(true)).find((work) => work.id === empty.workId)?.deletedAt !== undefined,
		true,
	);
	await store.createWorkBundle(
		{ id: "legacy-empty", createdAt: NOW, updatedAt: NOW },
		{
			id: "legacy-empty-branch",
			workId: "legacy-empty",
			name: "main",
			headRevisionId: null,
			createdAt: NOW,
		},
		{ branchId: "legacy-empty-branch", workId: "legacy-empty", text: "", updatedAt: NOW },
		{
			id: "legacy-empty-occurrence",
			workId: "legacy-empty",
			parentOccurrenceId: null,
			orderKey: 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "legacy-empty-branch" },
		},
	);
	await store.deleteOccurrence("legacy-empty-occurrence");
	assertEquals(await outline.listUnplacedWorks(), []);
	assertEquals(
		(await store.listWorks(true)).find((work) => work.id === "legacy-empty")?.deletedAt !==
			undefined,
		true,
	);

	let id = 0;
	const stub = await new StubService(
		store,
		() => NOW,
		() => `stub-${++id}`,
	).createStub("stub-list");
	assertEquals(await outline.listUnplacedWorks(), []);
	await outline.updateUnplacedWorkText(stub.workId, "Stub本文");
	assertEquals(
		(await outline.listStubs()).find((entry) => entry.workId === stub.workId)?.text,
		"Stub本文",
	);
	assertEquals((await outline.listStubs()).map((entry) => entry.workId), [stub.workId]);
});

Deno.test("unplaced Works participate in Today and deleted Works are excluded", async () => {
	const store = new MemoryGraphStore();
	const capture = deterministicCapture(store);
	const outline = new OutlineService(store);
	await capture.capture("today");

	const projection = await outline.projectDates({
		startInclusive: "2026-07-29T00:00:00.000Z",
		endExclusive: "2026-07-30T00:00:00.000Z",
	});
	assertEquals(projection.created[0].work.id, WORK_ID);
	assertEquals(projection.created[0].placements, []);

	await store.trashWork(WORK_ID, "2026-07-29T04:00:00.000Z");
	assertEquals(await outline.listUnplacedWorks(), []);
});

Deno.test("semantic links resolve active Work IDs without implicit placements", async () => {
	const store = new MemoryGraphStore();
	const outline = new OutlineService(store);
	const root = await outline.createItem({ text: "placed", parentId: null });
	const ids = [WORK_ID, BRANCH_ID];
	await new QuickCaptureService(store, () => NOW, () => ids.shift()!).capture("unplaced");
	const beforeOccurrences = await store.listOccurrences();

	await outline.createLink({ fromId: WORK_ID, toId: root.id, type: "SUPPORT" });
	await outline.createLink({ fromId: root.workId, toId: WORK_ID, type: "FROM" });

	assertEquals((await store.listLinks()).map((link) => [link.from.workId, link.to.workId]), [
		[WORK_ID, root.workId],
		[root.workId, WORK_ID],
	]);
	assertEquals(await store.listOccurrences(), beforeOccurrences);
	await assertRejects(
		() => outline.createLink({ fromId: WORK_ID, toId: WORK_ID, type: "RELATED" }),
		Error,
		"same work",
	);
	await assertRejects(
		() =>
			outline.createLink({
				fromId: WORK_ID,
				toId: root.workId,
				type: "CITE",
				fromEndpoint: {
					scope: "revision",
					workId: WORK_ID,
					revisionId: "00000000-0000-4000-8000-000000000099",
				},
			}),
		Error,
		"Revision endpoint",
	);
	assertEquals(await store.listOccurrences(), beforeOccurrences);
});

Deno.test("placing rejects a removed parent Occurrence", async () => {
	const store = new MemoryGraphStore();
	const outline = new OutlineService(store);
	const removedParent = await outline.createItem({ text: "parent", parentId: null });
	await outline.deleteItem(removedParent.id);
	await deterministicCapture(store).capture("unplaced");

	await assertRejects(
		() => outline.placeUnplacedWork({ workId: WORK_ID, parentId: removedParent.id }),
		Error,
		"Parent Occurrence not found",
	);
	assertEquals(await store.listOccurrences(), []);
});
