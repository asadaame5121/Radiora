import { assertEquals } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { DuplicateCandidateService } from "./duplicate_candidates.ts";
import type { OutlineLink, Work, WorkingCopy } from "../domain/models.ts";

const CREATED_AT = "2026-07-30T00:00:00.000Z";

async function addWork(
	store: MemoryGraphStore,
	id: string,
	text: string,
): Promise<void> {
	const work: Work = { id, createdAt: CREATED_AT, updatedAt: CREATED_AT };
	const branch = {
		id: `${id}-main`,
		workId: id,
		name: "main",
		headRevisionId: null,
		createdAt: CREATED_AT,
	};
	const copy: WorkingCopy = {
		branchId: branch.id,
		workId: id,
		text,
		updatedAt: CREATED_AT,
	};
	await store.createUnplacedWork(work, branch, copy);
}

async function addLink(
	store: MemoryGraphStore,
	fromId: string,
	toId: string,
	type: OutlineLink["type"],
	status: OutlineLink["status"] = "asserted",
): Promise<void> {
	const link: OutlineLink = {
		id: `${fromId}-${toId}-${type}`,
		fromId,
		toId,
		from: { scope: "work", workId: fromId },
		to: { scope: "work", workId: toId },
		type,
		status,
		origin: "human",
		createdAt: CREATED_AT,
	};
	await store.createLink(link);
}

Deno.test("title match (score 3) produces a duplicate candidate", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "調査メモ");
	await addWork(store, "work-b", "調査メモ\n続きの本文");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 1);
	assertEquals(candidates[0].score, 3);
	assertEquals(candidates[0].reasons.length, 1);
	assertEquals(candidates[0].reasons[0].kind, "title");
});

Deno.test("title match with NFKC normalization", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "テスト");
	await addWork(store, "work-b", "ﾃｽﾄ");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 1);
	assertEquals(candidates[0].score, 3);
	assertEquals(candidates[0].reasons[0].kind, "title");
});

Deno.test("alias match (score 2) produces a duplicate candidate", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "放射");
	await addWork(store, "work-b", "ラジオ");
	await store.upsertAlias({
		id: "alias-1",
		canonical: "放射",
		variants: ["ラジオ"],
		createdAt: CREATED_AT,
		updatedAt: CREATED_AT,
	});

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 1);
	assertEquals(candidates[0].score, 2);
	assertEquals(candidates[0].reasons.length, 1);
	assertEquals(candidates[0].reasons[0].kind, "alias");
});

Deno.test("tag alias (canonical starts with #) does not produce alias reason", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "#foo");
	await addWork(store, "work-b", "#bar");
	await store.upsertAlias({
		id: "tag-alias",
		canonical: "#foo",
		variants: ["#bar"],
		createdAt: CREATED_AT,
		updatedAt: CREATED_AT,
	});

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 0);
});

Deno.test("single shared tag (score 1) does not produce a candidate", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "Work A\n#共通");
	await addWork(store, "work-b", "Work B\n#共通");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 0);
});

Deno.test("two shared tags (score 2) produce a candidate", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "Work A\n#x #y");
	await addWork(store, "work-b", "Work B\n#x #y");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 1);
	assertEquals(candidates[0].score, 2);
	assertEquals(candidates[0].reasons.length, 2);
	assertEquals(candidates[0].reasons.every((reason) => reason.kind === "tag"), true);
});

Deno.test("single shared link (score 1) does not produce a candidate", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "A");
	await addWork(store, "work-b", "B");
	await addWork(store, "target", "Target");
	await addLink(store, "work-a", "target", "CITE");
	await addLink(store, "work-b", "target", "CITE");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 0);
});

Deno.test("shared link + shared tag (score 2) produce a candidate", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "Work A\n#共通");
	await addWork(store, "work-b", "Work B\n#共通");
	await addWork(store, "target", "Target");
	await addLink(store, "work-a", "target", "CITE");
	await addLink(store, "work-b", "target", "CITE");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 1);
	assertEquals(candidates[0].score, 2);
});

Deno.test("retracted link does not count", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "Work A\n#共通");
	await addWork(store, "work-b", "Work B\n#共通");
	await addWork(store, "target", "Target");
	await addLink(store, "work-a", "target", "CITE", "retracted");
	await addLink(store, "work-b", "target", "CITE");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 0);
});

Deno.test("symmetric link (LIKE) counts regardless of direction", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "Work A\n#共通");
	await addWork(store, "work-b", "Work B\n#共通");
	await addWork(store, "target", "Target");
	await addLink(store, "work-a", "target", "LIKE");
	await addLink(store, "target", "work-b", "LIKE");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 1);
	assertEquals(candidates[0].score, 2);
	assertEquals(candidates[0].reasons.length, 2);
});

Deno.test("asymmetric link (CITE) does not count when directions differ", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "A");
	await addWork(store, "work-b", "B");
	await addWork(store, "target", "Target");
	await addLink(store, "work-a", "target", "CITE");
	await addLink(store, "target", "work-b", "CITE");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 0);
});

Deno.test("combined score: title (3) + 2 tags (2) = 5", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "調査メモ\n#x #y");
	await addWork(store, "work-b", "調査メモ\n#x #y");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 1);
	assertEquals(candidates[0].score, 5);
	const totalScore = candidates[0].reasons.reduce((sum, reason) => sum + reason.score, 0);
	assertEquals(totalScore, candidates[0].score);
});

Deno.test("same Work does not produce a pair", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "調査メモ");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 0);
});

Deno.test("trashed Work does not produce a candidate", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "調査メモ");
	await addWork(store, "work-b", "調査メモ");
	await store.trashWork("work-b", CREATED_AT);

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 0);
});

Deno.test("empty titles do not match", async () => {
	const store = new MemoryGraphStore();
	// Stub を持つ Work は空テキストを許可される
	await store.createUnplacedWork(
		{
			id: "work-a",
			createdAt: CREATED_AT,
			updatedAt: CREATED_AT,
			stub: { createdAt: CREATED_AT, createdVia: "stub-list" },
		},
		{
			id: "work-a-main",
			workId: "work-a",
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		{ branchId: "work-a-main", workId: "work-a", text: "", updatedAt: CREATED_AT },
	);
	await store.createUnplacedWork(
		{
			id: "work-b",
			createdAt: CREATED_AT,
			updatedAt: CREATED_AT,
			stub: { createdAt: CREATED_AT, createdVia: "stub-list" },
		},
		{
			id: "work-b-main",
			workId: "work-b",
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		{ branchId: "work-b-main", workId: "work-b", text: "", updatedAt: CREATED_AT },
	);

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 0);
});

Deno.test("candidates are sorted by score descending, then titles", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "調査メモ\n#x #y");
	await addWork(store, "work-b", "調査メモ\n#x #y");
	await addWork(store, "work-c", "テスト");
	await addWork(store, "work-d", "テスト");

	const service = new DuplicateCandidateService(store);
	const candidates = await service.listCandidates();

	assertEquals(candidates.length, 2);
	assertEquals(candidates[0].score >= candidates[1].score, true);
});

Deno.test("listCandidates is read-only: store state is unchanged", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", "調査メモ");
	await addWork(store, "work-b", "調査メモ");
	await addLink(store, "work-a", "work-b", "RELATED");
	await store.upsertAlias({
		id: "alias-1",
		canonical: "放射",
		variants: ["ラジオ"],
		createdAt: CREATED_AT,
		updatedAt: CREATED_AT,
	});

	const worksBefore = JSON.stringify(await store.listWorks(true));
	const linksBefore = JSON.stringify(await store.listLinks());
	const aliasesBefore = JSON.stringify(await store.listAliases());

	const service = new DuplicateCandidateService(store);
	await service.listCandidates();

	const worksAfter = JSON.stringify(await store.listWorks(true));
	const linksAfter = JSON.stringify(await store.listLinks());
	const aliasesAfter = JSON.stringify(await store.listAliases());

	assertEquals(worksBefore, worksAfter);
	assertEquals(linksBefore, linksAfter);
	assertEquals(aliasesBefore, aliasesAfter);
});
