import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { OutlineService } from "../services/outline_service.ts";
import { RevisionService } from "../services/revision_service.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import type { StartupStatus } from "../shared/bindings.ts";
import { createBindingHandlers } from "./register_bindings.ts";

Deno.test("Phase 1 desktop bindings preserve Work and Occurrence semantics end to end", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const ready: StartupStatus = { phase: "ready", message: "ready" };
	const handlers = createBindingHandlers({
		getService: () => service,
		getStartupStatus: () => ready,
		retryStartup: () => Promise.resolve(ready),
		rewriteAsNewBranch: (sourceBranchId, name, confirmation) =>
			new RevisionService(store).rewriteAsNewBranch(sourceBranchId, name, confirmation),
	});

	const source = await handlers.createItem({ text: "共有前", parentId: null });
	const target = await handlers.createItem({ text: "Target", parentId: null });
	const mirror = await handlers.createOccurrence({
		workId: source.workId,
		parentId: target.id,
		contextualHeading: "別文脈",
	});
	await handlers.updateItemText(mirror.id, "共有後");
	await handlers.setContextualHeading(mirror.id, "更新した文脈");
	await handlers.setCollapsed(mirror.id, true);
	await handlers.moveItem({ id: mirror.id, parentId: null });
	await handlers.createLink({ fromId: source.id, toId: target.id, type: "FROM" });
	assertEquals(
		(await handlers.resolveAdvancedLink("共有後 :: FROM :: Target")).source.selectedWorkId,
		source.workId,
	);
	assertEquals(
		(await handlers.listInternalReferenceCompletions("共有後")).map((candidate) => candidate.id),
		[source.workId],
	);
	assertEquals(
		(await handlers.resolveInternalReferences(
			`[共有](radiora://work/${source.workId})`,
		))[0].status,
		"resolved",
	);

	let snapshot = await handlers.listOutline();
	const placements = snapshot.items.filter((item) => item.workId === source.workId);
	assertEquals(placements.map((item) => item.text), ["共有後", "共有後"]);
	assertEquals(placements.find((item) => item.id === mirror.id)?.contextualHeading, "更新した文脈");
	assertEquals(placements.find((item) => item.id === mirror.id)?.collapsed, true);
	assertEquals(placements.find((item) => item.id === mirror.id)?.parentId, null);
	assertEquals(snapshot.links[0].fromId, source.workId);
	assertEquals(snapshot.links[0].toId, target.workId);
	assertEquals(
		(await handlers.resolveLinkComparison(snapshot.links[0].id)).left.workId,
		source.workId,
	);
	assertEquals(
		(await handlers.listWorkComparisonDocuments(source.workId)).documents[0].scope,
		"branch",
	);

	const sourceBranchId = source.revisionSelector.mode === "branch"
		? source.revisionSelector.branchId
		: "";
	await store.createRevision({
		id: "source-version",
		workId: source.workId,
		text: "読み取り専用の版",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: "2026-07-28T00:00:00.000Z",
	}, sourceBranchId);
	assertEquals((await handlers.listRevisions(source.workId)).map((revision) => revision.id), [
		"source-version",
	]);
	assertEquals(await handlers.listRevisions(target.workId), []);
	assertEquals((await handlers.listGlobalLineage()).snapshot.items.length, 2);
	assertEquals((await handlers.listWorkLineage(source.workId)).work.id, source.workId);
	assertEquals(
		(await handlers.listWorkLineage(source.workId)).revisions.map((revision) => revision.id),
		["source-version"],
	);
	const rewrite = await handlers.rewriteAsNewBranch(
		sourceBranchId,
		"別の観点",
		"confirmed",
	);
	assertEquals(rewrite.status, "created");
	assertEquals(
		(await handlers.listWorkLineage(source.workId)).branches.map((branch) => branch.name).sort(),
		["main", "別の観点"],
	);

	await handlers.trashWork(source.id);
	assertEquals((await handlers.listTrash())[0].occurrenceCount, 2);
	await handlers.restoreWork(source.workId);
	snapshot = await handlers.listOutline();
	assertEquals(snapshot.items.filter((item) => item.workId === source.workId).length, 2);

	await handlers.trashWork(source.id);
	const manifest = await handlers.purgeWork(source.workId);
	assertEquals(manifest.workId, source.workId);
	assertEquals(manifest.occurrenceIds.length, 2);
	assertEquals(manifest.linkIds.length, 1);
});

Deno.test("desktop bindings expose startup failure and retry without dereferencing a service", async () => {
	const failed: StartupStatus = {
		phase: "failed",
		message: "DB migration failed",
		detail: "validation mismatch",
	};
	let retries = 0;
	const handlers = createBindingHandlers({
		getService: () => null,
		getStartupStatus: () => failed,
		retryStartup: () => {
			retries++;
			return Promise.resolve({ phase: "starting", message: "retrying" });
		},
		rewriteAsNewBranch: () => {
			throw new Error("unreachable");
		},
	});

	assertEquals(await handlers.getStartupStatus(), failed);
	assertThrows(() => handlers.listOutline(), Error, "DB migration failed");
	assertEquals(await handlers.retryStartup(), { phase: "starting", message: "retrying" });
	assertEquals(retries, 1);
});
