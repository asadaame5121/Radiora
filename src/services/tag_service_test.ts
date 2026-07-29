import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { Revision } from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { OutlineService } from "./outline_service.ts";
import { TagService } from "./tag_service.ts";

const CREATED_AT = "2026-07-28T00:00:00.000Z";

async function fixture(): Promise<{
	store: MemoryGraphStore;
	tags: TagService;
	revisions: Revision[];
}> {
	const store = new MemoryGraphStore();
	await store.createWorkBundle(
		{ id: "work", createdAt: CREATED_AT, updatedAt: CREATED_AT },
		{
			id: "main",
			workId: "work",
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		{
			branchId: "main",
			workId: "work",
			text: "Main #Shared #Main-Only #shared",
			updatedAt: CREATED_AT,
		},
		{
			id: "main-occurrence",
			workId: "work",
			parentOccurrenceId: null,
			orderKey: 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "main" },
		},
	);
	await store.createBranch(
		{
			id: "draft",
			workId: "work",
			name: "draft",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		{
			branchId: "draft",
			workId: "work",
			text: "Draft #Shared #Draft",
			updatedAt: CREATED_AT,
		},
	);
	await store.createBranch(
		{
			id: "archived",
			workId: "work",
			name: "archived",
			headRevisionId: null,
			createdAt: CREATED_AT,
			archivedAt: "2026-07-28T01:00:00.000Z",
		},
		{
			branchId: "archived",
			workId: "work",
			text: "Old #Archived",
			updatedAt: CREATED_AT,
		},
	);

	const fixed: Revision = {
		id: "fixed",
		workId: "work",
		text: "Published #Shared #Fixed",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: "2026-07-28T02:00:00.000Z",
	};
	await store.createRevision(fixed, "main");
	const history: Revision = {
		id: "history",
		workId: "work",
		text: "Past #History #Shared",
		parentRevisionIds: ["fixed"],
		kind: "checkpoint",
		createdAt: "2026-07-28T03:00:00.000Z",
	};
	await store.createRevision(history, "main");
	await store.createOccurrence({
		id: "fixed-occurrence",
		workId: "work",
		parentOccurrenceId: null,
		orderKey: 2,
		collapsed: false,
		revisionSelector: { mode: "pinned", revisionId: fixed.id },
	});
	let id = 0;
	const tags = new TagService(
		store,
		() => `2026-07-28T04:00:0${id}.000Z`,
		() => `tag-alias-${++id}`,
	);
	return { store, tags, revisions: [fixed, history] };
}

Deno.test("tags retain active Branch and fixed Revision scopes without a Work union", async () => {
	const { tags } = await fixture();
	const scopes = await tags.listScopedTags();
	assertEquals(scopes, [
		{
			scope: { kind: "working-copy", workId: "work", branchId: "draft" },
			tags: ["draft", "shared"],
		},
		{
			scope: { kind: "working-copy", workId: "work", branchId: "main" },
			tags: ["main-only", "shared"],
		},
		{
			scope: { kind: "revision", workId: "work", revisionId: "fixed" },
			tags: ["fixed", "shared"],
		},
	]);
	assertEquals(await tags.search({ all: ["main-only", "draft"] }), []);
	assertEquals(
		(await tags.search({ all: ["shared"], none: ["draft"] })).map((match) => match.scope),
		[
			{ kind: "working-copy", workId: "work", branchId: "main" },
			{ kind: "revision", workId: "work", revisionId: "fixed" },
		],
	);
});

Deno.test("past Revision tags require explicit history opt-in", async () => {
	const { tags } = await fixture();
	assertEquals(await tags.search({ all: ["history"] }), []);
	assertEquals(
		await tags.search({
			all: ["history", "shared"],
			historyRevisionIds: ["history"],
		}),
		[{
			scope: { kind: "revision", workId: "work", revisionId: "history" },
			tags: ["history", "shared"],
		}],
	);
});

Deno.test("tag completion normalizes prefixes and has stable count ordering", async () => {
	const { tags } = await fixture();
	assertEquals(await tags.suggest(" ＃SH ", 8), [{ name: "shared", count: 3 }]);
	assertEquals((await tags.listTags()).map((tag) => tag.name), [
		"shared",
		"draft",
		"fixed",
		"main-only",
	]);
	assertEquals(await tags.suggest("", 2), [
		{ name: "shared", count: 3 },
		{ name: "draft", count: 1 },
	]);
});

Deno.test("rename and merge canonicalize display and search without rewriting text", async () => {
	const { store, tags, revisions } = await fixture();
	const copiesBefore = await store.listWorkingCopies("work");
	const revisionsBefore = await store.listRevisions("work");

	assertEquals(await tags.rename("shared", "topic"), {
		id: "tag-alias-1",
		canonicalName: "topic",
		variants: ["shared"],
		createdAt: "2026-07-28T04:00:00.000Z",
		updatedAt: "2026-07-28T04:00:00.000Z",
	});
	await tags.rename("topic", "subject");
	await tags.merge(["main-only", "draft"], "status");
	assertEquals(
		(await tags.search({ all: ["subject", "status"] })).map((match) => match.scope),
		[
			{ kind: "working-copy", workId: "work", branchId: "draft" },
			{ kind: "working-copy", workId: "work", branchId: "main" },
		],
	);
	assertEquals((await tags.listTags()).map((tag) => tag.name), [
		"subject",
		"status",
		"fixed",
	]);
	assertEquals(
		(await tags.search({ all: ["shared"] })).map((match) => match.tags),
		[["status", "subject"], ["status", "subject"], ["fixed", "subject"]],
	);
	assertEquals(
		(await tags.listAliases()).map((alias) => ({
			canonicalName: alias.canonicalName,
			variants: alias.variants,
		})),
		[
			{ canonicalName: "status", variants: ["draft", "main-only"] },
			{ canonicalName: "subject", variants: ["shared", "topic"] },
		],
	);
	assertEquals(await store.listWorkingCopies("work"), copiesBefore);
	assertEquals(await store.listRevisions("work"), revisionsBefore);
	assertEquals(revisionsBefore, revisions);
});

Deno.test("tag aliases are isolated from ordinary search aliases", async () => {
	const { store, tags } = await fixture();
	const outline = new OutlineService(store);
	await outline.saveSearchAlias({ canonical: "concept", variants: ["idea"] });
	await tags.rename("shared", "topic");
	assertEquals((await outline.listSearchAliases()).map((alias) => alias.canonical), ["concept"]);
	assertEquals(await outline.searchItems("topic"), []);
	assertEquals((await tags.listAliases()).map((alias) => alias.canonicalName), ["topic"]);
	await assertRejects(
		() => outline.saveSearchAlias({ canonical: "#topic", variants: ["#shared"] }),
		Error,
		"タグ管理",
	);
	await assertRejects(
		() => outline.saveSearchAlias({ canonical: "topic", variants: ["#shared"] }),
		Error,
		"タグ管理",
	);
});

Deno.test("invalid tag management rejects before any persistent write", async () => {
	const { store, tags } = await fixture();
	const before = await store.listAliases();
	await assertRejects(() => tags.rename("missing", "valid"), Error, "タグが見つかりません");
	await assertRejects(() => tags.merge(["shared"], "bad tag"), Error, "不正なタグ名");
	await assertRejects(() => tags.search({ all: [] }), Error, "AND条件");
	assertEquals(await store.listAliases(), before);
});
