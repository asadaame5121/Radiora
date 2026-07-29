import { getContext } from "svelte";
import type { UiVocabulary } from "../shared/ui_vocabulary.ts";

export const UI_VOCABULARY_CONTEXT = Symbol("UiVocabulary");

export function useUiVocabulary(): UiVocabulary {
	const vocabulary = getContext<UiVocabulary | undefined>(UI_VOCABULARY_CONTEXT);
	if (!vocabulary) throw new Error("UiVocabulary context is not configured");
	return vocabulary;
}
