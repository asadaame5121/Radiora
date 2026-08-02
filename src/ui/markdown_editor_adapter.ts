export type MarkdownEditorMode = "normal" | "plain" | "preview";

export interface MarkdownEditorSelection {
	start: number;
	end: number;
	direction: "forward" | "backward" | "none";
}

export interface MarkdownEditorAdapterOptions {
	host: HTMLElement;
	value: string;
	textareaAttributes?: Record<string, string>;
	onChange(value: string, textarea: HTMLTextAreaElement): void;
	onKeydown?(
		event: KeyboardEvent,
		textarea: HTMLTextAreaElement,
		compositionGuard: boolean,
	): void;
	onSelectionChange?(textarea: HTMLTextAreaElement): void;
	onFocus?(textarea: HTMLTextAreaElement): void;
	onBlur?(textarea: HTMLTextAreaElement): void;
	onInternalReference?(destination: string): void;
	onFallback?(cause: unknown): void;
}

/**
 * Host-owned editor boundary. Library-specific types must stay behind this
 * interface and never enter domain, bindings, or storage modules.
 */
export interface MarkdownEditorAdapter {
	readonly textarea: HTMLTextAreaElement;
	readonly fallback: boolean;
	getValue(): string;
	setValue(value: string): void;
	setMode(mode: MarkdownEditorMode): void;
	getSelection(): MarkdownEditorSelection;
	setSelection(selection: MarkdownEditorSelection): void;
	focus(): void;
	destroy(): void;
}
