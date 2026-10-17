interface PaletteFocusPorts {
	open(): boolean;
}

interface EditorFocusTarget {
	host: HTMLElement;
	textarea: HTMLTextAreaElement;
	selection: {
		start: number;
		end: number;
		direction: "forward" | "backward" | "none";
		scrollTop: number;
		scrollLeft: number;
	};
}

export interface PaletteFocusSession {
	readonly settled: Promise<void>;
}

interface FocusSession extends PaletteFocusSession {
	generation: number;
	target: HTMLElement | null;
	editor: EditorFocusTarget | null;
	resolve(): void;
}

/** DOM references are short lived and late close cannot restore into a reopened palette. */
export class PaletteFocusAdapter {
	private generation = 0;
	private disposed = false;
	private current: FocusSession | null = null;
	constructor(private readonly ports: PaletteFocusPorts) {}

	remember(): PaletteFocusSession {
		this.generation++;
		this.cancelCurrent();
		const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		let editor: EditorFocusTarget | null = null;
		if (
			active && typeof active.matches === "function" && active.matches("textarea[data-item-id]")
		) {
			const host = active.closest<HTMLElement>("[data-editor-item-id]");
			if (host) {
				const textarea = active as HTMLTextAreaElement;
				editor = {
					host,
					textarea,
					selection: {
						start: textarea.selectionStart,
						end: textarea.selectionEnd,
						direction: textarea.selectionDirection,
						scrollTop: textarea.scrollTop,
						scrollLeft: textarea.scrollLeft,
					},
				};
			}
		}
		let resolve!: () => void;
		const settled = new Promise<void>((done) => resolve = done);
		const session: FocusSession = {
			generation: this.generation,
			target: active,
			editor,
			settled,
			resolve,
		};
		this.current = session;
		return session;
	}

	closeHandler(session: PaletteFocusSession): (event: Event) => void {
		return (event) => this.restoreOnClose(session, event);
	}

	restoreOnClose(session: PaletteFocusSession, event: Event): void {
		event.preventDefault();
		const current = this.current;
		if (!current || current !== session) return;
		if (this.canRestore(current)) this.focusTarget(current);
		this.current = null;
		current.resolve();
	}

	dispose(): void {
		this.disposed = true;
		this.generation++;
		this.cancelCurrent();
	}

	private cancelCurrent(): void {
		this.current?.resolve();
		this.current = null;
	}

	private canRestore(pending: FocusSession): boolean {
		const editorAvailable = Boolean(
			pending.editor?.host.isConnected && pending.editor.textarea.isConnected,
		);
		const directTargetAvailable = !pending.editor && Boolean(pending.target?.isConnected);
		return !this.disposed && pending.generation === this.generation && !this.ports.open() &&
			(editorAvailable || directTargetAvailable);
	}

	private focusTarget(pending: FocusSession): void {
		const editor = pending.editor;
		if (editor?.host.isConnected && editor.textarea.isConnected) {
			editor.host.dispatchEvent(
				new CustomEvent("radiora:focus-editor", {
					detail: { caretOffset: editor.selection.start },
				}),
			);
			const valueLength = editor.textarea.value.length;
			editor.textarea.setSelectionRange(
				Math.min(editor.selection.start, valueLength),
				Math.min(editor.selection.end, valueLength),
				editor.selection.direction,
			);
			editor.textarea.scrollTop = editor.selection.scrollTop;
			editor.textarea.scrollLeft = editor.selection.scrollLeft;
		} else if (!editor && pending.target?.isConnected) {
			pending.target.focus();
		}
	}
}
