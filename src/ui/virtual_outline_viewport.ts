export interface VirtualOutlineWindowOptions {
	readonly totalRows: number;
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly defaultRowHeight?: number;
	readonly overscan?: number;
	readonly getRowHeight?: (index: number) => number;
	readonly layout?: VirtualOutlineLayout;
	readonly pinnedIndices?: readonly number[];
}

export interface VirtualOutlineLayout {
	readonly offsets: readonly number[];
	readonly heights: readonly number[];
	readonly totalHeight: number;
}

export interface VirtualOutlineEntry {
	readonly index: number;
	readonly gapBefore: number;
}

export interface VirtualOutlineWindow {
	/** Sorted rendered rows, including pins, with space for every omitted row before them. */
	readonly entries: readonly VirtualOutlineEntry[];
	/** Space for omitted rows after the last rendered entry. */
	readonly trailingGap: number;
}

export const VIRTUAL_OUTLINE_MIN_ROWS_THRESHOLD = 50;
export const DEFAULT_OUTLINE_ROW_HEIGHT = 44;
export const DEFAULT_OUTLINE_OVERSCAN = 12;
export const OUTLINE_PIXEL_TOLERANCE = 0.5;

export function virtualOutlineIndexAtOffset(
	layout: VirtualOutlineLayout,
	offset: number,
): number | null {
	const { offsets, heights } = layout;
	if (heights.length === 0 || !Number.isFinite(offset)) return null;
	const y = Math.max(0, Math.min(offset, layout.totalHeight - Number.EPSILON));
	let low = 0;
	let high = heights.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (offsets[middle + 1] <= y) low = middle + 1;
		else high = middle;
	}
	return Math.min(low, heights.length - 1);
}

export function buildVirtualOutlineLayout(
	totalRows: number,
	getRowHeight: (index: number) => number = () => DEFAULT_OUTLINE_ROW_HEIGHT,
): VirtualOutlineLayout {
	const rowCount = Number.isFinite(totalRows) ? Math.max(0, Math.floor(totalRows)) : 0;
	const offsets = new Array<number>(rowCount + 1);
	const heights = new Array<number>(rowCount);
	offsets[0] = 0;

	for (let index = 0; index < rowCount; index++) {
		const measuredHeight = getRowHeight(index);
		const height =
			Number.isFinite(measuredHeight) && measuredHeight > 0
				? measuredHeight
				: DEFAULT_OUTLINE_ROW_HEIGHT;
		heights[index] = height;
		offsets[index + 1] = offsets[index] + height;
	}

	return { offsets, heights, totalHeight: offsets[rowCount] };
}

function emptyWindow(): VirtualOutlineWindow {
	return {
		entries: [],
		trailingGap: 0,
	};
}

function visibleRange(
	layout: VirtualOutlineLayout,
	scrollTop: number,
	viewportHeight: number,
	overscan: number,
): { startIndex: number; endIndex: number } {
	const { offsets, heights } = layout;
	const rowCount = heights.length;
	const effectiveScrollTop = Math.min(
		Math.max(0, Number.isNaN(scrollTop) ? 0 : scrollTop),
		Math.max(0, layout.totalHeight - viewportHeight),
	);
	const scrollBottom = effectiveScrollTop + viewportHeight;
	let low = 0;
	let high = rowCount;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (offsets[mid + 1] <= effectiveScrollTop) low = mid + 1;
		else high = mid;
	}
	const firstVisible = Math.min(low, rowCount - 1);
	low = firstVisible;
	high = rowCount;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (offsets[mid] <= scrollBottom) low = mid + 1;
		else high = mid;
	}
	const lastVisible = Math.max(firstVisible, Math.min(rowCount - 1, low - 1));
	return {
		startIndex: Math.max(0, firstVisible - overscan),
		endIndex: Math.min(rowCount - 1, lastVisible + overscan),
	};
}

function renderedIndices(
	startIndex: number,
	endIndex: number,
	rowCount: number,
	pinnedIndices: readonly number[],
): number[] {
	const indices = new Set<number>();
	for (let index = startIndex; index <= endIndex; index++) indices.add(index);
	for (const pinned of pinnedIndices) {
		if (Number.isInteger(pinned) && pinned >= 0 && pinned < rowCount) indices.add(pinned);
	}
	return Array.from(indices).sort((a, b) => a - b);
}

function entriesAndTrailingGap(
	offsets: readonly number[],
	totalHeight: number,
	indices: readonly number[],
): { entries: VirtualOutlineEntry[]; trailingGap: number } {
	let cursor = 0;
	const entries = indices.map((index) => {
		const entry = { index, gapBefore: offsets[index] - cursor };
		cursor = offsets[index + 1];
		return entry;
	});
	return { entries, trailingGap: totalHeight - cursor };
}

export function calculateVirtualOutlineWindow(
	options: VirtualOutlineWindowOptions,
): VirtualOutlineWindow {
	const {
		totalRows,
		scrollTop,
		viewportHeight,
		defaultRowHeight = DEFAULT_OUTLINE_ROW_HEIGHT,
		overscan = DEFAULT_OUTLINE_OVERSCAN,
		getRowHeight = () => defaultRowHeight,
		layout: suppliedLayout,
		pinnedIndices = [],
	} = options;
	const layout = suppliedLayout ?? buildVirtualOutlineLayout(totalRows, getRowHeight);
	const { offsets, heights, totalHeight } = layout;
	const rowCount = heights.length;
	const windowOverscan = Number.isFinite(overscan) ? Math.max(0, Math.floor(overscan)) : 0;

	if (rowCount <= 0) return emptyWindow();
	let startIndex = 0;
	let endIndex = rowCount - 1;
	if (rowCount > VIRTUAL_OUTLINE_MIN_ROWS_THRESHOLD) {
		if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
			endIndex = Math.min(rowCount - 1, windowOverscan);
		} else {
			({ startIndex, endIndex } = visibleRange(layout, scrollTop, viewportHeight, windowOverscan));
		}
	}
	const indices = renderedIndices(startIndex, endIndex, rowCount, pinnedIndices);
	return entriesAndTrailingGap(offsets, totalHeight, indices);
}
