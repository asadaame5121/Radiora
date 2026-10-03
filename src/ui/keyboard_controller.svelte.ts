import { COMMAND_DEFINITIONS, type CommandContext, type CommandId } from "./command_service.ts";

export const IME_PROCESS_KEY_CODE = 229;

interface KeyboardPorts {
	context(): CommandContext;
	blocked(): boolean;
	execute(id: CommandId): Promise<void>;
	reportError(cause: unknown): void;
}

export class KeyboardController {
	open = $state(false);
	notice = $state("");
	private focus: Element | null = null;
	private selection:
		| { start: number; end: number; direction: "forward" | "backward" | "none" }
		| null = null;

	constructor(private readonly ports: KeyboardPorts) {}

	cancel = (restoreFocus = true): void => {
		this.open = false;
		this.notice = "";
		if (restoreFocus && this.focus?.isConnected) {
			if (this.focus instanceof HTMLElement || this.focus instanceof SVGElement) {
				this.focus.focus({ preventScroll: true });
			}
			if (this.focus instanceof HTMLTextAreaElement && this.selection) {
				this.focus.setSelectionRange(
					this.selection.start,
					this.selection.end,
					this.selection.direction,
				);
			}
		}
		this.focus = null;
		this.selection = null;
	};

	choose = async (id: CommandId): Promise<void> => {
		const command = COMMAND_DEFINITIONS.find((entry) => entry.id === id);
		if (!command || this.ports.blocked()) {
			this.cancel();
			return;
		}
		const availability = command.availability(this.ports.context());
		if (!availability.enabled) {
			this.notice = availability.reason ?? "実行できません。";
			return;
		}
		this.cancel();
		await this.ports.execute(id);
	};

	handle = (event: KeyboardEvent): boolean => {
		const composing = event.isComposing || event.keyCode === IME_PROCESS_KEY_CODE;
		if (this.reserveBrowserBack(event, composing)) return true;
		if (composing) {
			this.cancel(false);
			return false;
		}
		if (this.ports.blocked()) {
			this.cancel(false);
			return false;
		}
		const prefix = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey &&
			event.key === "/";
		if (!prefix && !this.open) return false;
		if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return true;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (event.repeat) return true;
		if (prefix) this.toggleNavigation();
		else if (event.key === "Escape") this.cancel();
		else this.chooseKey(event);
		return true;
	};

	private reserveBrowserBack(event: KeyboardEvent, composing: boolean): boolean {
		// Reserve browser Back before IME, dialog, or startup guards can skip handling.
		if (
			event.key !== "ArrowLeft" || !event.altKey || event.ctrlKey || event.shiftKey ||
			event.metaKey
		) {
			return false;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		if (composing || this.ports.blocked()) this.cancel(false);
		else if (!event.repeat) void this.choose("goBack").catch(this.ports.reportError);
		return true;
	}

	private toggleNavigation(): void {
		if (this.open) {
			this.cancel();
			return;
		}
		this.focus = document.activeElement;
		this.selection = this.focus instanceof HTMLTextAreaElement
			? {
				start: this.focus.selectionStart,
				end: this.focus.selectionEnd,
				direction: this.focus.selectionDirection,
			}
			: null;
		this.open = true;
	}

	private chooseKey(event: KeyboardEvent): void {
		const command = !event.ctrlKey && !event.altKey && !event.metaKey
			? COMMAND_DEFINITIONS.find((entry) => entry.chordKey === event.key.toLowerCase())
			: undefined;
		if (command) void this.choose(command.id).catch(this.ports.reportError);
		else this.notice = "該当する操作はありません。次のキーを選ぶか、Escで取り消してください。";
	}
}

export function moveTreeFocus(event: KeyboardEvent, svg: SVGSVGElement): boolean {
	if (
		event.isComposing || event.ctrlKey || event.altKey || event.metaKey ||
		!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
	) return false;
	event.preventDefault();
	// ponytail: traverse rendered nodes in order; spatial navigation can replace this if needed.
	const nodes = [...svg.querySelectorAll<SVGElement>(".tree-node")];
	const index = nodes.findIndex((element) => element === event.currentTarget);
	const delta = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
	const next = nodes[Math.max(0, Math.min(nodes.length - 1, index + delta))];
	next?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	next?.focus();
	return true;
}

export function focusWorkspacePane(reverse: boolean): void {
	const panes = [
		document.querySelector<HTMLElement>(".omniwindow input"),
		document.querySelector<HTMLElement>(
			".row.selected textarea[data-item-id], .long-form-textarea, .tree-node.selected",
		) ?? document.querySelector<HTMLElement>(".rows, .tree-node, .tree-root svg"),
		document.querySelector<HTMLElement>(
			".inspector [role=tab], .inspector input, .inspector button",
		),
		document.querySelector<HTMLElement>(".primary-nav button"),
	].filter((element): element is HTMLElement =>
		Boolean(element && element.getClientRects().length)
	);
	if (!panes.length) return;
	const active = document.activeElement;
	const index = panes.findIndex((pane) =>
		pane === active ||
		pane.closest(".omniwindow, .outline-panel, .tree-root, .inspector, .primary-nav")?.contains(
			active,
		)
	);
	const next = index < 0
		? (reverse ? panes.length - 1 : 0)
		: (index + (reverse ? panes.length - 1 : 1)) % panes.length;
	panes[next].focus();
}
