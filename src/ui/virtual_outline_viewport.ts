export interface VirtualOutlineWindowOptions {
	readonly totalRows: number;
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly defaultRowHeight?: number;
	readonly overscan?: number;
	readonly getRowHeight?: (index: number) => number;
	readonly pinnedIndices?: readonly number[];
}

export interface VirtualOutlineWindow {
	readonly startIndex: number;
	readonly endIndex: number;
	readonly paddingTop: number;
	readonly paddingBottom: number;
	readonly totalHeight: number;
	readonly renderedIndices: readonly number[];
}

export const VIRTUAL_OUTLINE_MIN_ROWS_THRESHOLD = 50;
export const DEFAULT_OUTLINE_ROW_HEIGHT = 44;
export const DEFAULT_OUTLINE_OVERSCAN = 12;

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
		pinnedIndices = [],
	} = options;

	if (totalRows <= 0) {
		return {
			startIndex: 0,
			endIndex: -1,
			paddingTop: 0,
			paddingBottom: 0,
			totalHeight: 0,
			renderedIndices: [],
		};
	}

	let totalHeight = 0;
	const offsets: number[] = new Array(totalRows);
	const heights: number[] = new Array(totalRows);
	for (let i = 0; i < totalRows; i++) {
		offsets[i] = totalHeight;
		const h = getRowHeight(i);
		heights[i] = h;
		totalHeight += h;
	}

	if (viewportHeight <= 0 || totalRows <= VIRTUAL_OUTLINE_MIN_ROWS_THRESHOLD) {
		const renderedIndices = Array.from({ length: totalRows }, (_, i) => i);
		return {
			startIndex: 0,
			endIndex: totalRows - 1,
			paddingTop: 0,
			paddingBottom: 0,
			totalHeight,
			renderedIndices,
		};
	}

	const effectiveScrollTop = Math.max(0, scrollTop);
	const scrollBottom = effectiveScrollTop + viewportHeight;

	let firstVisible = 0;
	let low = 0;
	let high = totalRows - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (offsets[mid] + heights[mid] >= effectiveScrollTop) {
			firstVisible = mid;
			high = mid - 1;
		} else {
			low = mid + 1;
		}
	}

	let lastVisible = firstVisible;
	low = firstVisible;
	high = totalRows - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (offsets[mid] <= scrollBottom) {
			lastVisible = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	const startIndex = Math.max(0, firstVisible - overscan);
	const endIndex = Math.min(totalRows - 1, lastVisible + overscan);

	let paddingTop = 0;
	for (let i = 0; i < startIndex; i++) {
		paddingTop += heights[i];
	}

	let paddingBottom = 0;
	for (let i = endIndex + 1; i < totalRows; i++) {
		paddingBottom += heights[i];
	}

	const indexSet = new Set<number>();
	for (let i = startIndex; i <= endIndex; i++) {
		indexSet.add(i);
	}
	for (const pinned of pinnedIndices) {
		if (pinned >= 0 && pinned < totalRows) {
			indexSet.add(pinned);
		}
	}

	const renderedIndices = Array.from(indexSet).sort((a, b) => a - b);

	return {
		startIndex,
		endIndex,
		paddingTop,
		paddingBottom,
		totalHeight,
		renderedIndices,
	};
}
