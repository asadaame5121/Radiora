import { denoMutationBatch } from "./scripts/quality/stryker_deno_config.mjs";

export default denoMutationBatch(
	"domain",
	[
		"src/services/advanced_link_resolver.ts",
		"src/services/branch_service.ts",
		"src/services/occurrence_operations.ts",
		"src/services/outline_filter.ts",
		"src/services/revision_diff.ts",
		"src/services/search_text.ts",
		"src/services/tag_service.ts",
	],
	[
		"src/services/advanced_link_resolver_test.ts",
		"src/services/branch_service_test.ts",
		"src/services/occurrence_operations_test.ts",
		"src/services/outline_filter_test.ts",
		"src/services/revision_diff_test.ts",
		"src/services/tag_service_test.ts",
	],
);
