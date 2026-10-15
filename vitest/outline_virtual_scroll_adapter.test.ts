import type { VisibleRow } from "../src/ui/outline_view_model.ts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	type OutlineScrollMetrics,
	OutlineViewportAdapter,
} from "../src/ui/outline_viewport_adapter.ts";

import { buildVirtualOutlineLayout } from "../src/ui/virtual_outline_viewport.ts";

class MockElement extends EventTarget {
	parentElement: MockElement | null = null;
	className = "";
	style: Record<string, string> = {};
	dataset: Record<string, string | undefined> = {};
	clientHeight = 0;
	clientTop = 0;
	scrollTop = 0;
	scrollLeft = 0;
	rect = {
		top: 0,
		bottom: 0,
		left: 0,
		right: 0,
		width: 0,
		height: 0,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	};

	getBoundingClientRect() {
		return this.rect;
	}
}

describe("OutlineViewportAdapter.observeRows (U01)", () => {
	let adapter: OutlineViewportAdapter;
	let windowTarget: EventTarget;
	let resizeObserverCallbacks: Array<() => void> = [];
	let observedElements: Set<object> = new Set();

	beforeEach(() => {
		adapter = new OutlineViewportAdapter();
		resizeObserverCallbacks = [];
		observedElements = new Set();
		windowTarget = new EventTarget();

		vi.stubGlobal("window", {
			addEventListener: (
				type: string,
				listener: EventListenerOrEventListenerObject,
				options?: boolean | AddEventListenerOptions,
			) => {
				windowTarget.addEventListener(type, listener, options);
			},
			removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
				windowTarget.removeEventListener(type, listener);
			},
			getComputedStyle: (el: MockElement) => ({
				overflowY: el.style.overflowY || "visible",
			}),
			innerHeight: 768,
		});

		class MockResizeObserver {
			constructor(callback: () => void) {
				resizeObserverCallbacks.push(callback);
			}
			observe(el: object) {
				observedElements.add(el);
			}
			unobserve(el: object) {
				observedElements.delete(el);
			}
			disconnect() {
				observedElements.clear();
			}
		}
		vi.stubGlobal("ResizeObserver", MockResizeObserver);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	test("finds nearest ancestor with overflowY auto or scroll and publishes initial metrics", () => {
		const container = new MockElement();
		container.className = "app-main";
		container.style.overflowY = "hidden";

		const panel = new MockElement();
		panel.className = "outline-panel";
		panel.style.overflowY = "auto";
		panel.parentElement = container;
		panel.clientHeight = 500;
		panel.clientTop = 2;
		panel.rect = {
			top: 100,
			bottom: 602,
			left: 0,
			right: 800,
			width: 800,
			height: 502,
			x: 0,
			y: 100,
			toJSON: () => ({}),
		};

		const rows = new MockElement();
		rows.className = "rows";
		rows.parentElement = panel;
		rows.rect = {
			top: 60,
			bottom: 1060,
			left: 0,
			right: 800,
			width: 800,
			height: 1000,
			x: 0,
			y: 60,
			toJSON: () => ({}),
		};

		const published: OutlineScrollMetrics[] = [];
		const dispose = adapter.observeRows(rows as unknown as HTMLElement, (m) => published.push(m));

		expect(published.length).toBe(1);
		expect(published[0]).toEqual({
			scrollTop: 42, // (100 + 2) - 60 = 42
			viewportHeight: 500,
		});
		expect(observedElements.has(rows)).toBe(true);
		expect(observedElements.has(panel)).toBe(true);

		dispose();
	});

	test("updates metrics on owner scroll event", () => {
		const panel = new MockElement();
		panel.className = "outline-panel";
		panel.style.overflowY = "scroll";
		panel.clientHeight = 400;
		panel.clientTop = 0;
		panel.rect = {
			top: 50,
			bottom: 450,
			left: 0,
			right: 600,
			width: 600,
			height: 400,
			x: 0,
			y: 50,
			toJSON: () => ({}),
		};

		const rows = new MockElement();
		rows.className = "rows";
		rows.parentElement = panel;
		rows.rect = {
			top: 50,
			bottom: 850,
			left: 0,
			right: 600,
			width: 600,
			height: 800,
			x: 0,
			y: 50,
			toJSON: () => ({}),
		};

		const published: OutlineScrollMetrics[] = [];
		const dispose = adapter.observeRows(rows as unknown as HTMLElement, (m) => published.push(m));
		expect(published[0].scrollTop).toBe(0);

		// Scrolled 200px
		rows.rect = {
			top: -150,
			bottom: 650,
			left: 0,
			right: 600,
			width: 600,
			height: 800,
			x: 0,
			y: -150,
			toJSON: () => ({}),
		};
		panel.dispatchEvent(new Event("scroll"));

		expect(published.length).toBe(2);
		expect(published[1]).toEqual({
			scrollTop: 200, // 50 - (-150) = 200
			viewportHeight: 400,
		});

		dispose();
	});

	test("dynamically switches owner when styles change on mobile switch", () => {
		const container = new MockElement();
		container.className = "app-main";
		container.style.overflowY = "hidden";
		container.clientHeight = 700;
		container.rect = {
			top: 0,
			bottom: 700,
			left: 0,
			right: 800,
			width: 800,
			height: 700,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		};

		const panel = new MockElement();
		panel.className = "outline-panel";
		panel.style.overflowY = "auto";
		panel.parentElement = container;
		panel.clientHeight = 600;
		panel.rect = {
			top: 0,
			bottom: 600,
			left: 0,
			right: 800,
			width: 800,
			height: 600,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		};

		const rows = new MockElement();
		rows.className = "rows";
		rows.parentElement = panel;
		rows.rect = {
			top: 0,
			bottom: 1000,
			left: 0,
			right: 800,
			width: 800,
			height: 1000,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		};

		const published: OutlineScrollMetrics[] = [];
		const dispose = adapter.observeRows(rows as unknown as HTMLElement, (m) => published.push(m));
		expect(published[0].viewportHeight).toBe(600);
		expect(observedElements.has(panel)).toBe(true);

		// Switch to mobile layout: panel visible, container scrollable
		panel.style.overflowY = "visible";
		container.style.overflowY = "auto";

		// Trigger resize event
		windowTarget.dispatchEvent(new Event("resize"));

		expect(published.at(-1)?.viewportHeight).toBe(700);
		expect(observedElements.has(container)).toBe(true);
		expect(observedElements.has(panel)).toBe(false);

		// Scrolling container updates metrics
		rows.rect = {
			top: -100,
			bottom: 900,
			left: 0,
			right: 800,
			width: 800,
			height: 1000,
			x: 0,
			y: -100,
			toJSON: () => ({}),
		};
		container.dispatchEvent(new Event("scroll"));

		expect(published.at(-1)).toEqual({
			scrollTop: 100,
			viewportHeight: 700,
		});

		// Old panel scrolling should not trigger anything
		const count = published.length;
		panel.dispatchEvent(new Event("scroll"));
		expect(published.length).toBe(count);

		dispose();
	});

	test("disposer removes all event listeners and suppresses subsequent publications", () => {
		const panel = new MockElement();
		panel.style.overflowY = "auto";
		const rows = new MockElement();
		rows.parentElement = panel;

		const published: OutlineScrollMetrics[] = [];
		const dispose = adapter.observeRows(rows as unknown as HTMLElement, (m) => published.push(m));
		expect(published.length).toBe(1);

		dispose();

		expect(observedElements.size).toBe(0);

		panel.dispatchEvent(new Event("scroll"));
		windowTarget.dispatchEvent(new Event("resize"));
		for (const cb of resizeObserverCallbacks) cb();

		expect(published.length).toBe(1);
	});

	test("falls back to window when no ancestor has scroll overflow", () => {
		const rows = new MockElement();
		rows.rect = {
			top: -80,
			bottom: 920,
			left: 0,
			right: 800,
			width: 800,
			height: 1000,
			x: 0,
			y: -80,
			toJSON: () => ({}),
		};

		const published: OutlineScrollMetrics[] = [];
		const dispose = adapter.observeRows(rows as unknown as HTMLElement, (m) => published.push(m));

		expect(published[0]).toEqual({
			scrollTop: 80,
			viewportHeight: 768, // window.innerHeight
		});

		dispose();
	});

	test("adjusts the dynamically resolved owner and unregisters ensure-mounted ports", async () => {
		const panel = new MockElement();
		panel.style.overflowY = "auto";
		const rows = new MockElement();
		rows.parentElement = panel;
		adapter.adjustScroll(rows as unknown as HTMLElement, 120);
		expect(panel.scrollTop).toBe(120);
		rows.rect = { ...rows.rect, top: 100 };
		adapter.scrollToLogical(rows as unknown as HTMLElement, 200);
		expect(panel.scrollTop).toBe(420);

		const port = vi.fn(async () => true);
		const unregister = adapter.registerEnsureMounted(port);
		expect(await adapter.ensureMounted("row-9", () => true)).toBe(true);
		expect(port).toHaveBeenCalledOnce();
		unregister();
		expect(await adapter.ensureMounted("row-9", () => true)).toBe(false);
	});

	test("captures and restores the actual mobile scroll owner for each pane", async () => {
		const owner = new MockElement();
		owner.className = "app-main";
		owner.style.overflowY = "auto";
		owner.scrollTop = 430;
		owner.scrollLeft = 12;
		const panel = new MockElement();
		panel.className = "outline-panel";
		panel.dataset.paneId = "pane-1";
		panel.parentElement = owner;
		vi.stubGlobal("document", {
			querySelectorAll: () => [panel],
			querySelector: () => panel,
		});

		adapter.capturePanels();
		owner.scrollTop = 0;
		owner.scrollLeft = 0;
		await adapter.restorePanels(() => true);
		expect(owner.scrollTop).toBe(430);
		expect(owner.scrollLeft).toBe(12);
	});

	test("observes window scrolling and releases its listener on owner switch and dispose", () => {
		const rows = new MockElement();
		const published: OutlineScrollMetrics[] = [];
		const dispose = adapter.observeRows(rows as unknown as HTMLElement, (m) => published.push(m));
		rows.rect.top = -100;
		windowTarget.dispatchEvent(new Event("scroll"));
		expect(published.at(-1)?.scrollTop).toBe(100);
		const panel = new MockElement();
		panel.style.overflowY = "auto";
		rows.parentElement = panel;
		windowTarget.dispatchEvent(new Event("resize"));
		const count = published.length;
		windowTarget.dispatchEvent(new Event("scroll"));
		expect(published).toHaveLength(count);
		panel.dispatchEvent(new Event("scroll"));
		expect(published).toHaveLength(count + 1);
		dispose();
		panel.dispatchEvent(new Event("scroll"));
		windowTarget.dispatchEvent(new Event("scroll"));
		for (const callback of resizeObserverCallbacks) callback();
		expect(published).toHaveLength(count + 1);
	});
});

test("drops on the logical row under the pointer when it lands on the virtualized root gap", () => {
	const adapter = new OutlineViewportAdapter();
	const root = new MockElement();
	root.rect.top = 10;
	const event = {
		target: root,
		currentTarget: root,
		clientY: 54,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	} as unknown as DragEvent;
	const drop = vi.fn();

	adapter.dropOnVirtualGap(
		event,
		"dragged",
		root as unknown as HTMLElement,
		buildVirtualOutlineLayout(3, () => 40),
		["a", "b", "c"].map((id) => ({ item: { id } }) as VisibleRow),
		drop,
	);

	expect(drop).toHaveBeenCalledWith({ item: { id: "b" } });
	expect(event.preventDefault).toHaveBeenCalledOnce();
	expect(event.stopPropagation).toHaveBeenCalledOnce();
});
