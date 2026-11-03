import { expect, test } from "vitest";
import {
	buildVirtualOutlineLayout,
	calculateVirtualOutlineWindow,
	virtualOutlineIndexAtOffset,
	type VirtualOutlineWindowOptions,
} from "../../../src/ui/virtual_outline_viewport.ts";

test("buildVirtualOutlineLayout stores prefix offsets and replaces invalid heights", () => {
	const heights = [44, 32, Number.NaN, 0, -4];
	const layout = buildVirtualOutlineLayout(heights.length, (index) => heights[index]);

	expect(layout.heights).toEqual([44, 32, 44, 44, 44]);
	expect(layout.offsets).toEqual([0, 44, 76, 120, 164, 208]);
	expect(layout.offsets.length).toEqual(layout.heights.length + 1);
	expect(layout.totalHeight).toEqual(208);
});

test("calculateVirtualOutlineWindow limits an unmeasured large dataset to the initial window", () => {
	const win = calculateVirtualOutlineWindow({
		totalRows: 100,
		scrollTop: 0,
		viewportHeight: 0,
	});
	expect(win.entries.map((entry) => entry.index)).toEqual(Array.from({ length: 13 }, (_, i) => i));
	expect(win.trailingGap).toEqual(87 * 44);
	expect(win.entries[0]).toEqual({ index: 0, gapBefore: 0 });
});

test("calculateVirtualOutlineWindow returns all rows for small datasets <= 50", () => {
	const win = calculateVirtualOutlineWindow({
		totalRows: 30,
		scrollTop: 100,
		viewportHeight: 600,
	});
	expect(win.entries).toEqual(Array.from({ length: 30 }, (_, index) => ({ index, gapBefore: 0 })));
	expect(win.trailingGap).toEqual(0);
});

test("calculateVirtualOutlineWindow keeps small datasets rendered before viewport measurement", () => {
	const win = calculateVirtualOutlineWindow({
		totalRows: 30,
		scrollTop: 0,
		viewportHeight: 0,
	});

	expect(win.entries).toEqual(Array.from({ length: 30 }, (_, index) => ({ index, gapBefore: 0 })));
	expect(win.trailingGap).toEqual(0);
});

test("calculateVirtualOutlineWindow constrains rendered rows to viewport + overscan for 10,000 rows", () => {
	const win = calculateVirtualOutlineWindow({
		totalRows: 10000,
		scrollTop: 4401, // inside row 100
		viewportHeight: 440, // 10 rows visible (100..109)
		defaultRowHeight: 44,
		overscan: 10,
	});

	// row 100 is at top, viewport fits 10 rows (100..110)
	// overscan 10 above => startIndex 90
	// overscan 10 below => endIndex 120
	expect(win.entries.map((entry) => entry.index)).toEqual(
		Array.from({ length: 31 }, (_, i) => i + 90),
	);

	// Gaps and rendered rows keep the scrollable document height accurate.
	expect(win.entries.reduce((sum, entry) => sum + entry.gapBefore + 44, win.trailingGap)).toEqual(
		10000 * 44,
	);
	expect(win.entries[0]).toEqual({ index: 90, gapBefore: 90 * 44 });
	expect(win.trailingGap).toEqual((10000 - 121) * 44);
});

test("calculateVirtualOutlineWindow preserves pinned editing row even when scrolled far out of view", () => {
	const win = calculateVirtualOutlineWindow({
		totalRows: 10000,
		scrollTop: 0,
		viewportHeight: 440,
		defaultRowHeight: 44,
		overscan: 5,
		pinnedIndices: [5000], // user is editing row 5000 while scrolled to top
	});

	// Main window is rows 0..15
	expect(win.entries.slice(0, 16).map((entry) => entry.index)).toEqual(
		Array.from({ length: 16 }, (_, i) => i),
	);
	// Pinned row 5000 must be rendered to preserve DOM/IME focus.
	expect(win.entries.some((entry) => entry.index === 5000)).toBeTruthy();
	expect(win.entries.length).toEqual(17); // 16 window rows + 1 pinned
});

test("calculateVirtualOutlineWindow uses a precomputed layout and accounts for gaps around pins", () => {
	const layout = buildVirtualOutlineLayout(100);
	let heightReads = 0;
	const options: VirtualOutlineWindowOptions = {
		totalRows: 100,
		scrollTop: 0,
		viewportHeight: 44,
		overscan: 0,
		layout,
		pinnedIndices: [50, 50, 101, -1, 1.5],
		getRowHeight: () => {
			heightReads++;
			return 44;
		},
	};
	const win = calculateVirtualOutlineWindow(options);

	expect(heightReads).toEqual(0);
	expect(win.entries).toEqual([
		{ index: 0, gapBefore: 0 },
		{ index: 1, gapBefore: 0 },
		{ index: 50, gapBefore: 48 * 44 },
	]);
	expect(win.trailingGap).toEqual(49 * 44);
	expect(
		win.entries.reduce(
			(sum, entry) => sum + entry.gapBefore + layout.heights[entry.index],
			win.trailingGap,
		),
	).toEqual(layout.totalHeight);
});

test("calculateVirtualOutlineWindow clamps beyond-end scrolling and respects row boundaries", () => {
	const layout = buildVirtualOutlineLayout(100, (index) => (index % 2 === 0 ? 10 : 20));
	const win = calculateVirtualOutlineWindow({
		totalRows: 100,
		scrollTop: Number.POSITIVE_INFINITY,
		viewportHeight: 35,
		overscan: 0,
		layout,
	});

	expect(win.entries).toEqual([
		{ index: 97, gapBefore: layout.offsets[97] },
		{ index: 98, gapBefore: 0 },
		{ index: 99, gapBefore: 0 },
	]);
	expect(win.trailingGap).toEqual(0);

	const boundary = calculateVirtualOutlineWindow({
		totalRows: 100,
		scrollTop: 440,
		viewportHeight: 44,
		overscan: 0,
	});
	expect(boundary.entries).toEqual([
		{ index: 10, gapBefore: 440 },
		{ index: 11, gapBefore: 0 },
	]);
});

test("virtualOutlineIndexAtOffset maps row offsets with variable heights and clamps edges", () => {
	const layout = buildVirtualOutlineLayout(3, (index) => [10, 20, 30][index]);
	expect(layout.offsets).toEqual([0, 10, 30, 60]);
	expect(virtualOutlineIndexAtOffset(layout, -1)).toEqual(0);
	expect(virtualOutlineIndexAtOffset(layout, 9.9)).toEqual(0);
	expect(virtualOutlineIndexAtOffset(layout, 10)).toEqual(1);
	expect(virtualOutlineIndexAtOffset(layout, 30)).toEqual(2);
	expect(virtualOutlineIndexAtOffset(layout, Number.POSITIVE_INFINITY)).toEqual(null);
	expect(virtualOutlineIndexAtOffset(buildVirtualOutlineLayout(0), 0)).toEqual(null);
});
