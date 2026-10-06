import { afterEach, expect, it, vi } from "vitest";
import { GlobalKeyboardAdapter } from "../src/ui/global_keyboard_adapter.ts";
import { PaletteFocusAdapter } from "../src/ui/palette_focus_adapter.ts";
afterEach(() => vi.unstubAllGlobals());
function event(key: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		isComposing: false,
		keyCode: 0,
		repeat: false,
		defaultPrevented: false,
		preventDefault: vi.fn(),
		stopImmediatePropagation: vi.fn(),
		...options,
	} as KeyboardEvent;
}
it("suppresses IME/repeat/modal input and cleans every listener on disconnect", () => {
	let blocked = false;
	const ports = {
		chord: { handle: vi.fn(() => false), cancel: vi.fn(), open: false },
		blocked: () => blocked,
		specialBlocked: () => blocked,
		help: vi.fn(),
		togglePalette: vi.fn(),
		focusPane: vi.fn(),
		treeVisible: () => false,
		bindings: [{ commandId: "hoist" as const, shortcut: "Ctrl+Shift+H" }],
		execute: vi.fn(async () => undefined),
		reportError: vi.fn(),
	};
	const adapter = new GlobalKeyboardAdapter(ports);
	adapter.handle(event("F1", { isComposing: true }));
	adapter.handle(event("F1", { keyCode: 229 }));
	adapter.handle(event("F1", { repeat: true }));
	blocked = true;
	adapter.handle(event("F1"));
	adapter.handle(event("k", { ctrlKey: true }));
	expect(ports.help).not.toHaveBeenCalled();
	expect(ports.togglePalette).not.toHaveBeenCalled();
	blocked = false;
	adapter.handle(event("F1"));
	adapter.handle(event("k", { ctrlKey: true }));
	adapter.handle(event("F6", { shiftKey: true }));
	adapter.handle(event("H", { ctrlKey: true, shiftKey: true }));
	adapter.handle(event("H", { ctrlKey: true, shiftKey: true, repeat: true }));
	expect(ports.help).toHaveBeenCalledOnce();
	expect(ports.togglePalette).toHaveBeenCalledOnce();
	expect(ports.focusPane).toHaveBeenCalledWith(true);
	expect(ports.execute).toHaveBeenCalledTimes(1);
	const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
	const cleanup = adapter.connect(target as unknown as Window);
	cleanup();
	expect(target.removeEventListener.mock.calls).toEqual(target.addEventListener.mock.calls);
	expect(ports.chord.cancel).toHaveBeenCalledWith(false);
});
it("late Palette close does not restore focus after reopen or dispose", async () => {
	class Target {
		isConnected = true;
		focus = vi.fn();
	}
	const target = new Target();
	vi.stubGlobal("HTMLElement", Target);
	vi.stubGlobal("document", { activeElement: target });
	let release!: () => void;
	let open = false;
	const adapter = new PaletteFocusAdapter({
		open: () => open,
		afterRender: () => new Promise<void>((resolve) => release = resolve),
	});
	adapter.remember();
	const closing = adapter.restore();
	open = true;
	adapter.remember();
	release();
	await closing;
	expect(target.focus).not.toHaveBeenCalled();
	open = false;
	const again = adapter.restore();
	release();
	await again;
	expect(target.focus).toHaveBeenCalledOnce();
	adapter.remember();
	const teardown = adapter.restore();
	adapter.dispose();
	release();
	await teardown;
	expect(target.focus).toHaveBeenCalledOnce();
});
