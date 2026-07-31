import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type {
	Branch,
	Occurrence,
	OutlineItem,
	Revision,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { ManuscriptProjectionService } from "./manuscript_projection.ts";

const NOW = "2026-07-30T12:00:00.000Z";

async function addWork(
	store: MemoryGraphStore,
	id: string,
	text: string,
	parentOccurrenceId: string | null = null,
	orderKey = 1024,
	contextualHeading?: string,
) {
	const work: Work = { id, createdAt: NOW, updatedAt: NOW };
	const branch: Branch = {
		id: `${id}-main`,
		workId: id,
		name: "main",
		headRevisionId: null,
		createdAt: NOW,
	};
	const copy: WorkingCopy = { branchId: branch.id, workId: id, text, updatedAt: NOW };
	const occurrence: Occurrence = {
		id: `${id}-occ`,
		workId: id,
		parentOccurrenceId,
		orderKey,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: branch.id },
		contextualHeading,
	};
	await store.createWorkBundle(work, branch, copy, occurrence);
	return { work, branch, occurrence };
}

Deno.test("ManuscriptProjectionService projects one ordered Occurrence subtree with depth", async () => {
	const store = new MemoryGraphStore();
	const root = await addWork(store, "root", "Root\nroot body");
	const later = await addWork(store, "later", "Later\nlater body", root.occurrence.id, 20);
	const first = await addWork(
		store,
		"first",
		"First\nfirst body",
		root.occurrence.id,
		10,
		"文脈見出し",
	);
	await addWork(store, "grandchild", "Grandchild\nbody", first.occurrence.id, 1);
	const projection = await new ManuscriptProjectionService(store).project(root.occurrence.id);

	assertEquals(
		projection.map(({ occurrenceId, depth, heading, body }) => ({
			occurrenceId,
			depth,
			heading,
			body,
		})),
		[
			{ occurrenceId: root.occurrence.id, depth: 0, heading: "Root", body: "root body" },
			{
				occurrenceId: first.occurrence.id,
				depth: 1,
				heading: "文脈見出し",
				body: "First\nfirst body",
			},
			{ occurrenceId: "grandchild-occ", depth: 2, heading: "Grandchild", body: "body" },
			{ occurrenceId: later.occurrence.id, depth: 1, heading: "Later", body: "later body" },
		],
	);
});

Deno.test("ManuscriptProjectionService respects selected branch and pinned revision text and current ordering", async () => {
	const store = new MemoryGraphStore();
	const root = await addWork(store, "root", "Root");
	const branch = await addWork(store, "branch", "Branch current", root.occurrence.id, 20);
	const pinned = await addWork(store, "pinned", "Pinned current", root.occurrence.id, 10);
	const revision: Revision = {
		id: "pinned-revision",
		workId: pinned.work.id,
		text: "Pinned revision",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: NOW,
	};
	await store.createRevision(revision, pinned.branch.id);
	await store.updateOccurrence({
		...pinned.occurrence,
		revisionSelector: { mode: "pinned", revisionId: revision.id },
	});
	await store.updateOccurrence({ ...branch.occurrence, orderKey: 5 });
	const projection = await new ManuscriptProjectionService(store).project(root.occurrence.id);

	assertEquals(
		projection.slice(1).map((section) => [section.workId, section.text, section.revisionSelector]),
		[
			["branch", "Branch current", { mode: "branch", branchId: branch.branch.id }],
			["pinned", "Pinned revision", { mode: "pinned", revisionId: revision.id }],
		],
	);
});

Deno.test("ManuscriptProjectionService does not traverse reference stubs or write to the source", async () => {
	const root: OutlineItem = {
		id: "root",
		workId: "work-root",
		text: "Root",
		parentId: null,
		orderKey: 1,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "root-main" },
		createdAt: NOW,
		updatedAt: NOW,
	};
	const stub: OutlineItem = {
		...root,
		id: "stub",
		workId: "work-stub",
		text: "Stub",
		parentId: root.id,
		referenceStub: true,
	};
	const hiddenChild: OutlineItem = {
		...root,
		id: "hidden",
		workId: "work-hidden",
		text: "Hidden",
		parentId: stub.id,
	};
	let reads = 0;
	const source = {
		listItems: async () => {
			reads++;
			return [root, stub, hiddenChild];
		},
	};
	const service = new ManuscriptProjectionService(source);
	assertEquals((await service.project(root.id)).map((section) => section.occurrenceId), [
		"root",
		"stub",
	]);
	assertEquals(reads, 1);
	await assertRejects(
		() => service.project("missing"),
		Error,
		"Manuscript root Occurrence not found: missing",
	);
});
