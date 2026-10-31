import type { VisibleRow } from "./outline_view_model.ts";
import type { OutlineScrollMetrics } from "./outline_virtual_viewport_controller.svelte.ts";
import {
	virtualOutlineIndexAtOffset,
	type VirtualOutlineLayout,
} from "./virtual_outline_viewport.ts";

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

export function scrollOwnerForPanel(panel: HTMLElement): HTMLElement | Window {
	const overflowY = window.getComputedStyle(panel).overflowY;
	if (overflowY === "auto" || overflowY === "scroll") return panel;
	return findScrollContainer(panel) ?? window;
}

export function readScroll(owner: HTMLElement | Window): { top: number; left: number } {
	return "scrollTop" in owner
		? { top: owner.scrollTop, left: owner.scrollLeft }
		: { top: window.scrollY, left: window.scrollX };
}

export function writeScroll(owner: HTMLElement | Window, top: number, left: number): void {
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

/** Owns DOM scroll observation and logical-coordinate writes, never navigation state. */
export class OutlineScrollAdapter {
	metricsFor(rowsElement: HTMLElement): OutlineScrollMetrics {
		return calculateMetrics(rowsElement, findScrollContainer(rowsElement));
	}

	dropOnVirtualGap(
		event: DragEvent,
		draggedId: string | null,
		rowsElement: HTMLElement | null,
		layout: VirtualOutlineLayout,
		rows: readonly VisibleRow[],
		onDrop: (row: VisibleRow) => void,
	): void {
		const target = event.target;
		if (
			!draggedId ||
			!rowsElement ||
			(target !== event.currentTarget &&
				!(target instanceof Element && target.closest("[data-virtual-gap]")))
		)
			return;
		const index = virtualOutlineIndexAtOffset(
			layout,
			event.clientY - rowsElement.getBoundingClientRect().top,
		);
		const row = index === null ? undefined : rows[index];
		if (!row) return;
		event.preventDefault();
		event.stopPropagation();
		onDrop(row);
	}

	adjustScroll(rowsElement: HTMLElement, delta: number): void {
		if (!Number.isFinite(delta) || delta === 0) return;
		const owner = findScrollContainer(rowsElement);
		if (owner) owner.scrollTop += delta;
		else if (typeof window !== "undefined") window.scrollBy(0, delta);
	}

	scrollToLogical(rowsElement: HTMLElement, top: number): void {
		if (!Number.isFinite(top)) return;
		const owner = findScrollContainer(rowsElement);
		const rowsTop = rowsElement.getBoundingClientRect().top;
		const ownerTop = owner ? owner.getBoundingClientRect().top + owner.clientTop : 0;
		this.adjustScroll(rowsElement, rowsTop - ownerTop + Math.max(0, top));
	}

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
}
