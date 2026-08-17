import OverType, { type OverType as OverTypeInstance } from "overtype";
import type {
	MarkdownEditorAdapter,
	MarkdownEditorAdapterOptions,
	MarkdownEditorMode,
	MarkdownEditorSelection,
} from "./markdown_editor_adapter.ts";

const RADIORA_DESTINATION = /^radiora:\/\/(?:work|revision)\/[-._~A-Za-z0-9]+(?:#[^\s]*)?$/u;

export function createMarkdownEditorAdapter(
	options: MarkdownEditorAdapterOptions,
): MarkdownEditorAdapter {
	try {
		return new OvertypeMarkdownEditorAdapter(options);
	} catch (cause) {
		options.onFallback?.(cause);
		return new TextareaMarkdownEditorAdapter(options);
	}
}

export class OvertypeMarkdownEditorAdapter implements MarkdownEditorAdapter {
	readonly fallback = false;
	readonly textarea: HTMLTextAreaElement;
	readonly #instance: OverTypeInstance;
	readonly #options: MarkdownEditorAdapterOptions;
	readonly #cleanup: Array<() => void> = [];
	#generation = 1;
	#suppressChange = 1;
	#compositionGuard = false;
	#compositionDirty = false;
	#compositionStartValue = "";
	#compositionTimer?: ReturnType<typeof globalThis.setTimeout>;

	constructor(options: MarkdownEditorAdapterOptions) {
		this.#options = options;
		const generation = this.#generation;
		const [instance] = new OverType(options.host, {
			value: options.value,
			theme: "cave",
			autoResize: false,
			smartLists: false,
			toolbar: false,
			fontFamily: '"Cascadia Mono", "Noto Sans Mono CJK JP", "MS Gothic", monospace',
			fontSize: "13px",
			lineHeight: 1.55,
			padding: "7px 8px",
			textareaProps: options.textareaAttributes,
			transformLinkUrl: (url) => url,
			onChange: (value, current) => {
				if (
					generation !== this.#generation || this.#suppressChange > 0 ||
					current !== this.#instance
				) return;
				if (this.#compositionGuard) {
					this.#compositionDirty = true;
					return;
				}
				this.#options.onChange(value, current.textarea);
			},
		});
		if (!instance) throw new Error("Overtype did not create an editor instance");
		this.#instance = instance;
		this.textarea = instance.textarea;
		this.#installPreviewAccessibility();
		this.#installHostListeners();
		this.#suppressChange = 0;
	}

	getValue(): string {
		return this.#instance.getValue();
	}

	setValue(value: string): void {
		if (value === this.#instance.getValue()) return;
		const selection = this.getSelection();
		const scrollTop = this.textarea.scrollTop;
		const scrollLeft = this.textarea.scrollLeft;
		this.#suppressChange++;
		try {
			this.#instance.setValue(value);
		} finally {
			this.#suppressChange--;
		}
		this.setSelection({
			start: Math.min(selection.start, value.length),
			end: Math.min(selection.end, value.length),
			direction: selection.direction,
		});
		this.textarea.scrollTop = scrollTop;
		this.textarea.scrollLeft = scrollLeft;
	}

	setMode(mode: MarkdownEditorMode): void {
		if (mode === "plain") this.#instance.showPlainTextarea();
		else if (mode === "preview") this.#instance.showPreviewMode();
		else this.#instance.showNormalEditMode();
	}

	getSelection(): MarkdownEditorSelection {
		return {
			start: this.textarea.selectionStart,
			end: this.textarea.selectionEnd,
			direction: this.textarea.selectionDirection,
		};
	}

	setSelection(selection: MarkdownEditorSelection): void {
		this.textarea.setSelectionRange(selection.start, selection.end, selection.direction);
	}

	focus(): void {
		this.#instance.focus();
	}

	destroy(): void {
		if (this.#generation === 0) return;
		this.#generation++;
		if (this.#compositionTimer !== undefined) clearTimeout(this.#compositionTimer);
		for (const cleanup of this.#cleanup.splice(0)) cleanup();
		this.#instance.linkTooltip?.destroy?.();
		this.#instance.destroy();
		this.#generation = 0;
	}

	#listen(
		target: EventTarget,
		type: string,
		listener: EventListener,
		options?: AddEventListenerOptions | boolean,
	): void {
		target.addEventListener(type, listener, options);
		this.#cleanup.push(() => target.removeEventListener(type, listener, options));
	}

	#installHostListeners(): void {
		this.#listen(this.textarea, "compositionstart", () => {
			this.#compositionGuard = true;
			this.#compositionDirty = false;
			this.#compositionStartValue = this.textarea.value;
		});
		this.#listen(this.textarea, "compositionend", () => {
			const generation = this.#generation;
			if (this.#compositionTimer !== undefined) clearTimeout(this.#compositionTimer);
			this.#compositionTimer = globalThis.setTimeout(() => {
				this.#compositionTimer = undefined;
				if (generation !== this.#generation) return;
				this.#compositionGuard = false;
				if (this.textarea.value !== this.#compositionStartValue) {
					this.#compositionDirty = false;
					this.#options.onChange(this.textarea.value, this.textarea);
				}
			}, 0);
		});
		this.#listen(this.textarea, "keydown", (rawEvent) => {
			const event = rawEvent as KeyboardEvent;
			const compositionGuard = this.#compositionGuard || event.isComposing || event.keyCode === 229;
			this.#options.onKeydown?.(event, this.textarea, compositionGuard);
			if (event.defaultPrevented) event.stopImmediatePropagation();
		}, { capture: true });
		const notifySelection = () => this.#options.onSelectionChange?.(this.textarea);
		for (const type of ["select", "keyup", "click", "input", "scroll"]) {
			this.#listen(this.textarea, type, notifySelection);
		}
		this.#listen(this.textarea, "focus", () => this.#options.onFocus?.(this.textarea));
		this.#listen(this.textarea, "blur", () => this.#options.onBlur?.(this.textarea));
		this.#listen(this.#options.host, "click", (event) => {
			const destination = internalReferenceDestination(event);
			if (!destination) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			this.#options.onInternalReference?.(destination);
		}, { capture: true });
	}

	#installPreviewAccessibility(): void {
		const preview = this.#instance.preview;
		preview.setAttribute("role", "button");
		preview.setAttribute("tabindex", "0");
		const editorLabel = this.textarea.getAttribute("aria-label");
		preview.setAttribute("aria-label", editorLabel ? `${editorLabel}を開始` : "Edit markdown");
		this.#listen(preview, "keydown", (rawEvent) => {
			const event = rawEvent as KeyboardEvent;
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			event.stopPropagation();
			this.#instance.focus();
		});
	}
}

export class TextareaMarkdownEditorAdapter implements MarkdownEditorAdapter {
	readonly fallback = true;
	readonly textarea: HTMLTextAreaElement;
	readonly #options: MarkdownEditorAdapterOptions;
	readonly #cleanup: Array<() => void> = [];
	#compositionGuard = false;
	#compositionDirty = false;
	#compositionStartValue = "";
	#compositionTimer?: ReturnType<typeof globalThis.setTimeout>;
	#destroyed = false;

	constructor(options: MarkdownEditorAdapterOptions) {
		this.#options = options;
		options.host.replaceChildren();
		this.textarea = document.createElement("textarea");
		this.textarea.value = options.value;
		for (const [name, value] of Object.entries(options.textareaAttributes ?? {})) {
			this.textarea.setAttribute(name, value);
		}
		options.host.append(this.textarea);
		this.#listen("input", () => {
			if (this.#compositionGuard) {
				this.#compositionDirty = true;
				return;
			}
			options.onChange(this.textarea.value, this.textarea);
		});
		this.#listen("compositionstart", () => {
			this.#compositionGuard = true;
			this.#compositionDirty = false;
			this.#compositionStartValue = this.textarea.value;
		});
		this.#listen("compositionend", () => {
			if (this.#compositionTimer !== undefined) clearTimeout(this.#compositionTimer);
			this.#compositionTimer = globalThis.setTimeout(() => {
				this.#compositionTimer = undefined;
				if (this.#destroyed) return;
				this.#compositionGuard = false;
				if (this.textarea.value !== this.#compositionStartValue) {
					this.#compositionDirty = false;
					options.onChange(this.textarea.value, this.textarea);
				}
			}, 0);
		});
		this.#listen("keydown", (rawEvent) => {
			const event = rawEvent as KeyboardEvent;
			options.onKeydown?.(
				event,
				this.textarea,
				this.#compositionGuard || event.isComposing || event.keyCode === 229,
			);
		}, { capture: true });
		for (const type of ["select", "keyup", "click", "input", "scroll"]) {
			this.#listen(type, () => options.onSelectionChange?.(this.textarea));
		}
		this.#listen("focus", () => options.onFocus?.(this.textarea));
		this.#listen("blur", () => options.onBlur?.(this.textarea));
	}

	getValue(): string {
		return this.textarea.value;
	}

	setValue(value: string): void {
		if (this.textarea.value === value) return;
		const selection = this.getSelection();
		const scrollTop = this.textarea.scrollTop;
		const scrollLeft = this.textarea.scrollLeft;
		this.textarea.value = value;
		this.setSelection({
			start: Math.min(selection.start, value.length),
			end: Math.min(selection.end, value.length),
			direction: selection.direction,
		});
		this.textarea.scrollTop = scrollTop;
		this.textarea.scrollLeft = scrollLeft;
	}

	setMode(mode: MarkdownEditorMode): void {
		this.textarea.readOnly = mode === "preview";
		this.textarea.dataset.mode = mode;
	}

	getSelection(): MarkdownEditorSelection {
		return {
			start: this.textarea.selectionStart,
			end: this.textarea.selectionEnd,
			direction: this.textarea.selectionDirection,
		};
	}

	setSelection(selection: MarkdownEditorSelection): void {
		this.textarea.setSelectionRange(selection.start, selection.end, selection.direction);
	}

	focus(): void {
		this.textarea.focus();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		if (this.#compositionTimer !== undefined) clearTimeout(this.#compositionTimer);
		for (const cleanup of this.#cleanup.splice(0)) cleanup();
		this.textarea.remove();
	}

	#listen(
		type: string,
		listener: EventListener,
		options?: AddEventListenerOptions | boolean,
	): void {
		this.textarea.addEventListener(type, listener, options);
		this.#cleanup.push(() => this.textarea.removeEventListener(type, listener, options));
	}
}

function internalReferenceDestination(event: Event): string | null {
	const target = event.target;
	if (!(target instanceof Element)) return null;
	const anchor = target.closest("a");
	const tooltip = target.closest(".overtype-link-tooltip");
	const href = anchor?.getAttribute("href") ?? "";
	const renderedUrlPart = anchor?.querySelector(".url-part")?.textContent ?? "";
	const tooltipText = tooltip?.querySelector(".overtype-link-tooltip-url")?.textContent?.trim() ??
		"";
	return recoverRadioraDestination(href, renderedUrlPart, tooltipText);
}

export function recoverRadioraDestination(
	href: string,
	renderedUrlPart = "",
	tooltipText = "",
): string | null {
	for (
		const candidate of [
			href,
			tooltipText,
			/^\]\((.*)\)$/u.exec(renderedUrlPart.trim())?.[1] ?? "",
		]
	) {
		if (RADIORA_DESTINATION.test(candidate)) return candidate;
	}
	return null;
}
