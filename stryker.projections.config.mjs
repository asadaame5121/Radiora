import { denoMutationBatch } from "./scripts/quality/stryker_deno_config.mjs";

export default denoMutationBatch(
	"projections",
	[
		"src/services/browsing_navigation_state.ts",
		"src/services/date_projection.ts",
		"src/services/manuscript_projection.ts",
		"src/services/sparse_outline.ts",
	],
	[
		"src/services/browsing_navigation_state_test.ts",
		"src/services/date_projection_test.ts",
		"src/services/manuscript_projection_test.ts",
		"src/services/sparse_outline_test.ts",
	],
);
