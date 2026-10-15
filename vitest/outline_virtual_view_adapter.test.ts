import { afterEach, expect, it, vi } from "vitest";
import { OutlineVirtualViewAdapter } from "../src/ui/outline_virtual_view_adapter.ts";
import { OutlineVirtualViewportController } from "../src/ui/outline_virtual_viewport_controller.svelte.ts";

afterEach(() => vi.unstubAllGlobals());

it("reads actual clamped scroll after coalesced height reports and cancels disposed frames", () => {
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.set(++nextFrame, callback);
		return nextFrame;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
	const windowTarget = new EventTarget();
	vi.stubGlobal("window", {
		addEventListener: windowTarget.addEventListener.bind(windowTarget),
		removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
		getComputedStyle: () => ({ overflowY: "auto" }),
	});
	vi.stubGlobal("ResizeObserver", undefined);
	let actualScroll = 100;
	const owner = Object.assign(new EventTarget(), {
		clientTop: 0,
		clientHeight: 100,
		parentElement: null,
		getBoundingClientRect: () => ({ top: 0 }),
	});
	Object.defineProperty(owner, "scrollTop", {
		get: () => actualScroll,
		set: (top: number) => {
			actualScroll = Math.min(120, top);
		},
	});
	const rows = {
		parentElement: owner,
		clientWidth: 800,
		getBoundingClientRect: () => ({ top: -actualScroll }),
	} as unknown as HTMLElement;
	const viewport = new OutlineVirtualViewportController({
		rowIds: () => Array.from({ length: 100 }, (_, i) => `r${i}`),
		protectedIds: () => [],
		focusFallback: vi.fn(),
	});
	viewport.refreshProjection();
	const adapter = new OutlineVirtualViewAdapter();
	const dispose = adapter.connectViewport(rows, viewport);
	viewport.measureRow("r0", 60);
	adapter.scheduleAnchorAdjustment();
	viewport.measureRow("r1", 80);
	adapter.scheduleAnchorAdjustment();
	expect(frames.size).toBe(1);
	for (const [id, frame] of frames) {
		frames.delete(id);
		frame(0);
	}
	expect(actualScroll).toBe(120);
	expect(viewport.metrics.scrollTop).toBe(120);
	viewport.measureRow("r0", 70);
	adapter.scheduleAnchorAdjustment();
	dispose();
	expect(frames.size).toBe(0);
});
