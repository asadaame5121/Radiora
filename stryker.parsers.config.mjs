import { denoMutationBatch } from "./scripts/quality/stryker_deno_config.mjs";

export default denoMutationBatch(
	"parsers",
	[
		"src/services/advanced_link_parser.ts",
		"src/services/inline_link.ts",
		"src/services/internal_reference.ts",
		"src/services/markdown_parser.ts",
		"src/storage/graph_state_validation.ts",
	],
	[
		"src/services/advanced_link_parser_test.ts",
		"src/services/inline_link_test.ts",
		"src/services/internal_reference_test.ts",
		"src/services/markdown_parser_test.ts",
		"src/storage/json_store_test.ts",
	],
);
