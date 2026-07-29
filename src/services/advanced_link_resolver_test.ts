import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { OutlineService } from "./outline_service.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";

Deno.test("Advanced Link resolves exact names, search aliases, short IDs, and unplaced Works", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const exact = await service.createItem({ text: "Exact name\nbody", parentId: null });
	const aliasTarget = await service.createItem({ text: "Canonical", parentId: null });
	const unplaced = await service.quickCapture("Unplaced target");
	await service.saveSearchAlias({ canonical: "Canonical", variants: ["別名"] });

	let resolved = await service.resolveAdvancedLink("Exact name :: SUPPORT :: 別名");
	assertEquals(resolved.source.selectedWorkId, exact.workId);
	assertEquals(resolved.source.candidates[0].matchKind, "exact");
	assertEquals(resolved.target.selectedWorkId, aliasTarget.workId);
	assertEquals(resolved.target.candidates[0].matchKind, "alias");

	resolved = await service.resolveAdvancedLink(
		`${exact.workId.slice(0, 8)} :: CITE :: ${unplaced.workId.slice(0, 8)}`,
	);
	assertEquals(resolved.source.candidates[0].matchKind, "short-id");
	assertEquals(resolved.target.selectedWorkId, unplaced.workId);
	assertEquals(resolved.target.candidates[0].unplaced, true);
	assertEquals(resolved.target.candidates[0].placements, []);
});

Deno.test("Advanced Link keeps duplicate names ambiguous and returns all identifiable placements", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const root = await service.createItem({ text: "Root", parentId: null });
	const first = await service.createItem({ text: "Duplicate", parentId: root.id });
	const second = await service.createItem({ text: "Duplicate", parentId: null });
	await service.createOccurrence({
		workId: first.workId,
		parentId: second.id,
		contextualHeading: "Second placement",
	});
	const target = await service.createItem({ text: "Target", parentId: null });

	const resolved = await service.resolveAdvancedLink("Duplicate :: RELATED :: Target");
	assertEquals(resolved.source.status, "ambiguous");
	assertEquals(resolved.source.selectedWorkId, undefined);
	assertEquals(resolved.source.candidates.length, 2);
	const firstCandidate = resolved.source.candidates.find((candidate) =>
		candidate.workId === first.workId
	)!;
	assertEquals(firstCandidate.placements.length, 2);
	assertEquals(firstCandidate.placements.map((placement) => placement.breadcrumb), [
		["Duplicate", "Second placement"],
		["Root", "Duplicate"],
	]);
	assertEquals(
		firstCandidate.placements.every((placement) => Boolean(placement.occurrenceId)),
		true,
	);
	assertEquals(firstCandidate.shortId, first.workId.slice(0, 8));
	assertMatch(firstCandidate.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
	assertEquals(resolved.target.selectedWorkId, target.workId);
	assertEquals(resolved.preview, undefined);
});

Deno.test("Advanced Link selected Work token survives a display-name rename", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const source = await service.createItem({ text: "Before rename", parentId: null });
	await service.createItem({ text: "Target", parentId: null });
	const first = await service.resolveAdvancedLink("Before rename :: FROM :: Target");
	await service.updateItemText(source.id, "After rename");

	const second = await service.resolveAdvancedLink("Before rename :: FROM :: Target", {
		sourceWorkId: first.source.selectedWorkId,
	});
	assertEquals(second.source.selectedWorkId, source.workId);
	assertEquals(second.source.candidates[0].displayName, "After rename");
	assertEquals(second.source.candidates[0].matchKind, "selected");
	assertEquals(second.preview, "「After rename」は「Target」から派生します。");
});

Deno.test("Advanced Link resolver is read-only for unresolved names and never creates a Stub", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	await service.createItem({ text: "Known", parentId: null });
	const before = {
		works: await store.listWorks(),
		occurrences: await store.listOccurrences(),
		links: await store.listLinks(),
	};

	const resolved = await service.resolveAdvancedLink("Missing :: FIX :: Also missing");
	assertEquals(resolved.source.status, "unresolved");
	assertEquals(resolved.target.status, "unresolved");
	assertEquals(await store.listWorks(), before.works);
	assertEquals(await store.listOccurrences(), before.occurrences);
	assertEquals(await store.listLinks(), before.links);
	assertEquals((await store.listItems()).some((item) => item.referenceStub), false);
});

Deno.test("Advanced Link preview follows canonical directed and symmetric semantics", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	await service.createItem({ text: "Source", parentId: null });
	await service.createItem({ text: "Target", parentId: null });

	assertEquals(
		(await service.resolveAdvancedLink("Source :: SUPPORT :: Target")).preview,
		"「Source」は「Target」を支持します。",
	);
	assertEquals(
		(await service.resolveAdvancedLink("Source :: RELATED :: Target")).preview,
		"「Source」と「Target」は関連します。",
	);
});
