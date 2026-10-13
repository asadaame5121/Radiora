import { assert, assertEquals } from "jsr:@std/assert@1";
import {
	calculateVirtualOutlineWindow,
	type VirtualOutlineWindowOptions,
} from "../src/ui/virtual_outline_viewport.ts";

Deno.test("calculateVirtualOutlineWindow returns all rows when viewport height is 0 or unmeasured", () => {
	const win = calculateVirtualOutlineWindow({
		totalRows: 100,
		scrollTop: 0,
		viewportHeight: 0,
	});
	assertEquals(win.startIndex, 0);
	assertEquals(win.endIndex, 99);
	assertEquals(win.renderedIndices.length, 100);
	assertEquals(win.paddingTop, 0);
	assertEquals(win.paddingBottom, 0);
});

Deno.test("calculateVirtualOutlineWindow returns all rows for small datasets <= 50", () => {
	const win = calculateVirtualOutlineWindow({
		totalRows: 30,
		scrollTop: 100,
		viewportHeight: 600,
	});
	assertEquals(win.startIndex, 0);
	assertEquals(win.endIndex, 29);
	assertEquals(win.renderedIndices.length, 30);
	assertEquals(win.paddingTop, 0);
	assertEquals(win.paddingBottom, 0);
});

Deno.test("calculateVirtualOutlineWindow constrains rendered rows to viewport + overscan for 10,000 rows", () => {
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
	assertEquals(win.startIndex, 90);
	assertEquals(win.endIndex, 120);
	assertEquals(win.renderedIndices.length, 31);

	// Padding keeps the scrollable document height accurate
	assertEquals(win.paddingTop, 90 * 44);
	assertEquals(win.paddingBottom, (10000 - 121) * 44);
	assertEquals(win.totalHeight, 10000 * 44);
	assertEquals(win.paddingTop + 31 * 44 + win.paddingBottom, win.totalHeight);
});

Deno.test("calculateVirtualOutlineWindow preserves pinned editing row even when scrolled far out of view", () => {
	const win = calculateVirtualOutlineWindow({
		totalRows: 10000,
		scrollTop: 0,
		viewportHeight: 440,
		defaultRowHeight: 44,
		overscan: 5,
		pinnedIndices: [5000], // user is editing row 5000 while scrolled to top
	});

	// Main window is rows 0..15
	assertEquals(win.startIndex, 0);
	assertEquals(win.endIndex, 15);
	// Pinned row 5000 must be included in renderedIndices to preserve DOM/IME focus
	assert(win.renderedIndices.includes(5000));
	assertEquals(win.renderedIndices.length, 17); // 16 window rows + 1 pinned
});
