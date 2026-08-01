import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { DateProjectionService } from "./date_projection.ts";

const START = "2026-07-29T00:00:00.000Z";
const END = "2026-07-30T00:00:00.000Z";

Deno.test("date projection separates created Work from existing Work updated in a half-open range", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "created", START, "2026-07-29T12:00:00.000Z");
	await addWork(store, "existing", "2026-07-28T23:59:59.999Z", "2026-07-29T12:00:00.000Z");
	await addWork(store, "end", END, END);
	const projection = await new DateProjectionService(store).project({
		startInclusive: START,
		endExclusive: END,
	});
	assertEquals(projection.created.map((entry) => entry.work.id), ["created"]);
	assertEquals(projection.updated.map((entry) => entry.work.id), ["existing"]);
});

Deno.test("date projection keeps all placements and their breadcrumbs under one Work", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "parent", START, START);
	await addWork(store, "mirrored", START, START, "parent-occurrence");
	await store.createOccurrence({
		id: "mirror-occurrence",
		workId: "mirrored",
		parentOccurrenceId: null,
		orderKey: 2,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "mirrored-branch" },
	});
	const projection = await new DateProjectionService(store).project({
		startInclusive: START,
		endExclusive: END,
	});
	const entry = projection.created.find((candidate) => candidate.work.id === "mirrored");
	assertEquals(entry?.placements.map((placement) => placement.occurrence.id).sort(), [
		"mirror-occurrence",
		"mirrored-occurrence",
	]);
	assertEquals(
		entry?.placements.find((placement) => placement.occurrence.id === "mirrored-occurrence")
			?.breadcrumb.map((item) => item.id),
		["parent-occurrence"],
	);
});

Deno.test("date projection excludes deleted Work and invalid ranges do not write", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "active", START, START);
	await addWork(store, "deleted", START, START);
	await store.trashWork("deleted", "2026-07-29T01:00:00.000Z");
	const before = await store.listWorks(true);
	const itemsBefore = await store.listItems();
	const occurrencesBefore = await store.listOccurrences(true);
	const service = new DateProjectionService(store);
	assertEquals(
		(await service.project({ startInclusive: START, endExclusive: END })).created.map((entry) =>
			entry.work.id
		),
		[
			"active",
		],
	);
	await assertRejects(
		() => service.project({ startInclusive: "not-an-instant", endExclusive: END }),
		Error,
		"Invalid ISO instant",
	);
	await assertRejects(
		() => service.project({ startInclusive: END, endExclusive: START }),
		Error,
		"endExclusive",
	);
	assertEquals(await store.listWorks(true), before);
	assertEquals(await store.listItems(), itemsBefore);
	assertEquals(await store.listOccurrences(true), occurrencesBefore);
});

Deno.test("date projection sorts instants rather than their offset ISO strings", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "earlier", "2026-07-29T09:00:00+09:00", START);
	await addWork(store, "later", "2026-07-29T00:30:00Z", START);
	const projection = await new DateProjectionService(store).project({
		startInclusive: START,
		endExclusive: END,
	});
	assertEquals(projection.created.map((entry) => entry.work.id), ["later", "earlier"]);
});

Deno.test("date projection includes an unplaced Work without creating an Occurrence", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "unplaced", START, START);
	await store.deleteOccurrence("unplaced-occurrence");
	const projection = await new DateProjectionService(store).project({
		startInclusive: START,
		endExclusive: END,
	});
	assertEquals(projection.created[0].work.id, "unplaced");
	assertEquals(projection.created[0].representative, null);
	assertEquals(projection.created[0].placements, []);
	assertEquals((await store.listOccurrences()).length, 0);
});

Deno.test("date projection omits a blank non-Stub unplaced Work", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "blank", START, START, null, "");
	await store.deleteOccurrence("blank-occurrence");

	const projection = await new DateProjectionService(store).project({
		startInclusive: START,
		endExclusive: END,
	});
	assertEquals(projection.created, []);
});

async function addWork(
	store: MemoryGraphStore,
	id: string,
	createdAt: string,
	updatedAt: string,
	parentOccurrenceId: string | null = null,
	text = id,
): Promise<void> {
	await store.createWorkBundle(
		{ id, createdAt, updatedAt },
		{ id: `${id}-branch`, workId: id, name: "main", headRevisionId: null, createdAt },
		{ branchId: `${id}-branch`, workId: id, text, updatedAt },
		{
			id: `${id}-occurrence`,
			workId: id,
			parentOccurrenceId,
			orderKey: 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: `${id}-branch` },
		},
	);
}
