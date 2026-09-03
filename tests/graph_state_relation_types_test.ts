import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { LinkType, OutlineLink, Work } from "../src/domain/models.ts";
import {
	BUILT_IN_RELATION_TYPES,
	type RelationTypeDefinition,
} from "../src/domain/relation_type.ts";
import { validatedGraphStateSnapshot } from "../src/storage/graph_state_validation.ts";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";

Deno.test("validatedGraphStateSnapshot injects built-in relation types for legacy snapshots without mutating input", async () => {
	const store = new MemoryGraphStore();
	const exported = await store.exportGraphState();
	const { relationTypeDefinitions: _, ...legacySnapshot } = exported;

	assertEquals("relationTypeDefinitions" in legacySnapshot, false);

	const validated = validatedGraphStateSnapshot(legacySnapshot);

	assertEquals("relationTypeDefinitions" in legacySnapshot, false);
	assertEquals(validated.relationTypeDefinitions, BUILT_IN_RELATION_TYPES);
	assertEquals(
		validated.relationTypeDefinitions?.length,
		BUILT_IN_RELATION_TYPES.length,
	);
});

Deno.test("validatedGraphStateSnapshot preserves valid custom relation type definitions", async () => {
	const store = new MemoryGraphStore();
	const baseSnapshot = await store.exportGraphState();

	const customDef: RelationTypeDefinition = {
		name: "CUSTOM_RELATION",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};

	const snapshotWithCatalog = {
		...baseSnapshot,
		relationTypeDefinitions: [...BUILT_IN_RELATION_TYPES, customDef],
	};

	const validated = validatedGraphStateSnapshot(snapshotWithCatalog);

	assertEquals(validated.relationTypeDefinitions, [
		...BUILT_IN_RELATION_TYPES,
		customDef,
	]);
});

Deno.test("validatedGraphStateSnapshot rejects explicitly present undefined or malformed catalog", async () => {
	const store = new MemoryGraphStore();
	const baseSnapshot = await store.exportGraphState();

	assertThrows(
		() =>
			validatedGraphStateSnapshot({
				...baseSnapshot,
				relationTypeDefinitions: undefined,
			}),
		Error,
	);

	assertThrows(
		() =>
			validatedGraphStateSnapshot({
				...baseSnapshot,
				relationTypeDefinitions: "not-an-array",
			}),
		Error,
	);

	assertThrows(
		() =>
			validatedGraphStateSnapshot({
				...baseSnapshot,
				relationTypeDefinitions: [
					...BUILT_IN_RELATION_TYPES,
					{
						name: "INVALID_LOWER",
						direction: "directed",
						builtIn: true,
						createdAt: "2026-09-01T00:00:00.000Z",
					},
				],
			}),
		Error,
	);
});

Deno.test("validatedGraphStateSnapshot accepts custom links matching catalog and rejects unregistered link types", async () => {
	const store = new MemoryGraphStore();
	const base = await store.exportGraphState();

	const customDef: RelationTypeDefinition = {
		name: "CUSTOM_REL",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};

	const NOW = "2026-09-01T00:00:00.000Z";
	const works: Work[] = [
		{ id: "work-1", createdAt: NOW, updatedAt: NOW },
		{ id: "work-2", createdAt: NOW, updatedAt: NOW },
	];

	const customLink: OutlineLink = {
		id: "link-1",
		fromId: "work-1",
		toId: "work-2",
		from: { scope: "work", workId: "work-1" },
		to: { scope: "work", workId: "work-2" },
		type: "CUSTOM_REL" as LinkType,
		status: "asserted",
		origin: "human",
		createdAt: NOW,
	};

	// 1. カタログ付き snapshot にカスタムリンクが含まれる場合は成功
	const validSnapshot = {
		...base,
		works,
		links: [customLink],
		relationTypeDefinitions: [...BUILT_IN_RELATION_TYPES, customDef],
	};
	const validated = validatedGraphStateSnapshot(validSnapshot);
	assertEquals(validated.links.length, 1);
	assertEquals(validated.links[0].type, "CUSTOM_REL");

	// 2. カタログ定義がない（未登録型）場合は reject
	const invalidSnapshotWithoutCatalog = {
		...base,
		works,
		links: [customLink],
	};
	assertThrows(
		() => validatedGraphStateSnapshot(invalidSnapshotWithoutCatalog),
		Error,
		"Invalid Link: link-1",
	);

	// 3. カタログ定義と不一致の未登録リンク型は reject
	const invalidSnapshotWithMismatch = {
		...base,
		works,
		links: [
			{
				...customLink,
				type: "OTHER_CUSTOM" as LinkType,
			},
		],
		relationTypeDefinitions: [...BUILT_IN_RELATION_TYPES, customDef],
	};
	assertThrows(
		() => validatedGraphStateSnapshot(invalidSnapshotWithMismatch),
		Error,
		"Invalid Link: link-1",
	);
});
