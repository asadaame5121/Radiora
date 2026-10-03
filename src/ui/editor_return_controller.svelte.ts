import { tick } from "svelte";
import type { ScreenNavigator } from "./screen_navigation_destination.ts";

export interface EditorPosition {
	itemId: string;
	hoistId: string | null;
	start: number;
	end: number;
	scrollTop: number;
	scrollLeft: number;
	panelScrollTop: number;
	direction?: "forward" | "backward" | "none";
}

export function captureEditorPosition(
	itemId: string,
	hoistId: string | null,
	textarea = document.querySelector<HTMLTextAreaElement>(
		`textarea[data-item-id="${CSS.escape(itemId)}"]`,
	),
): EditorPosition {
	return {
		itemId,
		hoistId,
		start: textarea?.selectionStart ?? 0,
		end: textarea?.selectionEnd ?? 0,
		direction: textarea?.selectionDirection ?? "none",
		scrollTop: textarea?.scrollTop ?? 0,
		scrollLeft: textarea?.scrollLeft ?? 0,
		panelScrollTop: document.querySelector<HTMLElement>(".outline-panel")?.scrollTop ?? 0,
	};
}

export async function focusOutlineEditor(
	itemId: string | null,
	position?: EditorPosition,
	current: () => boolean = () => true,
	restoreScroll = true,
): Promise<void> {
	await tick();
	if (!current()) return;
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
	if (textarea) {
		textarea.setSelectionRange(
			Math.min(position.start, textarea.value.length),
			Math.min(position.end, textarea.value.length),
			position.direction ?? "none",
		);
	}
	if (textarea) {
		textarea.scrollTop = position.scrollTop;
		textarea.scrollLeft = position.scrollLeft;
	}
	const panel = document.querySelector<HTMLElement>(".outline-panel");
	if (panel && restoreScroll) panel.scrollTop = position.panelScrollTop;
}

/** Owns the saved editing location independently of shortcuts or the manuscript view. */
export class EditorReturnController {
	position = $state.raw<EditorPosition | null>(null);
	constructor(
		private readonly ports: {
			navigation: ScreenNavigator;
			hasItem(id: string): boolean;
		},
	) {}

	remember(itemId: string, hoistId: string | null): void {
		this.position = captureEditorPosition(itemId, hoistId);
	}

	restore = async (): Promise<void> => {
		const position = this.position;
		if (!position) return;
		if (!this.ports.hasItem(position.itemId)) throw new Error("元の編集項目が見つかりません。");
		await this.ports.navigation.navigate({
			view: "outline",
			occurrenceId: position.itemId,
			hoistId: position.hoistId,
			editorPosition: position,
			longForm: false,
		});
	};
}
