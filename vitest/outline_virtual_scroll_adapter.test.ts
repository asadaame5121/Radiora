import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	type OutlineScrollMetrics,
	OutlineViewportAdapter,
} from "../src/ui/outline_viewport_adapter.ts";

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
});
