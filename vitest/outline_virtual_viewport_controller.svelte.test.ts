import { expect, it, vi } from "vitest";
import { OutlineVirtualViewportController } from "../src/ui/outline_virtual_viewport_controller.svelte.ts";

function fixture(initial = ["a", "b", "c"]) {
	let rows = initial;
	let protectedIds: string[] = [];
	const focusFallback = vi.fn();
	const viewport = new OutlineVirtualViewportController({
		rowIds: () => rows,
		protectedIds: () => protectedIds,
		focusFallback,
	});
	viewport.refreshProjection();
	return {
		viewport,
		focusFallback,
		rows(ids: string[]) {
			rows = ids;
			viewport.refreshProjection();
		},
		protect(ids: string[]) {
			protectedIds = ids;
			viewport.refreshProjection();
		},
	};
}
const ids = (length = 100) => Array.from({ length }, (_, index) => `row-${index}`);
const indices = (viewport: OutlineVirtualViewportController) =>
	viewport.window.entries.map((entry) => entry.index);

it("reuses the prefix layout during scroll-only updates", () => {
	const { viewport } = fixture(ids(1000));
	const layout = viewport.layout;
	for (let index = 0; index < 100; index++) {
		viewport.observeScroll({ scrollTop: index * 44, viewportHeight: 440 });
	}
	expect(viewport.layout).toBe(layout);
	expect(indices(viewport)[0]).toBeGreaterThan(0);
});

it("coalesces height reports against the original anchor and reads back clamped scroll", () => {
	const { viewport } = fixture(ids());
	viewport.observeScroll({ scrollTop: 100, viewportHeight: 100 });
	const initial = viewport.layout;
	expect(viewport.measureRow("row-0", 44.49)).toBe(false);
	expect(viewport.layout).toBe(initial);
	viewport.measureRow("row-0", 60);
	viewport.measureRow("row-1", 80);
	expect(viewport.takeAnchorAdjustment()).toBe(52);
	viewport.observeScroll({ scrollTop: 140, viewportHeight: 100 });
	viewport.measureRow("row-0", 70);
	expect(viewport.takeAnchorAdjustment()).toBe(10);
});

it("lets an intervening user scroll supersede a pending anchor", () => {
	const { viewport } = fixture(ids());
	viewport.observeScroll({ scrollTop: 100, viewportHeight: 100 });
	viewport.measureRow("row-0", 60);
	viewport.observeScroll({ scrollTop: 300, viewportHeight: 100 });
	expect(viewport.takeAnchorAdjustment()).toBe(0);
	viewport.measureRow("row-0", 70);
	expect(viewport.takeAnchorAdjustment()).toBe(10);
});

it("invalidates offscreen heights on width changes and removes deleted measurements", () => {
	const f = fixture();
	const v = f.viewport;
	v.measureRow("a", 60);
	v.measureRow("b", 80);
	v.measureRow("c", 96);
	v.observeScroll({ scrollTop: 100, viewportHeight: 40 });
	expect(v.observeWidth(600, ["b"])).toBe(true);
	expect(v.layout.heights).toEqual([44, 80, 44]);
	expect(v.takeAnchorAdjustment()).toBe(-16);
	expect(v.observeWidth(600, [])).toBe(false);
	f.rows(["b", "c"]);
	expect(v.layout.heights).toEqual([80, 44]);
});

it("uses the next row at the same index when the anchor disappears", () => {
	const f = fixture(["a", "b", "c", "d"]);
	f.viewport.observeScroll({ scrollTop: 50, viewportHeight: 100 });
	f.rows(["a", "c", "d"]);
	expect(f.viewport.takeAnchorAdjustment()).toBe(0);
	f.viewport.observeScroll({ scrollTop: 100, viewportHeight: 100 });
	f.rows(["a", "c"]);
	expect(f.viewport.takeAnchorAdjustment()).toBe(-44);
});

it("pins selection, focus and composition, and releases them on disconnect", () => {
	const f = fixture(ids());
	const v = f.viewport;
	v.observeScroll({ scrollTop: 0, viewportHeight: 44 });
	f.protect(["row-80", "row-80", "missing"]);
	expect(indices(v).filter((index) => index === 80)).toHaveLength(1);
	f.protect([]);
	v.trackFocusIn("row-80");
	v.trackCompositionStart("row-80");
	v.trackCompositionEnd("row-80", "row-80");
	expect(indices(v)).toContain(80);
	v.trackFocusOut("row-80", null);
	expect(indices(v)).not.toContain(80);
	v.trackCompositionStart("row-80");
	v.disconnect();
	expect(indices(v)).not.toContain(80);
});

it("requests a visible selection or next row when a focused/composing row disappears", () => {
	const f = fixture(["parent", "child", "next"]);
	f.viewport.trackFocusIn("child");
	f.viewport.trackCompositionStart("child");
	f.protect(["parent"]);
	f.rows(["parent", "next"]);
	expect(f.focusFallback).toHaveBeenLastCalledWith("parent");
	f.viewport.trackFocusIn("next");
	f.protect([]);
	f.rows(["parent"]);
	expect(f.focusFallback).toHaveBeenLastCalledWith("parent");
});

it("computes nearest scroll positions before mounting a logical row", () => {
	const { viewport: v } = fixture(ids());
	v.observeScroll({ scrollTop: 0, viewportHeight: 100 });
	expect(v.scrollTopFor("row-0")).toBe(0);
	expect(v.scrollTopFor("row-3")).toBe(76);
	expect(v.scrollTopFor("row-99")).toBe(4300);
	expect(v.scrollTopFor("missing")).toBeNull();
});
