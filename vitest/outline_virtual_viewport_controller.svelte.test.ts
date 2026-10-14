import { afterEach, expect, it, vi } from "vitest";
import { OutlineVirtualViewportController } from "../src/ui/outline_virtual_viewport_controller.svelte.ts";

afterEach(() => vi.unstubAllGlobals());

it("reuses the prefix layout during scroll-only updates", () => {
	const viewport = new OutlineVirtualViewportController();
	const ids = Array.from({ length: 1000 }, (_, index) => `row-${index}`);
	viewport.setRows(ids);
	ids[0] = "changed-outside";
	const layout = viewport.layout;

	for (let index = 0; index < 100; index++) {
		viewport.setMetrics({ scrollTop: index * 44, viewportHeight: 440 });
	}

	expect(viewport.rowIds[0]).toBe("row-0");
	expect(viewport.layout).toBe(layout);
	expect(viewport.window.startIndex).toBeGreaterThan(0);
});

it("updates cached heights only at the half-pixel threshold and preserves the row anchor", () => {
	const viewport = new OutlineVirtualViewportController();
	viewport.setRows(["a", "b", "c"]);
	viewport.setMetrics({ scrollTop: 50, viewportHeight: 100 });
	const initialLayout = viewport.layout;

	expect(viewport.reportHeight("a", 44.49)).toBe(false);
	expect(viewport.layout).toBe(initialLayout);
	expect(viewport.reportHeight("a", 60)).toBe(true);
	expect(viewport.layout).not.toBe(initialLayout);
	expect(viewport.layout.offsets).toEqual([0, 60, 104, 148]);
	expect(viewport.takeAnchorAdjustment()).toBe(16);

	viewport.setMetrics({ scrollTop: 66, viewportHeight: 100 });
	expect(viewport.reportHeight("b", 80)).toBe(true);
	expect(viewport.takeAnchorAdjustment()).toBe(0);
});

it("drops deleted row heights and invalidates only offscreen heights after width changes", () => {
	const viewport = new OutlineVirtualViewportController();
	viewport.setRows(["a", "b", "c"]);
	viewport.reportHeight("a", 60);
	viewport.reportHeight("b", 80);
	viewport.reportHeight("c", 96);
	viewport.setMetrics({ scrollTop: 100, viewportHeight: 40 });

	expect(viewport.setWidth(600, ["b"])).toBe(true);
	expect(viewport.layout.heights).toEqual([44, 80, 44]);
	expect(viewport.takeAnchorAdjustment()).toBe(-16);
	expect(viewport.setWidth(600, [])).toBe(false);
	expect(viewport.layout.heights[1]).toBe(80);

	viewport.setRows(["b", "c"]);
	expect(viewport.layout.heights).toEqual([80, 44]);
});

it("uses the next row at the same index when the anchor row is removed, then clamps to the last row", () => {
	const viewport = new OutlineVirtualViewportController();
	viewport.setRows(["a", "b", "c", "d"]);
	viewport.setMetrics({ scrollTop: 50, viewportHeight: 100 });
	viewport.setRows(["a", "c", "d"]);
	expect(viewport.takeAnchorAdjustment()).toBe(0);

	viewport.setMetrics({ scrollTop: 100, viewportHeight: 100 });
	viewport.setRows(["a", "c"]);
	expect(viewport.takeAnchorAdjustment()).toBe(-44);
});

it("includes protected IDs in the calculated render window", () => {
	const viewport = new OutlineVirtualViewportController();
	viewport.setRows(Array.from({ length: 100 }, (_, index) => `row-${index}`));
	viewport.setMetrics({ scrollTop: 0, viewportHeight: 44 });
	viewport.setProtectedIds(["row-80", "row-80", "missing"]);

	expect(viewport.window.renderedIndices).toContain(80);
	expect(viewport.window.renderedIndices.filter((index) => index === 80)).toHaveLength(1);
});

it("keeps focused and composing editor rows mounted until focus leaves", () => {
	class EditorTarget extends EventTarget {
		dataset = { itemId: "row-80" };
		closest(selector: string): EditorTarget | null {
			return selector === "textarea[data-item-id]" ? this : null;
		}
	}
	vi.stubGlobal("Element", EditorTarget);
	vi.stubGlobal("document", { activeElement: null });
	const viewport = new OutlineVirtualViewportController();
	viewport.setRows(Array.from({ length: 100 }, (_, index) => `row-${index}`));
	viewport.setMetrics({ scrollTop: 0, viewportHeight: 44 });
	const target = new EditorTarget();

	viewport.trackFocusIn(target);
	viewport.trackCompositionStart(target);
	expect(viewport.window.renderedIndices).toContain(80);

	vi.stubGlobal("document", { activeElement: target });
	viewport.trackCompositionEnd(target);
	expect(viewport.window.renderedIndices).toContain(80);

	viewport.trackFocusOut(target, null);
	expect(viewport.window.renderedIndices).not.toContain(80);
	viewport.setProtectedIds(["row-80"]);
	viewport.releaseProtectedRows();
	expect(viewport.window.renderedIndices).not.toContain(80);
});

it("computes nearest scroll positions before mounting a logical row", () => {
	const viewport = new OutlineVirtualViewportController();
	viewport.setRows(Array.from({ length: 100 }, (_, index) => `row-${index}`));
	viewport.setMetrics({ scrollTop: 0, viewportHeight: 100 });

	expect(viewport.scrollTopFor("row-0")).toBe(0);
	expect(viewport.scrollTopFor("row-3")).toBe(76);
	expect(viewport.scrollTopFor("row-99")).toBe(4300);
	expect(viewport.scrollTopFor("missing")).toBeNull();
});
