import {
	type CommandId,
	isEditableTarget,
	type ShortcutBinding,
	shortcutForKeyboardEvent,
} from "./command_service.ts";
import { IME_PROCESS_KEY_CODE } from "./keyboard_controller.svelte.ts";
interface GlobalKeyboardPorts {
	chord: {
		handle(event: KeyboardEvent): boolean;
		cancel(restore?: boolean): void;
		readonly open: boolean;
	};
	blocked(): boolean;
	specialBlocked(): boolean;
	help(): void;
	togglePalette(): void;
	focusPane(reverse: boolean): void;
	treeVisible(): boolean;
	bindings: readonly ShortcutBinding[];
	execute(id: CommandId): Promise<void>;
	reportError(cause: unknown): void;
}
export class GlobalKeyboardAdapter {
	constructor(private readonly ports: GlobalKeyboardPorts) {}
	handle = (event: KeyboardEvent): void => {
		if (this.ports.chord.handle(event)) return;
		if (event.isComposing || event.keyCode === IME_PROCESS_KEY_CODE || event.defaultPrevented) {
			return;
		}
		if (this.handleSpecial(event)) return;
		if (this.ports.blocked()) return;
		if (this.handlePaneFocus(event)) return;
		if (this.isSpaceToggle(event)) {
			event.preventDefault();
			if (!event.repeat) this.execute(this.ports.treeVisible() ? "showOutline" : "showTree");
			return;
		}
		const shortcut = shortcutForKeyboardEvent(event);
		const id = shortcut === "Alt+."
			? "hoist"
			: this.ports.bindings.find((binding) => binding.shortcut === shortcut)?.commandId;
		if (!id) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (!event.repeat) this.execute(id);
	};
	private handlePaneFocus(event: KeyboardEvent): boolean {
		if (event.key === "F6" && !event.ctrlKey && !event.altKey && !event.metaKey) {
			event.preventDefault();
			if (!event.repeat) this.ports.focusPane(event.shiftKey);
			return true;
		}

		return false;
	}
	private execute(id: CommandId): void {
		void this.ports.execute(id).catch(this.ports.reportError);
	}
	private handleSpecial(event: KeyboardEvent): boolean {
		const help = (event.key === "F1" && !event.ctrlKey && !event.altKey && !event.shiftKey &&
			!event.metaKey) ||
			(event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey &&
				["/", "?"].includes(event.key));
		const palette = event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey &&
			event.key.toLowerCase() === "k";
		if (!help && !palette) return false;
		// Allow palette toggle/Help from the palette, but suppress unrelated modal dialogs.
		event.preventDefault();
		event.stopImmediatePropagation();
		if (this.ports.specialBlocked()) return true;
		if (event.repeat) return true;
		if (help) this.ports.help();
		else this.ports.togglePalette();
		return true;
	}
	private isSpaceToggle(event: KeyboardEvent): boolean {
		return event.key === " " && !event.ctrlKey && !event.altKey && !event.shiftKey &&
			!event.metaKey && !isEditableTarget(event.target) &&
			!(event.target instanceof HTMLElement && event.target.closest("button, a, [role='button']"));
	}
	connect(target: Window = window): () => void {
		const cancel = () => this.ports.chord.cancel(false);
		const outside = (event: PointerEvent) => {
			if (
				this.ports.chord.open &&
				!(event.target instanceof Element && event.target.closest("[data-shortcut-navigation]"))
			) cancel();
		};
		target.addEventListener("keydown", this.handle, true);
		target.addEventListener("pointerdown", outside, true);
		target.addEventListener("blur", cancel);
		target.addEventListener("compositionstart", cancel, true);
		return () => {
			target.removeEventListener("keydown", this.handle, true);
			target.removeEventListener("pointerdown", outside, true);
			target.removeEventListener("blur", cancel);
			target.removeEventListener("compositionstart", cancel, true);
			cancel();
		};
	}
}
