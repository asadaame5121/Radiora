import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_CONCEPTS, UI_CONCEPT_CODES } from "../src/shared/ui_concepts.ts";
import {
	createUiVocabulary,
	DEFAULT_UI_VOCABULARY,
	DEFAULT_UI_VOCABULARY_DEFINITION,
	type UiVocabulary,
	type UiVocabularyDefinition,
} from "../src/shared/ui_vocabulary.ts";
import { useUiConcepts, useUiVocabulary } from "../src/ui/ui_vocabulary_context.ts";

const context = vi.hoisted(() => ({
	value: undefined as UiVocabulary | UiVocabularyDefinition | undefined,
}));
vi.mock("svelte", () => ({ getContext: () => context.value }));

beforeEach(() => {
	context.value = undefined;
});

describe("UI vocabulary contract", () => {
	it("uses default labels and explanations without a provider", () => {
		expect(useUiVocabulary()).toBe(DEFAULT_UI_VOCABULARY);
		expect(useUiConcepts()).toBe(DEFAULT_UI_CONCEPTS);
	});

	it("preserves PR 324 vocabulary and derives all eight labels from concept definitions", () => {
		expect(UI_CONCEPT_CODES.map((code) => DEFAULT_UI_VOCABULARY[code])).toEqual([
			"メモ",
			"表示場所",
			"関係",
			"バージョン",
			"フォーカス",
			"バージョンの系譜",
			"ツリー",
			"文脈付き表示",
		]);
		for (const code of UI_CONCEPT_CODES) {
			expect(DEFAULT_UI_VOCABULARY[code]).toBe(DEFAULT_UI_CONCEPTS[code].label);
		}
		expect(DEFAULT_UI_VOCABULARY.opmlImport).toBe("OPMLを取り込む");
		expect(DEFAULT_UI_VOCABULARY.jsonBackupExportSuccess).toBe("完全バックアップを書き出しました");
	});

	it("injects custom labels and explanations from one definition", () => {
		const custom = createUiVocabulary({
			...DEFAULT_UI_CONCEPTS,
			work: { label: "カード", description: "カードをまとめて管理します。" },
		}, { advancedLinkEditor: "つながりを編集" });
		context.value = custom;
		expect(useUiVocabulary().work).toBe("カード");
		expect(useUiConcepts().work).toEqual({
			label: "カード",
			description: "カードをまとめて管理します。",
		});
		expect(useUiVocabulary().advancedLinkEditor).toBe("つながりを編集");
	});

	it("keeps labels and explanations stable after source data changes", () => {
		const work = { label: "カード", description: "元の説明" };
		const custom = createUiVocabulary({ ...DEFAULT_UI_CONCEPTS, work });
		work.label = "変更";
		work.description = "変更後";
		expect(custom.vocabulary.work).toBe("カード");
		expect(custom.concepts.work.description).toBe("元の説明");
		expect(Object.isFrozen(custom)).toBe(true);
		expect(Object.isFrozen(custom.vocabulary)).toBe(true);
		expect(Object.isFrozen(custom.concepts)).toBe(true);
		expect(Object.values(custom.concepts).every(Object.isFrozen)).toBe(true);
	});

	it("preserves legacy label providers and requires explicit custom explanations", () => {
		context.value = { ...DEFAULT_UI_VOCABULARY, work: "カード" };
		expect(useUiVocabulary().work).toBe("カード");
		expect(() => useUiConcepts()).toThrow("createUiVocabulary()");
	});

	it("uses the definition installed by the app entry point", () => {
		context.value = DEFAULT_UI_VOCABULARY_DEFINITION;
		expect(useUiVocabulary()).toBe(DEFAULT_UI_VOCABULARY);
		expect(useUiConcepts()).toBe(DEFAULT_UI_CONCEPTS);
	});

	it("allows the legacy default provider used by existing harnesses", () => {
		context.value = DEFAULT_UI_VOCABULARY;
		expect(useUiConcepts()).toBe(DEFAULT_UI_CONCEPTS);
	});
});
