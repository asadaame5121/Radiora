import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { Branch, Occurrence, Work, WorkingCopy } from "../../src/domain/models.ts";
import type { GraphStore } from "../../src/storage/graph_store.ts";

const CREATED_AT = "2026-07-28T00:00:00.000Z";
const UPDATED_AT = "2026-07-28T00:01:00.000Z";
const DELETED_AT = "2026-07-28T00:02:00.000Z";

export async function assertGraphStoreContract(store: GraphStore): Promise<void> {
	const root = bundle("contract root");
	const target = bundle("contract target");
	const dependent = bundle("contract dependent");
	dependent.occurrence.parentOccurrenceId = root.occurrence.id;
	const mirror: Occurrence = {
		id: crypto.randomUUID(),
		workId: root.work.id,
		parentOccurrenceId: target.occurrence.id,
		orderKey: 2048,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: root.branch.id },
		contextualHeading: "mirror",
	};

	await store.createWorkBundle(root.work, root.branch, root.copy, root.occurrence);
	await store.createWorkBundle(target.work, target.branch, target.copy, target.occurrence);
	await store.createWorkBundle(
		dependent.work,
		dependent.branch,
		dependent.copy,
		dependent.occurrence,
	);
	await store.createOccurrence(mirror);
	await store.updateWorkingCopy(root.work.id, "contract root updated", UPDATED_AT);
	await store.updateOccurrence({ ...mirror, collapsed: true, contextualHeading: "mirror updated" });

	const rootItems = (await store.listItems()).filter((item) => item.workId === root.work.id);
	assertEquals(rootItems.length, 2);
	assert(rootItems.every((item) => item.text === "contract root updated"));
	assertEquals(rootItems.find((item) => item.id === mirror.id)?.parentId, target.occurrence.id);
	assertEquals(rootItems.find((item) => item.id === mirror.id)?.collapsed, true);
	assertEquals(
		rootItems.find((item) => item.id === mirror.id)?.contextualHeading,
		"mirror updated",
	);

	const linkId = crypto.randomUUID();
	await store.createLink({
		id: linkId,
		fromId: root.work.id,
		toId: target.work.id,
		from: { scope: "work", workId: root.work.id },
		to: { scope: "work", workId: target.work.id },
		type: "SUPPORT",
		status: "asserted",
		origin: "human",
		reason: "contract",
		createdAt: CREATED_AT,
	});
	const link = (await store.listLinks()).find((candidate) => candidate.id === linkId);
	assertEquals(link?.from.workId, root.work.id);
	assertEquals(link?.to.workId, target.work.id);
	assertEquals(link?.reason, "contract");

	const aliasId = crypto.randomUUID();
	await store.upsertAlias({
		id: aliasId,
		canonical: "contract",
		variants: ["agreement"],
		createdAt: CREATED_AT,
		updatedAt: UPDATED_AT,
	});
	assertEquals(
		(await store.listAliases()).find((alias) => alias.id === aliasId)?.variants,
		["agreement"],
	);
	await store.setEmergenceFeedback(aliasId, "pin");
	assertEquals(await store.getEmergenceFeedback(aliasId), "pin");

	const queryId = crypto.randomUUID();
	await store.upsertSavedRuleQuery({
		id: queryId,
		name: "Contract query",
		source: '?- link("SUPPORT", From, To).',
		createdAt: CREATED_AT,
		updatedAt: UPDATED_AT,
	});
	assertEquals(
		(await store.listSavedRuleQueries()).find((query) => query.id === queryId)?.name,
		"Contract query",
	);

	assert(
		(await store.suggestItems("contract root", 8)).some((item) => item.workId === root.work.id),
	);
	assert((await store.searchLexical("updated", 8)).some((hit) => hit.item.workId === root.work.id));
	await assertRejects(
		() => store.purgeWork(root.work.id),
		Error,
		"Work must be in trash before it can be purged",
	);

	await store.trashWork(root.work.id, DELETED_AT);
	assertEquals((await store.listWorks()).some((work) => work.id === root.work.id), false);
	assertEquals((await store.listItems()).some((item) => item.workId === root.work.id), false);
	assertEquals(
		(await store.listWorks(true)).find((work) => work.id === root.work.id)?.deletedAt,
		DELETED_AT,
	);
	assertEquals(
		(await store.listOccurrences(true)).filter((occurrence) => occurrence.workId === root.work.id)
			.length,
		2,
	);

	await store.restoreWork(root.work.id);
	assertEquals(
		(await store.listItems()).filter((item) => item.workId === root.work.id).length,
		2,
	);
	await store.deleteOccurrence(mirror.id);
	assertEquals(
		(await store.listOccurrences()).filter((occurrence) => occurrence.workId === root.work.id)
			.length,
		1,
	);

	await store.trashWork(root.work.id, DELETED_AT);
	const manifest = await store.purgeWork(root.work.id);
	assertEquals(manifest.workId, root.work.id);
	assert(manifest.occurrenceIds.includes(root.occurrence.id));
	assert(manifest.linkIds.includes(linkId));
	assertEquals((await store.listWorks(true)).some((work) => work.id === root.work.id), false);
	assertEquals((await store.listLinks()).some((candidate) => candidate.id === linkId), false);
	assert((await store.listPurgeManifests()).some((candidate) => candidate.id === manifest.id));
	assert((await store.listWorks()).some((work) => work.id === target.work.id));
	assertEquals(
		(await store.listItems()).find((item) => item.id === dependent.occurrence.id)?.parentId,
		null,
	);

	await store.deleteAlias(aliasId);
	await store.deleteSavedRuleQuery(queryId);
	assertEquals((await store.listAliases()).some((alias) => alias.id === aliasId), false);
	assertEquals((await store.listSavedRuleQueries()).some((query) => query.id === queryId), false);
	await store.trashWork(target.work.id, DELETED_AT);
	await store.purgeWork(target.work.id);
	await store.trashWork(dependent.work.id, DELETED_AT);
	await store.purgeWork(dependent.work.id);
}

function bundle(text: string): {
	work: Work;
	branch: Branch;
	copy: WorkingCopy;
	occurrence: Occurrence;
} {
	const workId = crypto.randomUUID();
	const branchId = crypto.randomUUID();
	return {
		work: {
			id: workId,
			createdAt: CREATED_AT,
			updatedAt: CREATED_AT,
		},
		branch: {
			id: branchId,
			workId,
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		copy: {
			branchId,
			workId,
			text,
			updatedAt: CREATED_AT,
		},
		occurrence: {
			id: crypto.randomUUID(),
			workId,
			parentOccurrenceId: null,
			orderKey: 1024,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId },
		},
	};
}
