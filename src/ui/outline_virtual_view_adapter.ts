import { tick } from "svelte";
import { OutlineScrollAdapter } from "./outline_scroll_adapter.ts";
import type { OutlineVirtualViewportController } from "./outline_virtual_viewport_controller.svelte.ts";
import { OUTLINE_PIXEL_TOLERANCE } from "./virtual_outline_viewport.ts";

export function outlineEditorId(target: EventTarget | null): string | null {
	return target instanceof Element
		? (target.closest<HTMLTextAreaElement>("textarea[data-item-id]")?.dataset.itemId ?? null)
		: null;
}

/** View-scoped DOM bindings: observers, animation frames and mount requests die together. */
export class OutlineVirtualViewAdapter extends OutlineScrollAdapter {
	private rows: HTMLElement | null = null;
	private viewport: OutlineVirtualViewportController | null = null;
	private readonly elements = new Map<string, HTMLElement>();
	private readonly ids = new WeakMap<Element, string>();
	private observer: ResizeObserver | null = null;
	private frame = 0;

	connectViewport(rows: HTMLElement, viewport: OutlineVirtualViewportController): () => void {
		this.rows = rows;
		this.viewport = viewport;
		this.observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver((entries) => {
						if (this.rows !== rows) return;
						for (const entry of entries) {
							const id = this.ids.get(entry.target);
							const height =
								entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
							if (id && viewport.measureRow(id, height)) this.scheduleAnchorAdjustment();
						}
					});
		for (const element of this.elements.values()) this.observer?.observe(element);
		const stop = this.observeRows(rows, (metrics) => {
			viewport.observeScroll(metrics);
			const visible = viewport.window.entries.map((entry) => viewport.rowIds[entry.index]);
			if (viewport.observeWidth(rows.clientWidth, visible)) this.scheduleAnchorAdjustment();
		});
		return () => {
			stop();
			this.observer?.disconnect();
			this.observer = null;
			if (this.frame) cancelAnimationFrame(this.frame);
			this.frame = 0;
			this.rows = null;
			this.viewport = null;
			viewport.disconnect();
		};
	}

	connectRow(id: string, element: HTMLElement | null): void {
		const previous = this.elements.get(id);
		if (previous && previous !== element) {
			this.observer?.unobserve(previous);
			this.ids.delete(previous);
			this.elements.delete(id);
		}
		if (!element) return;
		this.elements.set(id, element);
		this.ids.set(element, id);
		this.observer?.observe(element);
	}

	scheduleAnchorAdjustment(): void {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			const rows = this.rows;
			const viewport = this.viewport;
			if (!rows || !viewport) return;
			const delta = viewport.takeAnchorAdjustment();
			if (Math.abs(delta) < OUTLINE_PIXEL_TOLERANCE) return;
			this.adjustScroll(rows, delta);
			// Browser clamping is authoritative; never predict scrollTop by adding delta.
			viewport.observeScroll(this.metricsFor(rows));
		});
	}

	async ensureMounted(id: string, current: () => boolean): Promise<boolean> {
		const rows = this.rows;
		const viewport = this.viewport;
		if (!rows || !viewport || !current()) return false;
		const target = viewport.scrollTopFor(id);
		if (target === null) return false;
		if (Math.abs(target - viewport.metrics.scrollTop) >= OUTLINE_PIXEL_TOLERANCE) {
			this.scrollToLogical(rows, target);
			viewport.observeScroll(this.metricsFor(rows));
		}
		await tick();
		return current() && this.rows === rows && this.elements.has(id);
	}
}
