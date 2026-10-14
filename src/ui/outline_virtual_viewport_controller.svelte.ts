import type { OutlineScrollMetrics } from "./outline_viewport_adapter.ts";
import {
	buildVirtualOutlineLayout,
	calculateVirtualOutlineWindow,
	DEFAULT_OUTLINE_ROW_HEIGHT,
	OUTLINE_PIXEL_TOLERANCE,
	type VirtualOutlineLayout,
	type VirtualOutlineWindow,
} from "./virtual_outline_viewport.ts";

function editorIdFromTarget(target: EventTarget | null): string | null {
	return target instanceof Element
		? target.closest<HTMLTextAreaElement>("textarea[data-item-id]")?.dataset.itemId ?? null
		: null;
}

interface ScrollAnchor {
	readonly id: string;
	readonly index: number;
	readonly offset: number;
}

/** Owns only the measured layout cache used to render the live Outline viewport. */
export class OutlineVirtualViewportController {
	private liveRowIds = $state<string[]>([]);
	private liveMetrics = $state<OutlineScrollMetrics>({ scrollTop: 0, viewportHeight: 0 });
	private liveProtectedIds = $state<string[]>([]);
	private ownerProtectedIds: string[] = [];
	private readonly focusedIds = new Set<string>();
	private readonly composingIds = new Set<string>();
	private readonly measuredHeights = new Map<string, number>();
	private rowIndexById = new Map<string, number>();
	private heightVersion = $state(0);
	private cachedLayoutVersion = -1;
	private cachedLayout = buildVirtualOutlineLayout(0, () => DEFAULT_OUTLINE_ROW_HEIGHT);
	private scrollAnchor: ScrollAnchor | null = null;
	private pendingAnchor: ScrollAnchor | null = null;
	private contentWidth: number | null = null;

	private readonly liveWindow = $derived.by(() => {
		const pinnedIndices = this.liveProtectedIds.flatMap((id) => {
			const index = this.rowIndexById.get(id);
			return index === undefined ? [] : [index];
		});
		return calculateVirtualOutlineWindow({
			totalRows: this.liveRowIds.length,
			scrollTop: this.liveMetrics.scrollTop,
			viewportHeight: this.liveMetrics.viewportHeight,
			layout: this.layout,
			pinnedIndices,
		});
	});

	get rowIds(): readonly string[] {
		return this.liveRowIds;
	}

	get metrics(): OutlineScrollMetrics {
		return this.liveMetrics;
	}

	get layout(): VirtualOutlineLayout {
		const version = this.heightVersion;
		if (version !== this.cachedLayoutVersion) {
			this.cachedLayout = this.buildLayout();
			this.cachedLayoutVersion = version;
		}
		return this.cachedLayout;
	}

	get window(): VirtualOutlineWindow {
		return this.liveWindow;
	}

	scrollTopFor(id: string): number | null {
		const index = this.rowIndexById.get(id);
		if (index === undefined) return null;
		const rowTop = this.layout.offsets[index];
		const rowBottom = this.layout.offsets[index + 1];
		const { scrollTop, viewportHeight } = this.liveMetrics;
		const target = rowTop < scrollTop
			? rowTop
			: rowBottom > scrollTop + viewportHeight
			? rowBottom - viewportHeight
			: scrollTop;
		return Math.min(Math.max(0, target), Math.max(0, this.layout.totalHeight - viewportHeight));
	}

	setRows(ids: readonly string[]): void {
		if (
			ids.length === this.liveRowIds.length &&
			ids.every((id, index) => id === this.liveRowIds[index])
		) return;
		this.preserveAnchor();
		const next = [...ids];
		const nextIndices = new Map(next.map((id, index) => [id, index]));
		for (const id of this.measuredHeights.keys()) {
			if (!nextIndices.has(id)) this.measuredHeights.delete(id);
		}
		this.rowIndexById = nextIndices;
		this.liveRowIds = next;
		this.heightVersion++;
	}

	setMetrics(metrics: OutlineScrollMetrics): void {
		const next = {
			scrollTop: Number.isFinite(metrics.scrollTop) ? Math.max(0, metrics.scrollTop) : 0,
			viewportHeight: Number.isFinite(metrics.viewportHeight)
				? Math.max(0, metrics.viewportHeight)
				: 0,
		};
		if (
			next.scrollTop === this.liveMetrics.scrollTop &&
			next.viewportHeight === this.liveMetrics.viewportHeight
		) return;
		if (next.scrollTop !== this.liveMetrics.scrollTop) this.pendingAnchor = null;
		this.liveMetrics = next;
		if (!this.pendingAnchor) this.scrollAnchor = this.captureAnchor();
	}

	setProtectedIds(ids: readonly string[]): void {
		const next = [...new Set(ids)];
		if (
			next.length === this.ownerProtectedIds.length &&
			next.every((id, index) => id === this.ownerProtectedIds[index])
		) return;
		this.ownerProtectedIds = next;
		this.publishProtectedIds();
	}

	releaseProtectedRows(): void {
		this.ownerProtectedIds = [];
		this.focusedIds.clear();
		this.composingIds.clear();
		this.publishProtectedIds();
	}

	trackFocusIn(target: EventTarget | null): void {
		const id = editorIdFromTarget(target);
		if (id) this.focusedIds.add(id);
		this.publishProtectedIds();
	}

	trackFocusOut(target: EventTarget | null, relatedTarget: EventTarget | null): void {
		const id = editorIdFromTarget(target);
		if (id && editorIdFromTarget(relatedTarget) !== id) this.focusedIds.delete(id);
		this.publishProtectedIds();
	}

	trackCompositionStart(target: EventTarget | null): void {
		const id = editorIdFromTarget(target);
		if (id) this.composingIds.add(id);
		this.publishProtectedIds();
	}

	trackCompositionEnd(target: EventTarget | null): void {
		const id = editorIdFromTarget(target);
		if (id) {
			this.composingIds.delete(id);
			if (document.activeElement !== target) this.focusedIds.delete(id);
		}
		this.publishProtectedIds();
	}

	reportHeight(id: string, height: number): boolean {
		const index = this.rowIndexById.get(id);
		if (index === undefined || !Number.isFinite(height) || height <= 0) return false;
		const previousHeight = this.measuredHeights.get(id) ?? DEFAULT_OUTLINE_ROW_HEIGHT;
		if (Math.abs(previousHeight - height) < OUTLINE_PIXEL_TOLERANCE) return false;
		this.preserveAnchor();
		this.measuredHeights.set(id, height);
		this.heightVersion++;
		return true;
	}

	setWidth(width: number, visibleIds: readonly string[]): boolean {
		if (!Number.isFinite(width) || width <= 0 || width === this.contentWidth) return false;
		this.contentWidth = width;
		const visible = new Set(visibleIds);
		const invalidated = [...this.measuredHeights.keys()].filter((id) => !visible.has(id));
		if (invalidated.length === 0) return false;
		this.preserveAnchor();
		for (const id of invalidated) this.measuredHeights.delete(id);
		this.heightVersion++;
		return true;
	}

	takeAnchorAdjustment(): number {
		const anchor = this.pendingAnchor;
		this.pendingAnchor = null;
		if (!anchor) return 0;
		if (this.liveRowIds.length === 0) return -this.liveMetrics.scrollTop;
		const index = this.rowIndexById.get(anchor.id) ??
			Math.min(anchor.index, this.liveRowIds.length - 1);
		const rowHeight = this.layout.heights[index];
		const offset = Math.min(anchor.offset, rowHeight);
		return this.layout.offsets[index] + offset - this.liveMetrics.scrollTop;
	}

	private preserveAnchor(): void {
		if (!this.pendingAnchor) this.pendingAnchor = this.scrollAnchor ?? this.captureAnchor();
	}

	private publishProtectedIds(): void {
		const next = [
			...new Set([
				...this.ownerProtectedIds,
				...this.focusedIds,
				...this.composingIds,
			]),
		];
		if (
			next.length === this.liveProtectedIds.length &&
			next.every((id, index) => id === this.liveProtectedIds[index])
		) return;
		this.liveProtectedIds = next;
	}

	private captureAnchor(): ScrollAnchor | null {
		if (this.liveRowIds.length === 0) return null;
		const { offsets, heights } = this.layout;
		const scrollTop = this.liveMetrics.scrollTop;
		let low = 0;
		let high = heights.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (offsets[middle + 1] <= scrollTop) low = middle + 1;
			else high = middle;
		}
		const index = Math.min(low, heights.length - 1);
		return {
			id: this.liveRowIds[index],
			index,
			offset: scrollTop - offsets[index],
		};
	}

	private buildLayout(): VirtualOutlineLayout {
		return buildVirtualOutlineLayout(
			this.liveRowIds.length,
			(index) => this.measuredHeights.get(this.liveRowIds[index]) ?? DEFAULT_OUTLINE_ROW_HEIGHT,
		);
	}
}
