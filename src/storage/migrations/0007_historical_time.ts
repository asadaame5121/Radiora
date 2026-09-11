import type { StorageMigration } from "./mod.ts";

export const historicalTimeMigration: StorageMigration = {
	id: "0007_historical_time",
	fromVersion: 6,
	toVersion: 7,
	async up(context) {
		await context.execute(
			"DEFINE FIELD IF NOT EXISTS historical_time ON work FLEXIBLE TYPE option<object>;",
		);
	},
	async validate(context) {
		await context.execute("INFO FOR TABLE work;");
	},
};
