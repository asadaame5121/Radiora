import {
	DEFAULT_RELATION_TYPE_DEFINITIONS,
	type RelationTypeDefinition,
} from "../domain/models.ts";

export class MemoryRelationTypeCatalog {
	#definitions: RelationTypeDefinition[] = structuredClone(DEFAULT_RELATION_TYPE_DEFINITIONS);

	snapshot(): RelationTypeDefinition[] {
		return structuredClone(this.#definitions);
	}

	replace(definitions: RelationTypeDefinition[]): void {
		this.#definitions = structuredClone(definitions);
	}

	create(definition: RelationTypeDefinition): void {
		if (this.#definitions.some((current) => current.name === definition.name)) {
			throw new Error(`Relation type already exists: ${definition.name}`);
		}
		this.#definitions.push(structuredClone(definition));
	}
}
