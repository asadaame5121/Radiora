import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
	DEFAULT_UI_CONCEPTS,
	freezeUiConcepts,
	UI_CONCEPT_CODES,
	type UiConceptDefinition,
	type UiConcepts,
} from "../src/shared/ui_concepts.ts";
import { DEFAULT_UI_VOCABULARY } from "../src/shared/ui_vocabulary.ts";

Deno.test("default UI concepts cover all concept codes with frozen definitions", () => {
	assertEquals(Object.keys(DEFAULT_UI_CONCEPTS).sort(), [...UI_CONCEPT_CODES].sort());
	assertFalse(
		(Object.values(DEFAULT_UI_CONCEPTS) as UiConceptDefinition[]).some((def) =>
			/実身|化身/.test(def.label + def.description)
		),
	);
	for (const code of UI_CONCEPT_CODES) {
		assertEquals(DEFAULT_UI_CONCEPTS[code].label, DEFAULT_UI_VOCABULARY[code]);
		assertEquals(typeof DEFAULT_UI_CONCEPTS[code].description, "string");
		assertEquals(Object.isFrozen(DEFAULT_UI_CONCEPTS[code]), true);
	}
	assertEquals(Object.isFrozen(DEFAULT_UI_CONCEPTS), true);
});

Deno.test("freezeUiConcepts freezes shallow and nested structures immutably", () => {
	const mock: UiConcepts = {
		work: { label: "a", description: "b" },
		occurrence: { label: "a", description: "b" },
		semanticLink: { label: "a", description: "b" },
		revision: { label: "a", description: "b" },
		hoist: { label: "a", description: "b" },
		workLineage: { label: "a", description: "b" },
		globalLineage: { label: "a", description: "b" },
		sparseOutline: { label: "a", description: "b" },
	};
	const frozen = freezeUiConcepts(mock);
	assertEquals(Object.isFrozen(frozen), true);
	for (const code of UI_CONCEPT_CODES) {
		assertEquals(Object.isFrozen(frozen[code]), true);
	}
});
