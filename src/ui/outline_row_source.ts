/**
 * The fields the Outline Views read from a row's item. v2 `OutlineItem` satisfies it as is;
 * other read models (v3) map into it without copying v2 entity fields.
 *
 * Kept free of Svelte/rune imports so Deno-checked view-model code can depend on it.
 */
export type OutlineRowSource = {
	readonly id: string;
	readonly parentId: string | null;
	readonly text: string;
	readonly collapsed: boolean;
	readonly referenceStub?: boolean;
};
