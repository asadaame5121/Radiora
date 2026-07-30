import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type {
	Branch,
	Occurrence,
	OutlineLink,
	Revision,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { JsonGraphStore } from "../storage/json_store.ts";
import { WorkMergeService } from "./work_merge_service.ts";

const NOW = "2026-07-30T12:00:00.000Z";

class MergeTestStore extends MemoryGraphStore {
	seedSystemRelations(): void {
		this.systemRelations = [
			{
				id: "relation-self",
				fromWorkId: "source",
				toWorkId: "survivor",
				type: "IN",
				createdAt: NOW,
			},
			{
				id: "relation-existing",
				fromWorkId: "survivor",
				toWorkId: "survivor",
				type: "IN",
				createdAt: NOW,
			},
		];
	}
}

async function addWork(
	store: MemoryGraphStore,
	id: string,
	text: string,
	parentOccurrenceId: string | null = null,
) {
	const work: Work = { id, createdAt: NOW, updatedAt: NOW };
	const branch: Branch = {
		id: `${id}-main`,
		workId: id,
		name: "main",
		headRevisionId: `${id}-rev`,
		createdAt: NOW,
	};
	const copy: WorkingCopy = {
		branchId: branch.id,
		workId: id,
		text,
		updatedAt: NOW,
	};
	const occurrence: Occurrence = {
		id: `${id}-occ`,
		workId: id,
		parentOccurrenceId,
		orderKey: 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: branch.id },
	};
	await store.createWorkBundle(work, branch, copy, occurrence);
	const revision: Revision = {
		id: `${id}-rev`,
		workId: id,
		text: `${text}\n旧版`,
		parentRevisionIds: [],
		kind: "edition",
		createdAt: NOW,
	};
	await store.createRevision(revision, branch.id);
	return { work, branch, copy, occurrence, revision };
}

Deno.test("duplicate merge preview enumerates documents, placements, links, revisions and aliases", async () => {
	const store = new MergeTestStore();
	await addWork(store, "source", "旧名称\n\n本文");
	await addWork(store, "survivor", "正準名\n\n本文");
	await store.upsertAlias({
		id: "old-alias",
		canonical: "旧名称",
		variants: ["以前の名称"],
		createdAt: NOW,
		updatedAt: NOW,
	});
	const link: OutlineLink = {
		id: "link",
		fromId: "source",
		toId: "survivor",
		from: { scope: "revision", workId: "source", revisionId: "source-rev" },
		to: { scope: "work", workId: "survivor" },
		type: "FROM",
		status: "asserted",
		origin: "human",
		createdAt: NOW,
	};
	await store.createLink(link);

	const preview = await new WorkMergeService(store, {
		now: () => NOW,
		createAliasId: () => "merge-alias",
	}).preview("source", "survivor");

	assertEquals(preview.sourceTitle, "旧名称");
	assertEquals(preview.survivorTitle, "正準名");
	assertEquals(preview.documents.source.documents.map((document) => document.scope), [
		"branch",
		"revision",
	]);
	assertEquals(preview.occurrenceIds, ["source-occ"]);
	assertEquals(preview.revisionIds, ["source-rev"]);
	assertEquals(preview.branchRenames, [{
		branchId: "source-main",
		from: "main",
		to: "merged/source/main",
	}]);
	assertEquals(preview.links[0].afterFrom, {
		scope: "revision",
		workId: "survivor",
		revisionId: "source-rev",
	});
	assertEquals(preview.aliasAfterMerge?.variants, ["旧名称", "以前の名称"]);
});

Deno.test("same-title duplicate merge succeeds without creating a redundant alias", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "source", "同じ名称");
	await addWork(store, "survivor", "同じ名称");
	const service = new WorkMergeService(store, {
		now: () => NOW,
		createAliasId: () => "unused-alias",
	});
	const preview = await service.preview("source", "survivor");

	assertEquals(preview.aliasAfterMerge, undefined);
	await service.merge(preview);

	assertEquals((await store.listWorks(true)).find((work) => work.id === "source"), {
		id: "source",
		createdAt: NOW,
		updatedAt: NOW,
		mergedIntoWorkId: "survivor",
		mergedAt: NOW,
	});
	assertEquals(await store.listAliases(), []);
});

Deno.test("duplicate merge moves all scoped state, retains provenance and retracts duplicate links", async () => {
	const store = new MergeTestStore();
	await addWork(store, "source", "旧名称");
	await addWork(store, "survivor", "正準名");
	const links: OutlineLink[] = [
		{
			id: "existing",
			fromId: "survivor",
			toId: "third",
			from: { scope: "work", workId: "survivor" },
			to: { scope: "work", workId: "third" },
			type: "RELATED",
			status: "asserted",
			origin: "human",
			createdAt: NOW,
		},
		{
			id: "rewired-duplicate",
			fromId: "third",
			toId: "source",
			from: { scope: "work", workId: "third" },
			to: { scope: "work", workId: "source" },
			type: "RELATED",
			status: "asserted",
			origin: "human",
			createdAt: NOW,
		},
	];
	for (const link of links) await store.createLink(link);
	await store.createRecoverySnapshot({
		id: "source-snapshot",
		workId: "source",
		branchId: "source-main",
		text: "復旧本文",
		contentHash: "hash",
		createdAt: NOW,
		sourceRevisionId: "source-rev",
	});
	await store.createBookmark({
		id: "source-bookmark",
		workId: "source",
		occurrenceId: "source-occ",
		createdAt: NOW,
	});
	await store.setResumePosition({
		workId: "source",
		occurrenceId: "source-occ",
		caretOffset: 3,
		updatedAt: NOW,
	});
	store.seedSystemRelations();
	const service = new WorkMergeService(store, {
		now: () => NOW,
		createAliasId: () => "merge-alias",
	});
	await service.merge(await service.preview("source", "survivor"));

	assertEquals(await store.listWorks(), [{
		id: "survivor",
		createdAt: NOW,
		updatedAt: NOW,
	}]);
	assertEquals((await store.listWorks(true)).find((work) => work.id === "source"), {
		id: "source",
		createdAt: NOW,
		updatedAt: NOW,
		mergedIntoWorkId: "survivor",
		mergedAt: NOW,
	});
	assertEquals((await store.listOccurrences()).map((entry) => entry.workId), [
		"survivor",
		"survivor",
	]);
	assertEquals((await store.listBranches("survivor")).map((branch) => [branch.id, branch.name]), [
		["source-main", "merged/source/main"],
		["survivor-main", "main"],
	]);
	assertEquals((await store.listRevisions("survivor")).map((revision) => revision.id), [
		"source-rev",
		"survivor-rev",
	]);
	assertEquals((await store.listRecoverySnapshots("survivor"))[0].id, "source-snapshot");
	assertEquals((await store.listBookmarks())[0].workId, "survivor");
	assertEquals((await store.getResumePosition())?.workId, "survivor");
	assertEquals(await store.listSystemRelations(), [
		{
			id: "relation-self",
			fromWorkId: "survivor",
			toWorkId: "survivor",
			type: "IN",
			createdAt: NOW,
		},
		{
			id: "relation-existing",
			fromWorkId: "survivor",
			toWorkId: "survivor",
			type: "IN",
			createdAt: NOW,
		},
	]);
	assertEquals((await store.listLinks()).map((link) => [link.id, link.status]), [
		["existing", "asserted"],
		["rewired-duplicate", "retracted"],
	]);
	assertEquals((await store.listAliases()).find((alias) => alias.id === "merge-alias")?.variants, [
		"旧名称",
	]);
});

Deno.test("duplicate merge validation failure is atomic in Memory store", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "source", "旧名称");
	await addWork(store, "survivor", "正準名");
	const before = JSON.stringify({
		works: await store.listWorks(true),
		branches: await store.listBranches(),
		occurrences: await store.listOccurrences(true),
		revisions: await store.listRevisions(),
	});
	await assertRejects(
		() =>
			store.mergeWorks({
				sourceWorkId: "source",
				survivorWorkId: "survivor",
				mergedAt: "invalid",
				alias: {
					id: "alias",
					canonical: "正準名",
					variants: ["旧名称"],
					createdAt: NOW,
					updatedAt: NOW,
				},
			}),
		Error,
		"valid ISO instant",
	);
	assertEquals(
		JSON.stringify({
			works: await store.listWorks(true),
			branches: await store.listBranches(),
			occurrences: await store.listOccurrences(true),
			revisions: await store.listRevisions(),
		}),
		before,
	);
});

Deno.test("duplicate merge persistence failure rolls back all JSON in-memory state", async () => {
	const directory = await Deno.makeTempDir();
	const store = new JsonGraphStore(`${directory}/graph.json`);
	await addWork(store, "source", "旧名称");
	await addWork(store, "survivor", "正準名");
	const service = new WorkMergeService(store, {
		now: () => NOW,
		createAliasId: () => "merge-alias",
	});
	const preview = await service.preview("source", "survivor");
	const before = JSON.stringify({
		works: await store.listWorks(true),
		branches: await store.listBranches(),
		revisions: await store.listRevisions(),
		occurrences: await store.listOccurrences(true),
		aliases: await store.listAliases(),
	});
	await Deno.remove(directory, { recursive: true });
	await assertRejects(() => service.merge(preview), Deno.errors.NotFound);
	assertEquals(
		JSON.stringify({
			works: await store.listWorks(true),
			branches: await store.listBranches(),
			revisions: await store.listRevisions(),
			occurrences: await store.listOccurrences(true),
			aliases: await store.listAliases(),
		}),
		before,
	);
});
