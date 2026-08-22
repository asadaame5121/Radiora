import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { LinkEndpoint, LinkType } from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { ComparisonService } from "./comparison_service.ts";

const NOW = "2026-07-29T00:00:00.000Z";

async function createWork(
	store: MemoryGraphStore,
	workId: string,
	text: string,
): Promise<{ branchId: string; occurrenceId: string }> {
	const branchId = `branch-${workId}`;
	const occurrenceId = `occ-${workId}`;
	await store.createWorkBundle(
		{ id: workId, createdAt: NOW, updatedAt: NOW },
		{ id: branchId, workId, name: "main", headRevisionId: null, createdAt: NOW },
		{ branchId, workId, text, updatedAt: NOW },
		{
			id: occurrenceId,
			workId,
			parentOccurrenceId: null,
			orderKey: 1024,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId },
		},
	);
	return { branchId, occurrenceId };
}

async function createLink(
	store: MemoryGraphStore,
	input: {
		id: string;
		type: LinkType;
		from: LinkEndpoint;
		to: LinkEndpoint;
		reason?: string;
	},
): Promise<void> {
	await store.createLink({
		id: input.id,
		fromId: input.from.workId,
		toId: input.to.workId,
		from: input.from,
		to: input.to,
		type: input.type,
		status: "asserted",
		origin: "human",
		createdAt: NOW,
		reason: input.reason,
	});
}

Deno.test("comparison preserves FROM and FIX canonical from-to direction", async () => {
	const store = new MemoryGraphStore();
	await createWork(store, "new", "新しい主張");
	await createWork(store, "old", "以前の主張");
	await createLink(store, {
		id: "from-link",
		type: "FROM",
		from: { scope: "work", workId: "new" },
		to: { scope: "work", workId: "old" },
	});
	await createLink(store, {
		id: "fix-link",
		type: "FIX",
		from: { scope: "work", workId: "new" },
		to: { scope: "work", workId: "old" },
		reason: "前提を訂正",
	});
	const service = new ComparisonService(store);

	const from = await service.resolveLink("from-link");
	const fix = await service.resolveLink("fix-link");
	assertEquals(
		[from, fix].map((projection) => ({
			type: projection.type,
			direction: projection.direction,
			left: projection.left.workId,
			right: projection.right.workId,
			reason: projection.reason,
		})),
		[
			{ type: "FROM", direction: "directed", left: "new", right: "old", reason: undefined },
			{
				type: "FIX",
				direction: "directed",
				left: "new",
				right: "old",
				reason: "前提を訂正",
			},
		],
	);
});

Deno.test("comparison marks VS symmetric while retaining stable stored endpoint order", async () => {
	const store = new MemoryGraphStore();
	await createWork(store, "a", "主張A");
	await createWork(store, "b", "主張B");
	await createLink(store, {
		id: "vs-link",
		type: "VS",
		from: { scope: "work", workId: "a" },
		to: { scope: "work", workId: "b" },
	});

	const projection = await new ComparisonService(store).resolveLink("vs-link");
	assertEquals(projection.direction, "symmetric");
	assertEquals([projection.left.workId, projection.right.workId], ["a", "b"]);
});

Deno.test("comparison follows Work Working Copy but pins Revision endpoint text", async () => {
	const store = new MemoryGraphStore();
	const source = await createWork(store, "source", "作業中");
	await createWork(store, "target", "現在の対象");
	await store.createRevision({
		id: "fixed-revision",
		workId: "target",
		text: "固定された対象",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: NOW,
	}, "branch-target");
	await createLink(store, {
		id: "fixed-link",
		type: "FIX",
		from: { scope: "work", workId: "source" },
		to: { scope: "revision", workId: "target", revisionId: "fixed-revision" },
	});
	await store.updateBranchWorkingCopy(source.branchId, "更新された作業中", NOW);
	await store.updateWorkingCopy("target", "後続の対象", NOW);

	const projection = await new ComparisonService(store).resolveLink("fixed-link");
	assertEquals(projection.left.text, "更新された作業中");
	assertEquals(projection.right, {
		scope: "revision",
		workId: "target",
		revisionId: "fixed-revision",
		title: "固定された対象",
		text: "固定された対象",
		createdAt: NOW,
	});
});

Deno.test("comparison resolves implicit FROM links from outline parent-child structure", async () => {
	const store = new MemoryGraphStore();
	const parent = await createWork(store, "parent-work", "親の思考");
	// Create child under parent
	const childBranchId = "branch-child-work";
	const childOccId = "occ-child-work";
	await store.createWorkBundle(
		{ id: "child-work", createdAt: NOW, updatedAt: NOW },
		{ id: childBranchId, workId: "child-work", name: "main", headRevisionId: null, createdAt: NOW },
		{ branchId: childBranchId, workId: "child-work", text: "子の思考", updatedAt: NOW },
		{
			id: childOccId,
			workId: "child-work",
			parentOccurrenceId: parent.occurrenceId,
			orderKey: 2048,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: childBranchId },
		},
	);

	const service = new ComparisonService(store);
	const expectedLinkId = `implicit:from:${JSON.stringify(["parent-work", "child-work"])}`;
	const projection = await service.resolveLink(expectedLinkId);
	assertEquals(projection.linkId, expectedLinkId);
	assertEquals(projection.type, "FROM");
	assertEquals(projection.direction, "directed");
	assertEquals(projection.left.workId, "parent-work");
	assertEquals(projection.left.title, "親の思考");
	assertEquals(projection.right.workId, "child-work");
	assertEquals(projection.right.title, "子の思考");
});

Deno.test("comparison rejects unsupported links without creating graph data", async () => {
	const store = new MemoryGraphStore();
	await createWork(store, "a", "A");
	await createWork(store, "b", "B");
	await createWork(store, "c", "C");
	await createLink(store, {
		id: "related",
		type: "RELATED",
		from: { scope: "work", workId: "a" },
		to: { scope: "work", workId: "b" },
	});
	const before = await store.listLinks();

	await assertRejects(
		() => new ComparisonService(store).resolveLink("related"),
		Error,
		"cannot be compared",
	);
	assertEquals(await store.listLinks(), before);
	assertEquals(await store.listRevisions(), []);
});

Deno.test("comparison rejects a Revision endpoint whose owner scope does not match", async () => {
	const store = new MemoryGraphStore();
	await createWork(store, "a", "A");
	await createWork(store, "b", "B");
	await createWork(store, "c", "C");
	await store.createRevision({
		id: "revision-b",
		workId: "b",
		text: "Bの固定版",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: NOW,
	}, "branch-b");
	await createLink(store, {
		id: "invalid-scope",
		type: "FIX",
		from: { scope: "work", workId: "c" },
		to: { scope: "revision", workId: "a", revisionId: "revision-b" },
	});

	await assertRejects(
		() => new ComparisonService(store).resolveLink("invalid-scope"),
		Error,
		"Revision endpoint is invalid",
	);
});

Deno.test("comparison defensively rejects legacy self-links", async () => {
	const store = new MemoryGraphStore();
	await createWork(store, "same", "同じ項目");
	await createLink(store, {
		id: "legacy-self-link",
		type: "VS",
		from: { scope: "work", workId: "same" },
		to: { scope: "work", workId: "same" },
	});

	await assertRejects(
		() => new ComparisonService(store).resolveLink("legacy-self-link"),
		Error,
		"same Work",
	);
});

Deno.test("Work comparison candidates expose Branch Working Copies and fixed Revisions read-only", async () => {
	const store = new MemoryGraphStore();
	const main = await createWork(store, "work", "mainの編集中本文");
	await store.createBranch(
		{
			id: "branch-draft",
			workId: "work",
			name: "別稿",
			headRevisionId: null,
			createdAt: NOW,
		},
		{
			branchId: "branch-draft",
			workId: "work",
			text: "別稿のWorking Copy",
			updatedAt: NOW,
		},
	);
	await store.createRevision({
		id: "revision-head",
		workId: "work",
		text: "確定版本文",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: NOW,
		message: "公開版",
	}, main.branchId);

	const beforeBranches = await store.listBranches("work");
	const beforeCopies = await store.listWorkingCopies("work");
	const result = await new ComparisonService(store).listWorkDocuments("work");

	assertEquals(
		result.documents.map((document) => ({
			scope: document.scope,
			branchId: document.branchId,
			revisionId: document.revisionId,
			title: document.title,
			text: document.text,
		})),
		[
			{
				scope: "branch",
				branchId: "branch-work",
				revisionId: undefined,
				title: "main",
				text: "mainの編集中本文",
			},
			{
				scope: "branch",
				branchId: "branch-draft",
				revisionId: undefined,
				title: "別稿",
				text: "別稿のWorking Copy",
			},
			{
				scope: "revision",
				branchId: undefined,
				revisionId: "revision-head",
				title: "公開版",
				text: "確定版本文",
			},
		],
	);
	assertEquals(await store.listBranches("work"), beforeBranches);
	assertEquals(await store.listWorkingCopies("work"), beforeCopies);
});
