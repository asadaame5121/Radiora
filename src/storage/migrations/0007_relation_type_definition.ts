import { RecordId } from "surrealdb";
import { DEFAULT_RELATION_TYPE_DEFINITIONS } from "../../domain/models.ts";
import type { StorageMigration } from "./mod.ts";

export const relationTypeDefinitionMigration: StorageMigration = {
	id: "0007_relation_type_definition",
	fromVersion: 6,
	toVersion: 7,
	async up(context) {
		await context.execute(`
			DEFINE TABLE IF NOT EXISTS relation_type_definition SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS name ON relation_type_definition TYPE string;
			DEFINE FIELD IF NOT EXISTS direction ON relation_type_definition TYPE string;
			DEFINE FIELD IF NOT EXISTS built_in ON relation_type_definition TYPE bool DEFAULT false;
			DEFINE FIELD IF NOT EXISTS created_at ON relation_type_definition TYPE string;
			DEFINE INDEX IF NOT EXISTS relation_type_definition_name ON relation_type_definition FIELDS name UNIQUE;
		`);
		for (const definition of DEFAULT_RELATION_TYPE_DEFINITIONS) {
			await context.execute(
				`UPSERT $record CONTENT {
					name: $name, direction: $direction, built_in: true, created_at: $createdAt
				};`,
				{ ...definition, record: new RecordId("relation_type_definition", definition.name) },
			);
		}
	},
	async validate(context) {
		await context.execute(`
			INFO FOR TABLE relation_type_definition;
			SELECT name, direction, built_in, created_at FROM relation_type_definition;
		`);
	},
};
