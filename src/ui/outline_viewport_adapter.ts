import { tick } from "svelte";
import { captureEditorPosition, focusOutlineEditor } from "./editor_return_controller.svelte.ts";
import type { OutlineViewport } from "./outline_screen_state.svelte.ts";
import {
	OutlineScrollAdapter,
	readScroll,
	scrollOwnerForPanel,
	writeScroll,
} from "./outline_scroll_adapter.ts";
export type { OutlineScrollMetrics } from "./outline_virtual_viewport_controller.svelte.ts";
export type EnsureOutlineRowMounted = (id: string, current: () => boolean) => Promise<boolean>;

/** DOM identity is recreated after render; only coordinates and logical targets are retained. */
export class OutlineViewportAdapter extends OutlineScrollAdapter {
	private paneScroll: NonNullable<OutlineViewport["paneScroll"]> = {};
	private focusedItem: string | null = null;
	private focusedPosition: ReturnType<typeof captureEditorPosition> | undefined;
	private focus: OutlineViewport["focus"] = "rows";
	private ensureMountedPort: EnsureOutlineRowMounted | null = null;

	registerEnsureMounted(port: EnsureOutlineRowMounted): () => void {
		this.ensureMountedPort = port;
		return () => {
			if (this.ensureMountedPort === port) this.ensureMountedPort = null;
		};
	}

	async ensureMounted(id: string, current: () => boolean): Promise<boolean> {
		// A navigation commit may run before the View's onMount registers its port.
		if (!this.ensureMountedPort) await tick();
		if (!current()) return false;
		return this.ensureMountedPort ? this.ensureMountedPort(id, current) : false;
	}

	connect(): () => void {
		const trackFocus = (event: FocusEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.matches(".long-form-textarea")) this.focus = "long-form";
			else if (target.matches("textarea[data-item-id]")) this.focus = "editor";
			else if (target.matches(".first-item")) this.focus = "first-item";
			else if (target.matches(".rows")) this.focus = "rows";
		};
		document.addEventListener("focusin", trackFocus);
		return () => document.removeEventListener("focusin", trackFocus);
	}

	capturePanels(): void {
		for (const panel of document.querySelectorAll<HTMLElement>(".outline-panel[data-pane-id]")) {
			const id = panel.dataset.paneId;
			if (!id) continue;
			this.paneScroll[id] = readScroll(scrollOwnerForPanel(panel));
		}
	}

	async restorePanels(current: () => boolean): Promise<void> {
		await tick();
		if (!current()) return;
		for (const panel of document.querySelectorAll<HTMLElement>(".outline-panel[data-pane-id]")) {
			const scroll = this.paneScroll[panel.dataset.paneId ?? ""];
			writeScroll(scrollOwnerForPanel(panel), scroll?.top ?? 0, scroll?.left ?? 0);
		}
	}

	async restorePane(itemId: string | null, current: () => boolean): Promise<void> {
		const mounted = !itemId || await this.ensureMounted(itemId, current);
		if (!current()) return;
		if (mounted) await focusOutlineEditor(itemId, undefined, current, false);
		else this.restoreOtherFocus({ focus: "rows" });
		await this.restorePanels(current);
	}

	isEditing(id: string): boolean {
		const active = typeof document !== "undefined" ? document.activeElement : null;
		if (active instanceof HTMLTextAreaElement) {
			if (active.dataset.itemId === id) return true;
			if (active.matches(".long-form-textarea") && this.focusedItem === id) return true;
		}
		return false;
	}

	track(itemId: string, hoistId: string | null, textarea: HTMLTextAreaElement): void {
		this.focusedItem = itemId;
		this.focusedPosition = captureEditorPosition(itemId, hoistId, textarea);
	}

	capture(selectedId: string | null, hoistId: string | null, longForm: boolean): OutlineViewport {
		this.capturePanels();
		const panel = document.querySelector<HTMLElement>(".outline-panel");
		const owner = panel ? scrollOwnerForPanel(panel) : null;
		const scroll = owner ? readScroll(owner) : null;
		let editorPosition = selectedId ? captureEditorPosition(selectedId, hoistId) : undefined;
		if (
			selectedId && this.focusedItem === selectedId &&
			!document.querySelector(`textarea[data-item-id="${CSS.escape(selectedId)}"]`)
		) editorPosition = this.focusedPosition;
		if (longForm && selectedId) editorPosition = this.captureManuscript(selectedId, hoistId);
		return {
			editorPosition,
			paneScroll: structuredClone(this.paneScroll),
			panelScrollTop: scroll?.top ?? 0,
			panelScrollLeft: scroll?.left ?? 0,
			focus: longForm ? "long-form" : this.focus,
		};
	}

	private captureManuscript(itemId: string, hoistId: string | null) {
		const textarea = document.querySelector<HTMLTextAreaElement>(".long-form-textarea");
		if (!textarea) return undefined;
		return captureEditorPosition(itemId, hoistId, textarea);
	}

	private restoreLongForm(position: OutlineViewport["editorPosition"]): void {
		const textarea = document.querySelector<HTMLTextAreaElement>(".long-form-textarea");
		textarea?.focus({ preventScroll: true });
		if (!textarea || !position) return;
		textarea.setSelectionRange(
			Math.min(position.start, textarea.value.length),
			Math.min(position.end, textarea.value.length),
			position.direction ?? "none",
		);
		textarea.scrollTop = position.scrollTop;
		textarea.scrollLeft = position.scrollLeft;
	}

	private async restoreEditor(
		viewport: OutlineViewport,
		current: () => boolean,
	): Promise<boolean> {
		const position = viewport.editorPosition;
		if (position?.itemId && !(await this.ensureMounted(position.itemId, current))) {
			if (!current()) return false;
			this.restoreOtherFocus({ focus: "rows" });
			return true;
		}
		if (!current()) return false;
		await focusOutlineEditor(
			position?.itemId ?? null,
			position,
			current,
			viewport.restoreScroll !== false,
		);
		return true;
	}

	private restoreOtherFocus(viewport: Pick<OutlineViewport, "focus">): void {
		document.querySelector<HTMLElement>(
			viewport.focus === "first-item" ? ".first-item" : ".rows, .first-item",
		)?.focus({ preventScroll: true });
	}

	private async restoreFocus(
		viewport: OutlineViewport,
		current: () => boolean,
	): Promise<boolean> {
		if (viewport.focus === "long-form") {
			this.restoreLongForm(viewport.editorPosition);
			return true;
		}
		if (viewport.focus === "editor") return this.restoreEditor(viewport, current);
		this.restoreOtherFocus(viewport);
		return true;
	}

	async restore(viewport: OutlineViewport, current: () => boolean): Promise<void> {
		await tick();
		if (!current()) return;
		if (!(await this.restoreFocus(viewport, current))) return;
		if (!current()) return;
		if (viewport.restoreScroll !== false) await this.restoreScroll(viewport, current);
	}

	private async restoreScroll(viewport: OutlineViewport, current: () => boolean): Promise<void> {
		if (viewport.paneScroll) {
			this.paneScroll = structuredClone(viewport.paneScroll);
			await this.restorePanels(current);
			return;
		}
		const panel = document.querySelector<HTMLElement>(".outline-panel");
		if (panel) {
			writeScroll(scrollOwnerForPanel(panel), viewport.panelScrollTop, viewport.panelScrollLeft);
		}
	}
}
