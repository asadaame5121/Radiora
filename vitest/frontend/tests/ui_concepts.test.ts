import { expect, test } from "vitest";
import {
	DEFAULT_UI_CONCEPTS,
	freezeUiConcepts,
	UI_CONCEPT_CODES,
	type UiConceptDefinition,
	type UiConcepts,
} from "../../../src/shared/ui_concepts.ts";
import { DEFAULT_UI_VOCABULARY } from "../../../src/shared/ui_vocabulary.ts";

test("default UI concepts cover all concept codes with frozen definitions", () => {
	expect(Object.keys(DEFAULT_UI_CONCEPTS).sort()).toEqual([...UI_CONCEPT_CODES].sort());
	expect(
		(Object.values(DEFAULT_UI_CONCEPTS) as UiConceptDefinition[]).some((def) =>
			/実身|化身/.test(def.label + def.description),
		),
	).toBe(false);
	for (const code of UI_CONCEPT_CODES) {
		expect(DEFAULT_UI_CONCEPTS[code].label).toEqual(DEFAULT_UI_VOCABULARY[code]);
		expect(typeof DEFAULT_UI_CONCEPTS[code].description).toEqual("string");
		expect(Object.isFrozen(DEFAULT_UI_CONCEPTS[code])).toEqual(true);
	}
	expect(Object.isFrozen(DEFAULT_UI_CONCEPTS)).toEqual(true);
});

test("freezeUiConcepts freezes shallow and nested structures immutably", () => {
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
	expect(Object.isFrozen(frozen)).toEqual(true);
	for (const code of UI_CONCEPT_CODES) {
		expect(Object.isFrozen(frozen[code])).toEqual(true);
	}
});
