import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
	DEFAULT_RELATION_TYPE_DEFINITIONS,
	normalizeRelationTypeName,
} from "../src/domain/models.ts";

Deno.test("relation type names are trimmed, uppercased, and limited to ASCII identifiers", () => {
	assertEquals(normalizeRelationTypeName("  custom_2  "), "CUSTOM_2");
	for (const invalid of ["", "2FAST", "HAS-DASH", "HAS SPACE", "関係", `A${"B".repeat(64)}`]) {
		assertThrows(() => normalizeRelationTypeName(invalid));
	}
});

Deno.test("built-in relation definitions preserve existing direction semantics", () => {
	assertEquals(
		DEFAULT_RELATION_TYPE_DEFINITIONS.map(({ name, direction }) => ({ name, direction })),
		[
			{ name: "RELATED", direction: "symmetric" },
			{ name: "FROM", direction: "directed" },
			{ name: "LIKE", direction: "symmetric" },
			{ name: "SUPPORT", direction: "directed" },
			{ name: "DEF", direction: "directed" },
			{ name: "VS", direction: "symmetric" },
			{ name: "FIX", direction: "directed" },
			{ name: "CITE", direction: "directed" },
		],
	);
});
