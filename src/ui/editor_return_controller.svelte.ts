import { tick } from "svelte";

export interface EditorPosition {
	itemId: string;
	hoistId: string | null;
	start: number;
	end: number;
	scrollTop: number;
	scrollLeft: number;
	panelScrollTop: number;
}

export function captureEditorPosition(itemId: string, hoistId: string | null): EditorPosition {
	const textarea = document.querySelector<HTMLTextAreaElement>(
		`textarea[data-item-id="${CSS.escape(itemId)}"]`,
	);
	return {
		itemId,
		hoistId,
		start: textarea?.selectionStart ?? 0,
		end: textarea?.selectionEnd ?? 0,
		scrollTop: textarea?.scrollTop ?? 0,
		scrollLeft: textarea?.scrollLeft ?? 0,
		panelScrollTop: document.querySelector<HTMLElement>(".outline-panel")?.scrollTop ?? 0,
	};
}

export async function focusOutlineEditor(
	itemId: string | null,
	position?: EditorPosition,
): Promise<void> {
	await tick();
	if (!itemId) {
		document.querySelector<HTMLElement>(".rows, .outline-panel button")?.focus();
		return;
	}
	const host = document.querySelector<HTMLElement>(
		`.markdown-editor-host[data-editor-item-id="${CSS.escape(itemId)}"]`,
	);
	host?.dispatchEvent(
		new CustomEvent("radiora:focus-editor", { detail: { caretOffset: position?.start } }),
	);
	if (!position) return;
	const textarea = document.querySelector<HTMLTextAreaElement>(
		`textarea[data-item-id="${CSS.escape(itemId)}"]`,
	);
	textarea?.setSelectionRange(position.start, position.end);
	if (textarea) {
		textarea.scrollTop = position.scrollTop;
		textarea.scrollLeft = position.scrollLeft;
	}
	const panel = document.querySelector<HTMLElement>(".outline-panel");
	if (panel) panel.scrollTop = position.panelScrollTop;
}

/** Owns the saved editing location independently of shortcuts or the manuscript view. */
export class EditorReturnController {
	position = $state.raw<EditorPosition | null>(null);
	constructor(
		private readonly ports: {
			beforeRestore(): Promise<boolean>;
			hasItem(id: string): boolean;
			select(id: string): boolean;
			setHoist(id: string | null): void;
			reveal(id: string): void;
			showEditor(): void;
		},
	) {}

	remember(itemId: string, hoistId: string | null): void {
		this.position = captureEditorPosition(itemId, hoistId);
	}

	restore = async (): Promise<void> => {
		const position = this.position;
		if (!position || !await this.ports.beforeRestore()) return;
		if (!this.ports.hasItem(position.itemId)) throw new Error("元の編集項目が見つかりません。");
		if (!this.ports.select(position.itemId)) return;
		this.ports.setHoist(position.hoistId);
		// Setting the hoist can select its root; restore the actual edited occurrence.
		if (!this.ports.select(position.itemId)) return;
		this.ports.reveal(position.itemId);
		this.ports.showEditor();
		await focusOutlineEditor(position.itemId, position);
	};
}
