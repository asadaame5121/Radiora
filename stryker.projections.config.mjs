import { denoMutationBatch } from "./scripts/quality/stryker_deno_config.mjs";

export default denoMutationBatch(
	"projections",
	[
		"src/services/browsing_navigation_state.ts",
		"src/services/date_projection.ts",
		"src/services/manuscript_projection.ts",
		"src/services/sparse_outline.ts",
		"src/ui/tree_camera.ts",
		"src/ui/tree_layout.ts",
		"src/ui/tree_spatial_index.ts",
	],
	[
		"src/services/browsing_navigation_state_test.ts",
		"src/services/date_projection_test.ts",
		"src/services/manuscript_projection_test.ts",
		"src/services/sparse_outline_test.ts",
		"src/ui/tree_camera_test.ts",
		"src/ui/tree_layout_test.ts",
		"src/ui/tree_spatial_index_test.ts",
	],
);
