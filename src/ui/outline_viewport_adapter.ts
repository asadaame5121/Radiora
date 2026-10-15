import { tick } from "svelte";
import { captureEditorPosition, focusOutlineEditor } from "./editor_return_controller.svelte.ts";
import type { OutlineViewport } from "./outline_screen_state.svelte.ts";

import type { OutlineScrollMetrics } from "./outline_virtual_viewport_controller.svelte.ts";
export type { OutlineScrollMetrics } from "./outline_virtual_viewport_controller.svelte.ts";

function findScrollContainer(element: HTMLElement): HTMLElement | null {
	let current: HTMLElement | null = element.parentElement;
	while (current) {
		if (typeof window !== "undefined") {
			const style = window.getComputedStyle(current);
			const overflowY = style.overflowY;
			if (overflowY === "auto" || overflowY === "scroll") {
				return current;
			}
		}
		current = current.parentElement;
	}
	return null;
}

function scrollOwnerForPanel(panel: HTMLElement): HTMLElement | Window {
	const overflowY = window.getComputedStyle(panel).overflowY;
	if (overflowY === "auto" || overflowY === "scroll") return panel;
	return findScrollContainer(panel) ?? window;
}

function readScroll(owner: HTMLElement | Window): { top: number; left: number } {
	return "scrollTop" in owner
		? { top: owner.scrollTop, left: owner.scrollLeft }
		: { top: window.scrollY, left: window.scrollX };
}

function writeScroll(owner: HTMLElement | Window, top: number, left: number): void {
	if ("scrollTop" in owner) {
		owner.scrollTop = top;
		owner.scrollLeft = left;
	} else {
		window.scrollTo(left, top);
	}
}

function calculateMetrics(
	rowsElement: HTMLElement,
	container: HTMLElement | null,
): OutlineScrollMetrics {
	if (container) {
		const containerRect = container.getBoundingClientRect();
		const rowsRect = rowsElement.getBoundingClientRect();
		const innerTop = containerRect.top + container.clientTop;
		const scrollTop = Math.max(0, innerTop - rowsRect.top);
		const viewportHeight = container.clientHeight;
		return { scrollTop, viewportHeight };
	}
	if (typeof window !== "undefined") {
		const rowsRect = rowsElement.getBoundingClientRect();
		const scrollTop = Math.max(0, -rowsRect.top);
		const viewportHeight = window.innerHeight;
		return { scrollTop, viewportHeight };
	}
	return { scrollTop: 0, viewportHeight: 0 };
}

/** DOM identity is recreated after render; only coordinates and logical targets are retained. */
export class OutlineViewportAdapter {
	private paneScroll: NonNullable<OutlineViewport["paneScroll"]> = {};
	private focusedItem: string | null = null;
	private focusedPosition: ReturnType<typeof captureEditorPosition> | undefined;
	private focus: OutlineViewport["focus"] = "rows";

	observeRows(
		rowsElement: HTMLElement,
		publishMetrics: (metrics: OutlineScrollMetrics) => void,
	): () => void {
		let currentOwner: HTMLElement | null = null;
		let disposed = false;
		let observer: ResizeObserver | null = null;

		const updateMetrics = () => {
			if (disposed) return;
			const metrics = calculateMetrics(rowsElement, currentOwner);
			publishMetrics(metrics);
		};

		const detachOwner = () => {
			const target = currentOwner ?? (typeof window === "undefined" ? null : window);
			target?.removeEventListener("scroll", updateMetrics);
			if (observer && currentOwner) observer.unobserve(currentOwner);
		};

		const attachOwner = (owner: HTMLElement | null) => {
			currentOwner = owner;
			const target = owner ?? (typeof window === "undefined" ? null : window);
			target?.addEventListener("scroll", updateMetrics, { passive: true });
			if (observer && owner) observer.observe(owner);
		};

		const reResolve = () => {
			if (disposed) return;
			const nextOwner = findScrollContainer(rowsElement);
			if (nextOwner !== currentOwner) {
				detachOwner();
				attachOwner(nextOwner);
			}
			updateMetrics();
		};

		if (typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver(() => {
				reResolve();
			});
			observer.observe(rowsElement);
		}

		attachOwner(findScrollContainer(rowsElement));
		updateMetrics();

		if (typeof window !== "undefined") {
			window.addEventListener("resize", reResolve, { passive: true });
		}

		return () => {
			disposed = true;
			detachOwner();
			if (observer) {
				observer.disconnect();
				observer = null;
			}
			if (typeof window !== "undefined") {
				window.removeEventListener("resize", reResolve);
			}
		};
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
			if (id) this.paneScroll[id] = { top: panel.scrollTop, left: panel.scrollLeft };
		}
	}

	async restorePanels(current: () => boolean): Promise<void> {
		await tick();
		if (!current()) return;
		for (const panel of document.querySelectorAll<HTMLElement>(".outline-panel[data-pane-id]")) {
			const scroll = this.paneScroll[panel.dataset.paneId ?? ""];
			panel.scrollTop = scroll?.top ?? 0;
			panel.scrollLeft = scroll?.left ?? 0;
		}
	}

	async restorePane(itemId: string | null, current: () => boolean): Promise<void> {
		await focusOutlineEditor(itemId, undefined, current, false);
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
		let editorPosition = selectedId ? captureEditorPosition(selectedId, hoistId) : undefined;
		if (
			selectedId && this.focusedItem === selectedId &&
			!document.querySelector(`textarea[data-item-id="${CSS.escape(selectedId)}"]`)
		) editorPosition = this.focusedPosition;
		if (longForm && selectedId) editorPosition = this.captureManuscript(selectedId, hoistId);
		return {
			editorPosition,
			paneScroll: structuredClone(this.paneScroll),
			panelScrollTop: panel?.scrollTop ?? 0,
			panelScrollLeft: panel?.scrollLeft ?? 0,
			focus: longForm ? "long-form" : this.focus,
		};
	}

	private captureManuscript(itemId: string, hoistId: string | null) {
		const textarea = document.querySelector<HTMLTextAreaElement>(".long-form-textarea");
		if (!textarea) return undefined;
		return captureEditorPosition(itemId, hoistId, textarea);
	}

	async restore(viewport: OutlineViewport, current: () => boolean): Promise<void> {
		await tick();
		if (!current()) return;
		const position = viewport.editorPosition;
		if (viewport.focus === "long-form") {
			const textarea = document.querySelector<HTMLTextAreaElement>(".long-form-textarea");
			textarea?.focus({ preventScroll: true });
			if (textarea && position) {
				textarea.setSelectionRange(
					Math.min(position.start, textarea.value.length),
					Math.min(position.end, textarea.value.length),
					position.direction ?? "none",
				);
				textarea.scrollTop = position.scrollTop;
				textarea.scrollLeft = position.scrollLeft;
			}
		} else if (viewport.focus === "editor") {
			await focusOutlineEditor(
				position?.itemId ?? null,
				position,
				current,
				viewport.restoreScroll !== false,
			);
		} else {
			document.querySelector<HTMLElement>(
				viewport.focus === "first-item" ? ".first-item" : ".rows, .first-item",
			)?.focus({ preventScroll: true });
		}
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
			panel.scrollTop = viewport.panelScrollTop;
			panel.scrollLeft = viewport.panelScrollLeft;
		}
	}
}
