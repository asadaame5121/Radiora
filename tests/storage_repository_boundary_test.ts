import { assert, assertStringIncludes } from "jsr:@std/assert@1";

Deno.test("SurrealGraphStore is a composition root without persistence queries", async () => {
	const source = await Deno.readTextFile(
		new URL("../src/storage/surreal_store.ts", import.meta.url),
	);

	for (
		const repository of [
			"SurrealBackupRepository",
			"SurrealDiscoveryRepository",
			"SurrealOutlineRepository",
			"SurrealRelationRepository",
			"SurrealRevisionRepository",
			"SurrealWorkRepository",
		]
	) {
		assertStringIncludes(source, repository);
	}
	assert(!/\.query\s*\(/.test(source), "composition root must not contain database queries");
	assert(
		source.split(/\r?\n/).length <= 250,
		"composition root should remain smaller than its feature repositories",
	);
});

Deno.test("graph store contracts and validation implementations have separate owners", async () => {
	const contracts = await Deno.readTextFile(
		new URL("../src/storage/graph_store.ts", import.meta.url),
	);
	const stateValidation = await Deno.readTextFile(
		new URL("../src/storage/graph_state_validation.ts", import.meta.url),
	);
	const mutationValidation = await Deno.readTextFile(
		new URL("../src/storage/graph_mutation_validation.ts", import.meta.url),
	);

	assertStringIncludes(contracts, 'from "./graph_state_validation.ts"');
	assertStringIncludes(contracts, 'from "./graph_mutation_validation.ts"');
	assert(!/function validatedGraphStateSnapshot/.test(contracts));
	assertStringIncludes(stateValidation, "function validatedGraphStateSnapshot");
	assertStringIncludes(mutationValidation, "function validateRevisionCreation");
});
