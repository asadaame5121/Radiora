import type { StorageMigration } from "./mod.ts";

export const bookmarkResumeMigration: StorageMigration = {
	id: "0003_bookmark_resume",
	fromVersion: 2,
	toVersion: 3,
	async up(context) {
		await context.execute(`
			DEFINE TABLE IF NOT EXISTS bookmark SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS work ON bookmark TYPE record<work>;
			DEFINE FIELD IF NOT EXISTS occurrence ON bookmark TYPE record<occurrence>;
			DEFINE FIELD IF NOT EXISTS created_at ON bookmark TYPE string;
			DEFINE TABLE IF NOT EXISTS resume_position SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS work ON resume_position TYPE record<work>;
			DEFINE FIELD IF NOT EXISTS occurrence ON resume_position TYPE record<occurrence>;
			DEFINE FIELD IF NOT EXISTS caret_offset ON resume_position TYPE number;
			DEFINE FIELD IF NOT EXISTS updated_at ON resume_position TYPE string;
		`);
	},
	async validate(context) {
		await context.execute(`
			INFO FOR TABLE bookmark;
			INFO FOR TABLE resume_position;
		`);
	},
};
