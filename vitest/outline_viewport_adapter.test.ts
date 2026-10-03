import { afterEach, expect, test, vi } from "vitest";
import { OutlineViewportAdapter } from "../src/ui/outline_viewport_adapter.ts";

afterEach(() => vi.unstubAllGlobals());

function setup() {
	let panels = [
		{ dataset: { paneId: "a" }, scrollTop: 125, scrollLeft: 12 },
		{ dataset: { paneId: "b" }, scrollTop: 250, scrollLeft: 24 },
	];
	const focus = vi.fn();
	vi.stubGlobal("document", {
		querySelectorAll: () => panels,
		querySelector: (selector: string) => selector === ".outline-panel" ? panels[0] : { focus },
	});
	return {
		adapter: new OutlineViewportAdapter(),
		focus,
		panels: () => panels,
		recreate: () => {
			panels = [...panels].reverse().map((panel) => ({ ...panel, scrollTop: 0, scrollLeft: 0 }));
		},
	};
}

test("restores every recreated panel by pane identity after focus, independently of DOM order", async () => {
	const s = setup();
	const viewport = s.adapter.capture(null, null, false);
	s.recreate();
	await s.adapter.restore(viewport, () => true);
	expect(s.focus).toHaveBeenCalledOnce();
	expect(s.panels().map(({ scrollTop, scrollLeft }) => [scrollTop, scrollLeft])).toEqual([
		[250, 24],
		[125, 12],
	]);
});

test("captures inactive pane scroll before switching and keeps a detached snapshot", async () => {
	const s = setup();
	s.adapter.capturePanels();
	const viewport = s.adapter.capture(null, null, false);
	s.panels()[0].scrollTop = 999;
	s.adapter.capturePanels();
	s.recreate();
	await s.adapter.restore(viewport, () => true);
	expect(s.panels()[1].scrollTop).toBe(125);
});

test("stale or explicit navigation does not restore retained pane scroll", async () => {
	const s = setup();
	const viewport = s.adapter.capture(null, null, false);
	s.recreate();
	await s.adapter.restore(viewport, () => false);
	expect(s.focus).not.toHaveBeenCalled();
	await s.adapter.restore({ ...viewport, restoreScroll: false }, () => true);
	expect(s.panels().every((panel) => panel.scrollTop === 0)).toBe(true);
});
