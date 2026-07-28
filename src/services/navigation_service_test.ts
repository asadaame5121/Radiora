import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { Bookmark, Occurrence } from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { NavigationService } from "./navigation_service.ts";

const NOW = "2026-07-29T00:00:00.000Z";

Deno.test("bookmarks and resume are independent and resolve without mutating content or placement", async () => {
	const store = new MemoryGraphStore();
	const root = await bundle(store, "root", "root text", null, 1, true);
	const child = await bundle(store, "child", "child text", root, 2, false);
	const service = new NavigationService(store, () => "bookmark", () => NOW);
	const bookmark = await service.createBookmark(child);
	await service.saveResumePosition(root, 4);
	const before = {
		items: await store.listItems(),
		occurrences: await store.listOccurrences(),
	};

	const resolved = await service.resolveBookmark(bookmark.id);

	assertEquals(resolved.target, {
		kind: "occurrence",
		workId: "child",
		occurrenceId: child,
		ancestorOccurrenceIds: [root],
		fellBack: false,
	});
	assertEquals((await service.resolveResumePosition())?.position.occurrenceId, root);
	assertEquals(await store.listItems(), before.items);
	assertEquals(await store.listOccurrences(), before.occurrences);
});

Deno.test("missing preferred Occurrence falls back stably within the same Work, then to Work", async () => {
	const store = new MemoryGraphStore();
	const preferred = await bundle(store, "work", "text", null, 50, false);
	const later = await occurrence(store, "work", "later", 10);
	const stable = await occurrence(store, "work", "stable", 10);
	const service = new NavigationService(store, () => "bookmark", () => NOW);
	const bookmark = await service.createBookmark(preferred);
	await store.deleteOccurrence(preferred);

	const fallback = await service.resolveBookmark(bookmark.id);
	assertEquals(fallback.target.kind, "occurrence");
	assertEquals(fallback.target.kind === "occurrence" && fallback.target.occurrenceId, later);
	assertEquals(fallback.target.fellBack, true);

	await store.deleteOccurrence(later);
	await store.deleteOccurrence(stable);
	assertEquals((await service.resolveBookmark(bookmark.id)).target, {
		kind: "work",
		workId: "work",
		fellBack: true,
	});
});

Deno.test("invalid caret and missing Work fail without replacing the previous resume", async () => {
	const store = new CorruptibleMemoryGraphStore();
	const occurrenceId = await bundle(store, "work", "text", null, 1, false);
	const service = new NavigationService(store, () => "bookmark", () => NOW);
	await service.saveResumePosition(occurrenceId, 4);
	await service.saveResumePosition(occurrenceId, 5);
	await assertRejects(() => service.saveResumePosition(occurrenceId, -1), Error, "Invalid caret");
	assertEquals((await store.getResumePosition())?.caretOffset, 5);

	store.injectBookmark({
		id: "missing",
		workId: "missing-work",
		occurrenceId: "missing-occurrence",
		createdAt: NOW,
	});
	await assertRejects(() => service.resolveBookmark("missing"), Error, "Work not found");
	assertEquals((await store.getResumePosition())?.caretOffset, 5);
});

Deno.test("resume resolution clamps a stale caret without changing the stored offset", async () => {
	const store = new MemoryGraphStore();
	const occurrenceId = await bundle(store, "work", "long text", null, 1, false);
	const service = new NavigationService(store, () => "bookmark", () => NOW);
	await service.saveResumePosition(occurrenceId, 9);
	await store.updateWorkingCopy("work", "tiny", NOW);

	const resolved = await service.resolveResumePosition();
	assertEquals(resolved?.resolvedCaretOffset, 4);
	assertEquals(resolved?.position.caretOffset, 9);
	assertEquals((await store.getResumePosition())?.caretOffset, 9);
});

class CorruptibleMemoryGraphStore extends MemoryGraphStore {
	injectBookmark(bookmark: Bookmark): void {
		this.bookmarks.push(bookmark);
	}

	override listBookmarks(): Promise<Bookmark[]> {
		return Promise.resolve(structuredClone(this.bookmarks));
	}
}

async function bundle(
	store: MemoryGraphStore,
	workId: string,
	text: string,
	parentOccurrenceId: string | null,
	orderKey: number,
	collapsed: boolean,
): Promise<string> {
	const occurrenceId = `${workId}-occurrence`;
	await store.createWorkBundle(
		{ id: workId, createdAt: NOW, updatedAt: NOW },
		{ id: workId, workId, name: "main", headRevisionId: null, createdAt: NOW },
		{ branchId: workId, workId, text, updatedAt: NOW },
		{
			id: occurrenceId,
			workId,
			parentOccurrenceId,
			orderKey,
			collapsed,
			revisionSelector: { mode: "branch", branchId: workId },
		},
	);
	return occurrenceId;
}

async function occurrence(
	store: MemoryGraphStore,
	workId: string,
	id: string,
	orderKey: number,
): Promise<string> {
	const value: Occurrence = {
		id,
		workId,
		parentOccurrenceId: null,
		orderKey,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: workId },
	};
	await store.createOccurrence(value);
	return id;
}
