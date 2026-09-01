import { describe, expect, it } from "vitest";
import type { RelationTypeDefinition } from "../src/domain/models.ts";
import { BUILT_IN_RELATION_TYPES } from "../src/domain/relation_type.ts";
import { RelationTypeController } from "../src/ui/relation_type_controller.svelte.ts";

describe("RelationTypeController", () => {
	it("defaults to built-in relation types", () => {
		const controller = new RelationTypeController({
			listRelationTypeDefinitions: () => Promise.resolve([...BUILT_IN_RELATION_TYPES]),
			createRelationTypeDefinition: () => Promise.reject(new Error("unimplemented")),
		});

		expect(controller.definitions.length).toBe(BUILT_IN_RELATION_TYPES.length);
		expect(controller.names.length).toBe(BUILT_IN_RELATION_TYPES.length);
		expect(controller.isSymmetric("RELATED")).toBe(true);
		expect(controller.isSymmetric("FROM")).toBe(false);
	});

	it("load fetches and updates definitions", async () => {
		const customDefinitions: RelationTypeDefinition[] = [
			...BUILT_IN_RELATION_TYPES,
			{
				name: "CUSTOM_REL",
				direction: "symmetric",
				builtIn: false,
				createdAt: "2026-09-01T00:00:00.000Z",
			},
		];

		const controller = new RelationTypeController({
			listRelationTypeDefinitions: () => Promise.resolve(customDefinitions),
			createRelationTypeDefinition: () => Promise.reject(new Error("unimplemented")),
		});

		await controller.load();
		expect(controller.definitions.length).toBe(customDefinitions.length);
		expect(controller.names.includes("CUSTOM_REL")).toBe(true);
		expect(controller.isSymmetric("CUSTOM_REL")).toBe(true);
	});

	it("create appends new definition", async () => {
		let createdDef: RelationTypeDefinition | null = null;
		const controller = new RelationTypeController({
			listRelationTypeDefinitions: () => Promise.resolve([...BUILT_IN_RELATION_TYPES]),
			createRelationTypeDefinition: (input) => {
				createdDef = {
					name: input.name,
					direction: input.direction,
					builtIn: false,
					createdAt: "2026-09-01T00:00:00.000Z",
				};
				return Promise.resolve(createdDef);
			},
		});

		const result = await controller.create({ name: "NEW_TYPE", direction: "directed" });
		expect(result.name).toBe("NEW_TYPE");
		expect(controller.names.includes("NEW_TYPE")).toBe(true);
		expect(controller.isSymmetric("NEW_TYPE")).toBe(false);
	});

	it("reconcileFilter appends missing relation types to filter", () => {
		const controller = new RelationTypeController({
			listRelationTypeDefinitions: () => Promise.resolve([...BUILT_IN_RELATION_TYPES]),
			createRelationTypeDefinition: () => Promise.reject(new Error("unimplemented")),
		});

		const filter = {
			linkTypes: ["RELATED", "FROM"],
			generationMin: 0,
			generationMax: 5,
		};

		const reconciled = controller.reconcileFilter(filter);
		for (const name of controller.names) {
			expect(reconciled.linkTypes.includes(name)).toBe(true);
		}
		expect(reconciled.generationMin).toBe(0);
		expect(reconciled.generationMax).toBe(5);

		// Already complete filter returns same reference
		const alreadyComplete = controller.reconcileFilter(reconciled);
		expect(alreadyComplete).toBe(reconciled);
	});

	it("rejects invalid load responses and preserves prior state", async () => {
		const controller = new RelationTypeController({
			listRelationTypeDefinitions: () =>
				Promise.resolve([
					// missing built-ins / malformed
					{ name: "INVALID" } as unknown as RelationTypeDefinition,
				]),
			createRelationTypeDefinition: () => Promise.reject(new Error("unimplemented")),
		});

		const initialLength = controller.definitions.length;
		await expect(controller.load()).rejects.toThrow();
		// State should not be corrupted
		expect(controller.definitions.length).toBe(initialLength);
	});

	it("rejects invalid create responses and does not append to state", async () => {
		const controller = new RelationTypeController({
			listRelationTypeDefinitions: () => Promise.resolve([...BUILT_IN_RELATION_TYPES]),
			createRelationTypeDefinition: () =>
				Promise.resolve({
					name: "MALFORMED",
					// missing direction, builtIn, createdAt
				} as unknown as RelationTypeDefinition),
		});

		const initialLength = controller.definitions.length;
		await expect(controller.create({ name: "MALFORMED", direction: "directed" })).rejects.toThrow();
		expect(controller.definitions.length).toBe(initialLength);
		expect(controller.names.includes("MALFORMED")).toBe(false);
	});
});
