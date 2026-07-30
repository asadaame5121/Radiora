import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { StubService } from "./stub_service.ts";

const CREATED_AT = "2026-07-30T00:00:00.000Z";
const UPDATED_AT = "2026-07-30T01:00:00.000Z";

function ids(): () => string {
	let counter = 0;
	return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}

Deno.test("createStub records an unplaced Work with an empty Working Copy", async () => {
	const store = new MemoryGraphStore();
	const service = new StubService(store, () => CREATED_AT, ids());

	const created = await service.createStub("stub-list", "  書きかけの文脈  ");
	const works = await store.listWorks();
	assertEquals(works.length, 1);
	assertEquals(works[0].id, created.workId);
	assertEquals(works[0].stub, {
		createdAt: CREATED_AT,
		createdVia: "stub-list",
		context: "書きかけの文脈",
	});
	assertEquals((await store.listOccurrences()).length, 0);
	assertEquals((await store.listWorkingCopies(created.workId))[0].text, "");

	const withoutContext = await service.createStub("advanced-link-editor");
	const work = (await store.listWorks()).find((candidate) =>
		candidate.id === withoutContext.workId
	);
	assertEquals(work?.stub, { createdAt: CREATED_AT, createdVia: "advanced-link-editor" });
	assertEquals(Object.hasOwn(work?.stub ?? {}, "context"), false);
});

Deno.test("listStubs projects creation context, body state, and backlinks", async () => {
	const store = new MemoryGraphStore();
	const service = new StubService(store, () => CREATED_AT, ids());

	const first = await service.createStub("stub-list");
	const second = await service.createStub("advanced-link-editor", "未解決の名前");
	await store.createUnplacedWork(
		{ id: "referrer", createdAt: CREATED_AT, updatedAt: CREATED_AT },
		{
			id: "referrer-main",
			workId: "referrer",
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		{
			branchId: "referrer-main",
			workId: "referrer",
			text: `参照元から [Stub](radiora://work/${second.workId}) へ`,
			updatedAt: CREATED_AT,
		},
	);

	const entries = await service.listStubs();
	assertEquals(entries.map((entry) => entry.workId), [first.workId, second.workId]);
	assertEquals(entries[1].createdVia, "advanced-link-editor");
	assertEquals(entries[1].context, "未解決の名前");
	assertEquals(entries[1].createdAt, CREATED_AT);
	assertEquals(entries[1].hasText, false);
	assertEquals(entries[1].text, "");
	assertEquals(entries[1].backlinks.length, 1);
	assertEquals(entries[1].backlinks[0].source, {
		scope: "work",
		workId: "referrer",
		branchId: "referrer-main",
	});
	assertEquals(entries[0].createdVia, "stub-list");
	assertEquals(entries[0].backlinks.length, 0);

	await store.updateWorkingCopy(first.workId, "書き足した本文", UPDATED_AT);
	const updated = await service.listStubs();
	assertEquals(updated.find((entry) => entry.workId === first.workId)?.hasText, true);

	await store.resolveWorkStub(second.workId, UPDATED_AT);
	const remaining = await service.listStubs();
	assertEquals(remaining.map((entry) => entry.workId), [first.workId]);
});

Deno.test("resolveStub requires a non-empty Working Copy and is not repeatable", async () => {
	const store = new MemoryGraphStore();
	const service = new StubService(store, () => CREATED_AT, ids());

	const created = await service.createStub("stub-list");
	await assertRejects(
		() => service.resolveStub(created.workId),
		Error,
		"non-empty Working Copy",
	);
	assertEquals((await store.listWorks())[0].stub?.createdVia, "stub-list");

	await store.updateWorkingCopy(created.workId, "   ", UPDATED_AT);
	await assertRejects(
		() => service.resolveStub(created.workId),
		Error,
		"non-empty Working Copy",
	);

	await store.updateWorkingCopy(created.workId, "本文を書き足した", UPDATED_AT);
	await service.resolveStub(created.workId);
	const work = (await store.listWorks())[0];
	assertEquals(work.stub, undefined);
	assertEquals(work.updatedAt, CREATED_AT);

	await assertRejects(
		() => service.resolveStub(created.workId),
		Error,
		"Stub Work not found",
	);
	await assertRejects(
		() => service.resolveStub("00000000-0000-4000-8000-999999999999"),
		Error,
		"Stub Work not found",
	);
});
