import type { StorageMigration } from "./mod.ts";

export const emergenceSuggestionMigration: StorageMigration = {
	id: "0006_emergence_suggestion",
	fromVersion: 5,
	toVersion: 6,
	async up(context) {
		await context.execute(`
			DEFINE TABLE IF NOT EXISTS emergence_suggestion SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS kind ON emergence_suggestion TYPE string;
			DEFINE FIELD IF NOT EXISTS context_work ON emergence_suggestion TYPE record<work>;
			DEFINE FIELD IF NOT EXISTS target_work ON emergence_suggestion TYPE record<work>;
			DEFINE FIELD IF NOT EXISTS context_occurrence_id ON emergence_suggestion TYPE string;
			DEFINE FIELD IF NOT EXISTS target_occurrence_id ON emergence_suggestion TYPE string;
			DEFINE FIELD IF NOT EXISTS proposed_link_type ON emergence_suggestion TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS title ON emergence_suggestion TYPE string;
			DEFINE FIELD IF NOT EXISTS explanation ON emergence_suggestion TYPE string;
			DEFINE FIELD IF NOT EXISTS evidence ON emergence_suggestion TYPE array<object>;
			DEFINE FIELD IF NOT EXISTS score ON emergence_suggestion TYPE number;
			DEFINE FIELD IF NOT EXISTS status ON emergence_suggestion TYPE string;
			DEFINE FIELD IF NOT EXISTS created_at ON emergence_suggestion TYPE string;
			DEFINE FIELD IF NOT EXISTS updated_at ON emergence_suggestion TYPE string;
			DEFINE FIELD IF NOT EXISTS resolved_at ON emergence_suggestion TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS resolution_reason ON emergence_suggestion TYPE option<string>;
		`);
	},
	async validate(context) {
		await context.execute(`
			INFO FOR TABLE emergence_suggestion;
			IF (SELECT VALUE count() FROM emergence_suggestion
				WHERE status NOT IN ["pending", "accepted", "dismissed", "held"]
					OR score < 0 OR score > 1
					OR (status = "dismissed" AND
						(resolution_reason IS NONE OR string::trim(resolution_reason) = ""))) > 0 {
				THROW "Invalid emergence suggestion rows";
			};
		`);
	},
};
