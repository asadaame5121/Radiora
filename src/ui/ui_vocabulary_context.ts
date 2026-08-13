import { getContext } from "svelte";
import { DEFAULT_UI_VOCABULARY, type UiVocabulary } from "../shared/ui_vocabulary.ts";

export const UI_VOCABULARY_CONTEXT = Symbol("UiVocabulary");

export function useUiVocabulary(): UiVocabulary {
	const vocabulary = getContext<UiVocabulary | undefined>(UI_VOCABULARY_CONTEXT);
	return vocabulary ?? DEFAULT_UI_VOCABULARY;
}
