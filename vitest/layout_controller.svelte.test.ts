import { expect, test, vi } from "vitest";
import { LayoutController } from "../src/ui/layout_controller.svelte.ts";
import { InspectorLayoutAdapter } from "../src/ui/inspector_layout_adapter.ts";
import {
	loadUiLayoutPreference,
	UI_LAYOUT_PREFERENCE_STORAGE_KEY,
} from "../src/ui/ui_layout_preference.ts";

function fixture(afterRender: () => Promise<void> = async () => undefined) {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: vi.fn((key: string, value: string) => {
			values.set(key, value);
		}),
	};
	const layout = new LayoutController(storage);
	const win = Object.assign(new EventTarget(), { innerWidth: 1280 });
	const focus = vi.fn();
	const scrollIntoView = vi.fn();
	const element = {
		isConnected: true,
		ownerDocument: { defaultView: win },
		scrollIntoView,
		querySelector: vi.fn(() => ({ focus })),
	} as unknown as HTMLElement;
	let current = true;
	const adapter = new InspectorLayoutAdapter(layout, () => () => current, afterRender);
	const disconnect = adapter.connect(element);
	return {
		layout,
		adapter,
		storage,
		win,
		element,
		focus,
		scrollIntoView,
		disconnect,
		invalidate: () => {
			current = false;
		},
	};
}

function pointer(type: string, clientX = 960, pointerId = 1, button = 0): PointerEvent {
	return Object.assign(new Event(type, { cancelable: true }), {
		clientX,
		pointerId,
		button,
	}) as PointerEvent;
}

for (const setting of ["width", "navigation"] as const) {
	test(`restored live Inspector does not contaminate saved collapsed on ${setting} changes`, () => {
		const { layout, storage } = fixture();
		layout.setInspectorCollapsed(true);
		layout.applyInspector({ mode: "history", collapsed: false });
		if (setting === "width") layout.setInspectorWidth(400);
		else layout.toggleNavigation();
		expect(layout.captureInspector()).toEqual({ mode: "history", collapsed: false });
		const remounted = new LayoutController(storage);
		expect(remounted.inspectorCollapsed).toBe(true);
		expect(remounted.inspectorWidth).toBe(setting === "width" ? 400 : 320);
		expect(remounted.navCollapsed).toBe(setting === "navigation");
		expect(remounted.asideMode).toBe("overview");
	});
}

test("temporary relation open and tab changes do not write preferences", async () => {
	const s = fixture();
	s.layout.setInspectorCollapsed(true);
	s.storage.setItem.mockClear();
	await s.adapter.openRelationEditor();
	expect(s.layout.captureInspector()).toEqual({ mode: "relation", collapsed: false });
	expect(s.focus).toHaveBeenCalledOnce();
	expect(s.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
	s.layout.setAsideMode("history");
	expect(s.storage.setItem).not.toHaveBeenCalled();
	s.layout.setInspectorWidth(400);
	expect(loadUiLayoutPreference(s.storage).inspectorCollapsed).toBe(true);
});

test("explicit toggle opens overview, scrolls and persists, then closes", async () => {
	const s = fixture();
	s.layout.setInspectorCollapsed(true);
	s.layout.setAsideMode("history");
	await s.adapter.toggleInspector();
	expect(s.layout.captureInspector()).toEqual({ mode: "overview", collapsed: false });
	expect(s.scrollIntoView).toHaveBeenCalledOnce();
	expect(loadUiLayoutPreference(s.storage).inspectorCollapsed).toBe(false);
	await s.adapter.toggleInspector();
	expect(loadUiLayoutPreference(s.storage).inspectorCollapsed).toBe(true);
	expect(s.scrollIntoView).toHaveBeenCalledOnce();
});

for (const end of ["pointerup", "pointercancel"]) {
	test(`resize commits only at ${end} and stops accepting later events`, () => {
		const s = fixture();
		s.adapter.startResize(pointer("pointerdown"));
		s.win.dispatchEvent(pointer("pointermove", 880));
		expect(s.layout.inspectorWidth).toBe(400);
		expect(s.storage.setItem).not.toHaveBeenCalled();
		s.win.dispatchEvent(pointer(end));
		s.win.dispatchEvent(pointer("pointermove", 720));
		s.win.dispatchEvent(pointer("pointerup"));
		expect(s.layout.inspectorWidth).toBe(400);
		expect(loadUiLayoutPreference(s.storage).inspectorWidth).toBe(400);
		expect(s.storage.setItem).toHaveBeenCalledOnce();
	});
}

for (const [clientX, width] of [[1270, 240], [600, 560]]) {
	test(`resize clamps and saves width to ${width}`, () => {
		const s = fixture();
		s.adapter.startResize(pointer("pointerdown"));
		s.win.dispatchEvent(pointer("pointermove", clientX));
		s.win.dispatchEvent(pointer("pointerup"));
		expect(new LayoutController(s.storage).inspectorWidth).toBe(width);
	});
}

test("View unmount and App dispose cancel resize without writes", () => {
	for (const teardown of ["disconnect", "dispose"]) {
		const s = fixture();
		s.adapter.startResize(pointer("pointerdown"));
		s.win.dispatchEvent(pointer("pointermove", 880));
		if (teardown === "disconnect") s.disconnect();
		else s.adapter.dispose();
		s.win.dispatchEvent(pointer("pointermove", 720));
		s.win.dispatchEvent(pointer("pointerup"));
		expect(s.layout.inspectorWidth).toBe(320);
		expect(s.storage.setItem).not.toHaveBeenCalled();
		expect(s.storage.getItem(UI_LAYOUT_PREFERENCE_STORAGE_KEY)).toBeNull();
	}
});

test("resize ignores other pointer IDs, non-primary buttons and collapsed Inspector", () => {
	const s = fixture();
	s.adapter.startResize(pointer("pointerdown", 960, 1, 2));
	s.win.dispatchEvent(pointer("pointermove", 880));
	expect(s.layout.inspectorWidth).toBe(320);
	s.adapter.startResize(pointer("pointerdown"));
	s.win.dispatchEvent(pointer("pointermove", 880, 2));
	s.win.dispatchEvent(pointer("pointercancel", 960, 2));
	expect(s.layout.inspectorWidth).toBe(320);
	s.win.dispatchEvent(pointer("pointermove", 880));
	s.win.dispatchEvent(pointer("pointerup"));
	expect(s.layout.inspectorWidth).toBe(400);
	s.layout.setInspectorCollapsed(true);
	s.adapter.startResize(pointer("pointerdown"));
	s.win.dispatchEvent(pointer("pointermove", 720));
	expect(s.layout.inspectorWidth).toBe(400);
});

for (const invalidation of ["context", "restore", "unmount", "dispose"] as const) {
	test(`late relation focus and scroll are invalidated by ${invalidation}`, async () => {
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const s = fixture(() => pending);
		const opening = s.adapter.openRelationEditor();
		if (invalidation === "context") s.invalidate();
		if (invalidation === "restore") s.layout.applyInspector({ mode: "history", collapsed: false });
		if (invalidation === "unmount") {
			s.disconnect();
			s.adapter.connect(s.element);
		}
		if (invalidation === "dispose") s.adapter.dispose();
		release();
		await opening;
		expect(s.focus).not.toHaveBeenCalled();
		expect(s.scrollIntoView).not.toHaveBeenCalled();
	});
}

test("a new reveal invalidates an older pending focus request", async () => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const s = fixture(vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined));
	const old = s.adapter.openRelationEditor();
	s.layout.setInspectorCollapsed(true);
	await s.adapter.toggleInspector();
	release();
	await old;
	expect(s.scrollIntoView).toHaveBeenCalledOnce();
	expect(s.focus).not.toHaveBeenCalled();
});

test("invalid width input leaves live and saved widths unchanged", () => {
	const s = fixture();
	s.layout.setInspectorWidth(Number.NaN);
	s.layout.previewInspectorWidth(Number.POSITIVE_INFINITY);
	expect(s.layout.inspectorWidth).toBe(320);
	expect(s.storage.setItem).not.toHaveBeenCalled();
});
