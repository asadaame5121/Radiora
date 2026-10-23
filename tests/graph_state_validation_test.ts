import { assertEquals, assertExists, assertNotStrictEquals, assertThrows } from "jsr:@std/assert@1";
import { BUILT_IN_RELATION_TYPES } from "../src/domain/relation_type.ts";
import { validatedGraphStateSnapshot } from "../src/storage/graph_state_validation.ts";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";

Deno.test("validatedGraphStateSnapshot keeps container, catalog, ID collision, and record error order", async () => {
	const base = await new MemoryGraphStore().exportGraphState();
	const invalidWork = { id: "duplicate", createdAt: "invalid", updatedAt: "invalid" };

	const expectSnapshotError = (overrides: Record<string, unknown>, message: string) => {
		assertThrows(() => validatedGraphStateSnapshot({ ...base, ...overrides }), Error, message);
	};

	expectSnapshotError(
		{ works: null, relationTypeDefinitions: "invalid" },
		"Backup data.works must be an array",
	);
	expectSnapshotError(
		{ works: [invalidWork, invalidWork], relationTypeDefinitions: "invalid" },
		"Relation type definitions must be an array",
	);
	expectSnapshotError(
		{ works: [invalidWork, invalidWork], branches: [{}] },
		"Work ID collision: duplicate",
	);
	expectSnapshotError(
		{ works: [invalidWork], branches: [{ id: "branch-invalid" }] },
		"Invalid Work: duplicate",
	);
});

Deno.test("validatedGraphStateSnapshot returns a separate snapshot and preserves nested input", async () => {
	const base = await new MemoryGraphStore().exportGraphState();
	const input = {
		...base,
		works: [{
			id: "work-1",
			createdAt: "2026-09-01T00:00:00.000Z",
			updatedAt: "2026-09-01T00:00:00.000Z",
		}],
		relationTypeDefinitions: [...BUILT_IN_RELATION_TYPES],
	};
	const original = structuredClone(input);
	const validated = validatedGraphStateSnapshot(input);

	assertEquals(validated, input);
	assertEquals(input, original);
	assertNotStrictEquals(validated, input);
	assertNotStrictEquals(validated.works[0], input.works[0]);
	assertExists(validated.relationTypeDefinitions);
	assertNotStrictEquals(validated.relationTypeDefinitions[0], input.relationTypeDefinitions[0]);

	const invalidInput = { ...input, works: [input.works[0], input.works[0]] };
	const invalidOriginal = structuredClone(invalidInput);
	assertThrows(
		() => validatedGraphStateSnapshot(invalidInput),
		Error,
		"Work ID collision: work-1",
	);
	assertEquals(invalidInput, invalidOriginal);
	assertEquals(input, original);
});

Deno.test("snapshot revision validation keeps shape and parent errors ahead of DAG cycles", async () => {
	const base = await new MemoryGraphStore().exportGraphState();
	const now = "2026-09-01T00:00:00.000Z";
	const work = { id: "work-1", createdAt: now, updatedAt: now };
	const first = {
		id: "r1",
		workId: work.id,
		text: "",
		parentRevisionIds: ["r2"],
		kind: "edition",
		createdAt: now,
	};
	const second = { ...first, id: "r2", parentRevisionIds: ["r1"] };
	const snapshot = { ...base, works: [work], revisions: [first, second] };
	const original = structuredClone(snapshot);

	assertThrows(
		() =>
			validatedGraphStateSnapshot({
				...snapshot,
				revisions: [{ ...first, kind: "invalid" }, second],
			}),
		Error,
		"Invalid Revision: r1",
	);
	assertThrows(
		() =>
			validatedGraphStateSnapshot({
				...snapshot,
				revisions: [{ ...first, parentRevisionIds: ["missing"] }, second],
			}),
		Error,
		"Invalid Revision parent: r1",
	);
	assertThrows(() => validatedGraphStateSnapshot(snapshot), Error, "Revision cycle: r1");
	assertEquals(snapshot, original);
});
