import { RecordId } from "surrealdb";
import type { RelationTypeDefinition } from "../domain/models.ts";
import type { RelationTypeDefinitionStorePort } from "./graph_store.ts";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import { relationTypeDefinitionFromRow } from "./surreal_row_mapper.ts";

export class SurrealRelationTypeDefinitionRepository implements RelationTypeDefinitionStorePort {
	constructor(private readonly db: SurrealQueryClient) {}

	async listRelationTypeDefinitions(): Promise<RelationTypeDefinition[]> {
		const [rows] = await this.db.query<[Record<string, unknown>[]]>(
			`SELECT name, direction, built_in, created_at FROM relation_type_definition
				ORDER BY built_in DESC, name ASC;`,
		);
		return rows.map(relationTypeDefinitionFromRow);
	}

	async createRelationTypeDefinition(definition: RelationTypeDefinition): Promise<void> {
		await this.db.query(
			`CREATE $record CONTENT {
				name: $name, direction: $direction, built_in: $builtIn, created_at: $createdAt
			};`,
			{
				...definition,
				record: new RecordId("relation_type_definition", definition.name),
			},
		);
	}
}
