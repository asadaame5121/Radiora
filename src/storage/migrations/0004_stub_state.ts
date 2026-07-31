import type { StorageMigration } from "./mod.ts";

export const stubStateMigration: StorageMigration = {
	id: "0004_stub_state",
	fromVersion: 3,
	toVersion: 4,
	async up(context) {
		await context.execute(`
			DEFINE FIELD IF NOT EXISTS stub ON work TYPE option<object>;
			DEFINE FIELD IF NOT EXISTS stub.created_at ON work TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS stub.created_via ON work TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS stub.context ON work TYPE option<string>;
		`);
	},
	async validate(context) {
		await context.execute(`
			INFO FOR TABLE work;
		`);
	},
};
