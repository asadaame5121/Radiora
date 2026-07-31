import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { Branch, Occurrence, Revision, Work, WorkingCopy } from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { SemanticLinkOperations } from "./semantic_link_operations.ts";

const NOW = "2026-07-30T12:00:00.000Z";

async function addWork(store: MemoryGraphStore, id: string) {
	const work: Work = { id, createdAt: NOW, updatedAt: NOW };
	const branch: Branch = {
		id: `${id}-main`,
		workId: id,
		name: "main",
		headRevisionId: null,
		createdAt: NOW,
	};
	const copy: WorkingCopy = { branchId: branch.id, workId: id, text: id, updatedAt: NOW };
	const occurrence: Occurrence = {
		id: `${id}-occ`,
		workId: id,
		parentOccurrenceId: null,
		orderKey: 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: branch.id },
	};
	await store.createWorkBundle(work, branch, copy, occurrence);
	const revision: Revision = {
		id: `${id}-rev`,
		workId: id,
		text: id,
		parentRevisionIds: [],
		kind: "edition",
		createdAt: NOW,
	};
	await store.createRevision(revision, branch.id);
	return { occurrence, revision };
}

Deno.test("SemanticLinkOperations normalizes symmetric occurrence endpoints and avoids active duplicates", async () => {
	const store = new MemoryGraphStore();
	const alpha = await addWork(store, "alpha");
	const beta = await addWork(store, "beta");
	const operations = new SemanticLinkOperations(store);

	await operations.createLink({
		fromId: beta.occurrence.id,
		toId: alpha.occurrence.id,
		type: "LIKE",
		status: "provisional",
		origin: "suggestion",
		reason: "  shared title  ",
	});
	await operations.createLink({ fromId: "alpha", toId: "beta", type: "LIKE" });

	const links = await store.listLinks();
	assertEquals(links.length, 1);
	assertEquals(links[0].fromId, "alpha");
	assertEquals(links[0].toId, "beta");
	assertEquals(links[0].status, "provisional");
	assertEquals(links[0].origin, "suggestion");
	assertEquals(links[0].reason, "shared title");
});

Deno.test("SemanticLinkOperations validates revision ownership and keeps revision endpoints distinct", async () => {
	const store = new MemoryGraphStore();
	const alpha = await addWork(store, "alpha");
	const beta = await addWork(store, "beta");
	const operations = new SemanticLinkOperations(store);

	await assertRejects(
		() =>
			operations.createLink({
				fromId: "alpha",
				toId: "beta",
				type: "RELATED",
				fromEndpoint: { scope: "revision", workId: "alpha", revisionId: beta.revision.id },
			}),
		Error,
		"From Revision endpoint does not belong to its Work",
	);
	await operations.createLink({
		fromId: "alpha",
		toId: "beta",
		type: "RELATED",
		fromEndpoint: { scope: "revision", workId: "alpha", revisionId: alpha.revision.id },
	});
	await operations.createLink({
		fromId: "alpha",
		toId: "beta",
		type: "RELATED",
	});
	assertEquals((await store.listLinks()).length, 2);
});

Deno.test("SemanticLinkOperations retracts symmetric links when deleting through reversed occurrence ids", async () => {
	const store = new MemoryGraphStore();
	const alpha = await addWork(store, "alpha");
	const beta = await addWork(store, "beta");
	const operations = new SemanticLinkOperations(store);
	await operations.createLink({ fromId: "alpha", toId: "beta", type: "RELATED" });

	await operations.deleteLink(beta.occurrence.id, alpha.occurrence.id, "RELATED");
	assertEquals((await store.listLinks())[0].status, "retracted");
});
