import { assert, assertStringIncludes } from "jsr:@std/assert@1";

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
