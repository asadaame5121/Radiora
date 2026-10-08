import { getContext } from "svelte";
import type { UiConcepts } from "../shared/ui_concepts.ts";
import {
	DEFAULT_UI_VOCABULARY,
	DEFAULT_UI_VOCABULARY_DEFINITION,
	type UiVocabulary,
	type UiVocabularyDefinition,
} from "../shared/ui_vocabulary.ts";

export const UI_VOCABULARY_CONTEXT = Symbol("UiVocabulary");

export function useUiVocabulary(): UiVocabulary {
	const vocabulary = getContext<UiVocabulary | UiVocabularyDefinition | undefined>(
		UI_VOCABULARY_CONTEXT,
	);
	if (vocabulary && "concepts" in vocabulary) return vocabulary.vocabulary;
	return vocabulary ?? DEFAULT_UI_VOCABULARY;
}

/** ラベルと説明は同じContextから読む。旧ラベル注入へ既定説明を混ぜない。 */
export function useUiConcepts(): UiConcepts {
	const vocabulary = getContext<UiVocabulary | UiVocabularyDefinition | undefined>(
		UI_VOCABULARY_CONTEXT,
	);
	if (!vocabulary || vocabulary === DEFAULT_UI_VOCABULARY) {
		return DEFAULT_UI_VOCABULARY_DEFINITION.concepts;
	}
	if ("concepts" in vocabulary) return vocabulary.concepts;
	throw new Error(
		"Concept descriptions require a createUiVocabulary() definition in UI_VOCABULARY_CONTEXT.",
	);
}
