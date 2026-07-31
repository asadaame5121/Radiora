import type { StorageMigration } from "./mod.ts";

export const mergeProvenanceMigration: StorageMigration = {
	id: "0005_merge_provenance",
	fromVersion: 4,
	toVersion: 5,
	async up(context) {
		await context.execute(`
			DEFINE FIELD IF NOT EXISTS merged_into_work ON work TYPE option<record<work>>;
			DEFINE FIELD IF NOT EXISTS merged_at ON work TYPE option<string>;
		`);
	},
	async validate(context) {
		await context.execute(`
			INFO FOR TABLE work;
			SELECT id FROM work
				WHERE (merged_into_work IS NONE) != (merged_at IS NONE);
		`);
	},
};
