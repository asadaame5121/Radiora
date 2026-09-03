import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { BUILT_IN_RELATION_TYPES, type RelationTypeDefinition } from "../domain/relation_type.ts";
import { MemoryGraphStore } from "./memory_store.ts";

Deno.test("MemoryGraphStore exports catalog equal to built-in relation types", async () => {
	const store = new MemoryGraphStore();
	const state = await store.exportGraphState();

	assertEquals(state.relationTypeDefinitions, BUILT_IN_RELATION_TYPES);
});

Deno.test("MemoryGraphStore export is defensively cloned", async () => {
	const store = new MemoryGraphStore();
	const first = await store.exportGraphState();

	first.relationTypeDefinitions?.push({
		name: "MUTATED",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	});

	const second = await store.exportGraphState();
	assertEquals(second.relationTypeDefinitions, BUILT_IN_RELATION_TYPES);
});

Deno.test("MemoryGraphStore restores custom catalog and defensively clones input", async () => {
	const store = new MemoryGraphStore();
	const base = await store.exportGraphState();

	const customDef: RelationTypeDefinition = {
		name: "CUSTOM_REL",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};

	const inputCatalog = [...BUILT_IN_RELATION_TYPES, customDef];
	await store.restoreGraphState({
		...base,
		relationTypeDefinitions: inputCatalog,
	});

	customDef.name = "CHANGED_AFTER";
	inputCatalog.pop();

	const exported = await store.exportGraphState();
	assertEquals(exported.relationTypeDefinitions, [
		...BUILT_IN_RELATION_TYPES,
		{
			name: "CUSTOM_REL",
			direction: "directed",
			builtIn: false,
			createdAt: "2026-09-01T00:00:00.000Z",
		},
	]);
});

Deno.test("MemoryGraphStore preserves prior catalog when restore fails validation", async () => {
	const store = new MemoryGraphStore();
	const base = await store.exportGraphState();

	const customDef: RelationTypeDefinition = {
		name: "CUSTOM_REL",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};
	await store.restoreGraphState({
		...base,
		relationTypeDefinitions: [...BUILT_IN_RELATION_TYPES, customDef],
	});

	const priorState = await store.exportGraphState();

	await assertRejects(
		() =>
			store.restoreGraphState({
				...base,
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

	const afterState = await store.exportGraphState();
	assertEquals(afterState.relationTypeDefinitions, priorState.relationTypeDefinitions);
});

Deno.test("MemoryGraphStore listRelationTypeDefinitions returns built-ins and is defensively cloned", async () => {
	const store = new MemoryGraphStore();
	const list = await store.listRelationTypeDefinitions();
	assertEquals(list, BUILT_IN_RELATION_TYPES);

	list.push({
		name: "MUTATED",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	});
	const second = await store.listRelationTypeDefinitions();
	assertEquals(second, BUILT_IN_RELATION_TYPES);
});

Deno.test("MemoryGraphStore createRelationTypeDefinition adds custom definition and list returns it", async () => {
	const store = new MemoryGraphStore();
	const customDef: RelationTypeDefinition = {
		name: "CUSTOM_REL",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};
	await store.createRelationTypeDefinition(customDef);

	customDef.name = "CHANGED_AFTER";

	const list = await store.listRelationTypeDefinitions();
	assertEquals(list, [
		...BUILT_IN_RELATION_TYPES,
		{
			name: "CUSTOM_REL",
			direction: "directed",
			builtIn: false,
			createdAt: "2026-09-01T00:00:00.000Z",
		},
	]);
});

Deno.test("MemoryGraphStore createRelationTypeDefinition rejects invalid or duplicate definitions atomically", async () => {
	const store = new MemoryGraphStore();
	const validDef: RelationTypeDefinition = {
		name: "CUSTOM_REL",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};
	await store.createRelationTypeDefinition(validDef);
	const prior = await store.listRelationTypeDefinitions();

	await assertRejects(
		() => store.createRelationTypeDefinition({ ...validDef }),
		Error,
	);

	await assertRejects(
		() =>
			store.createRelationTypeDefinition({
				name: "RELATED",
				direction: "symmetric",
				builtIn: false,
				createdAt: "2026-09-01T00:00:00.000Z",
			}),
		Error,
	);

	await assertRejects(
		() =>
			store.createRelationTypeDefinition({
				name: "INVALID_DIR",
				direction: "both" as unknown as "directed",
				builtIn: false,
				createdAt: "2026-09-01T00:00:00.000Z",
			}),
		Error,
	);

	await assertRejects(
		() =>
			store.createRelationTypeDefinition({
				name: "lowercase",
				direction: "directed",
				builtIn: false,
				createdAt: "2026-09-01T00:00:00.000Z",
			}),
		Error,
	);

	const after = await store.listRelationTypeDefinitions();
	assertEquals(after, prior);
});

Deno.test("MemoryGraphStore mergeWorks deduplicates custom symmetric links", async () => {
	const store = new MemoryGraphStore();
	await store.initialize();
	await store.createRelationTypeDefinition({
		name: "COLLABORATES",
		direction: "symmetric",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	});

	await store.createWorkBundle(
		{
			id: "work-source",
			createdAt: "2026-09-01T00:00:00.000Z",
			updatedAt: "2026-09-01T00:00:00.000Z",
		},
		{
			id: "b-src",
			workId: "work-source",
			name: "main",
			headRevisionId: null,
			createdAt: "2026-09-01T00:00:00.000Z",
		},
		{
			branchId: "b-src",
			workId: "work-source",
			text: "Source",
			updatedAt: "2026-09-01T00:00:00.000Z",
		},
		{
			id: "occ-src",
			workId: "work-source",
			revisionSelector: { mode: "branch", branchId: "b-src" },
			parentOccurrenceId: null,
			orderKey: 1,
			collapsed: false,
		},
	);
	await store.createWorkBundle(
		{
			id: "work-survivor",
			createdAt: "2026-09-01T00:00:00.000Z",
			updatedAt: "2026-09-01T00:00:00.000Z",
		},
		{
			id: "b-surv",
			workId: "work-survivor",
			name: "main",
			headRevisionId: null,
			createdAt: "2026-09-01T00:00:00.000Z",
		},
		{
			branchId: "b-surv",
			workId: "work-survivor",
			text: "Survivor",
			updatedAt: "2026-09-01T00:00:00.000Z",
		},
		{
			id: "occ-surv",
			workId: "work-survivor",
			revisionSelector: { mode: "branch", branchId: "b-surv" },
			parentOccurrenceId: null,
			orderKey: 2,
			collapsed: false,
		},
	);
	await store.createWorkBundle(
		{
			id: "work-other",
			createdAt: "2026-09-01T00:00:00.000Z",
			updatedAt: "2026-09-01T00:00:00.000Z",
		},
		{
			id: "b-other",
			workId: "work-other",
			name: "main",
			headRevisionId: null,
			createdAt: "2026-09-01T00:00:00.000Z",
		},
		{
			branchId: "b-other",
			workId: "work-other",
			text: "Other",
			updatedAt: "2026-09-01T00:00:00.000Z",
		},
		{
			id: "occ-other",
			workId: "work-other",
			revisionSelector: { mode: "branch", branchId: "b-other" },
			parentOccurrenceId: null,
			orderKey: 3,
			collapsed: false,
		},
	);

	await store.createLink({
		id: "link-1",
		fromId: "work-survivor",
		toId: "work-other",
		from: { scope: "work", workId: "work-survivor" },
		to: { scope: "work", workId: "work-other" },
		type: "COLLABORATES",
		status: "asserted",
		origin: "human",
		createdAt: "2026-09-01T00:00:00.000Z",
	});

	await store.createLink({
		id: "link-2",
		fromId: "work-other",
		toId: "work-source",
		from: { scope: "work", workId: "work-other" },
		to: { scope: "work", workId: "work-source" },
		type: "COLLABORATES",
		status: "asserted",
		origin: "human",
		createdAt: "2026-09-01T00:00:00.000Z",
	});

	await store.mergeWorks({
		sourceWorkId: "work-source",
		survivorWorkId: "work-survivor",
		mergedAt: "2026-09-01T01:00:00.000Z",
	});

	const links = await store.listLinks();
	const active = links.filter((l) => l.status === "asserted");
	assertEquals(active.length, 1);
});
