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

function closeAutoFocusEvent() {
	let canceled = false;
	const preventDefault = vi.fn(() => canceled = true);
	const value = {
		get defaultPrevented() {
			return canceled;
		},
		preventDefault,
	};
	return { event: value as unknown as Event, preventDefault };
}

function emulateBitsDefaultFocus(event: Event, target: { focus(): void }): void {
	if (!event.defaultPrevented) target.focus();
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
	expect(target.addEventListener).toHaveBeenCalledWith("keydown", adapter.handle, true);
	expect(target.removeEventListener).toHaveBeenCalledWith("keydown", adapter.handle, true);
	expect(ports.chord.cancel).toHaveBeenCalledWith(false);
});

it("keeps text input editable, allows Ctrl+K there, and gives an active chord priority", () => {
	class Editable {
		matches(): boolean {
			return true;
		}
		closest(): null {
			return null;
		}
	}
	vi.stubGlobal("Element", Editable);
	let chordHandles = true;
	const ports = {
		chord: {
			handle: vi.fn(() => chordHandles),
			cancel: vi.fn(),
			open: true,
		},
		blocked: () => false,
		specialBlocked: () => false,
		help: vi.fn(),
		togglePalette: vi.fn(),
		focusPane: vi.fn(),
		treeVisible: () => false,
		bindings: [{ commandId: "hoist" as const, shortcut: "Ctrl+Shift+H" }],
		execute: vi.fn(async () => undefined),
		reportError: vi.fn(),
	};
	const adapter = new GlobalKeyboardAdapter(ports);
	const target = new Editable() as unknown as EventTarget;

	adapter.handle(event("H", { ctrlKey: true, shiftKey: true, target }));
	expect(ports.execute).not.toHaveBeenCalled();
	chordHandles = false;
	adapter.handle(event("H", { ctrlKey: true, shiftKey: true, target }));
	expect(ports.execute).toHaveBeenCalledExactlyOnceWith("hoist");
	const text = event("x", { target });
	adapter.handle(text);
	expect(ports.execute).toHaveBeenCalledOnce();
	expect(text.preventDefault).not.toHaveBeenCalled();
	const space = event(" ", { target });
	adapter.handle(space);
	expect(ports.execute).toHaveBeenCalledOnce();
	expect(space.preventDefault).not.toHaveBeenCalled();
	adapter.handle(event("k", { ctrlKey: true, target }));
	expect(ports.togglePalette).toHaveBeenCalledOnce();
	adapter.handle(event("l", { shiftKey: true, target }));
	expect(ports.execute).toHaveBeenCalledOnce();
	adapter.handle(event("H", { ctrlKey: true, shiftKey: true, target }));
	expect(ports.execute).toHaveBeenCalledTimes(2);
});
it("Palette focus restores a captured non-editor target once", async () => {
	class Target {
		isConnected = true;
		focus = vi.fn();
		matches(): boolean {
			return false;
		}
	}
	const target = new Target();
	vi.stubGlobal("HTMLElement", Target);
	vi.stubGlobal("document", { activeElement: target });
	const adapter = new PaletteFocusAdapter({ open: () => false });
	const session = adapter.remember();
	const close = adapter.closeHandler(session);
	const autoFocus = closeAutoFocusEvent();
	close(autoFocus.event);
	emulateBitsDefaultFocus(autoFocus.event, target);
	await session.settled;
	expect(autoFocus.preventDefault).toHaveBeenCalledOnce();
	expect(target.focus).toHaveBeenCalledOnce();
});

it("an old close callback cannot restore or settle a newer Palette session", async () => {
	class Target {
		isConnected = true;
		focus = vi.fn();
		matches(): boolean {
			return false;
		}
	}
	const firstTarget = new Target();
	const nextTarget = new Target();
	const fakeDocument: { activeElement: Target } = { activeElement: firstTarget };
	vi.stubGlobal("HTMLElement", Target);
	vi.stubGlobal("document", fakeDocument);
	let open = true;
	const adapter = new PaletteFocusAdapter({ open: () => open });
	const oldSession = adapter.remember();
	const oldClose = adapter.closeHandler(oldSession);
	fakeDocument.activeElement = nextTarget;
	const nextSession = adapter.remember();
	const nextClose = adapter.closeHandler(nextSession);
	let nextSettled = false;
	void nextSession.settled.then(() => nextSettled = true);
	open = false;
	await oldSession.settled;
	const oldAutoFocus = closeAutoFocusEvent();
	oldClose(oldAutoFocus.event);
	emulateBitsDefaultFocus(oldAutoFocus.event, firstTarget);
	await Promise.resolve();
	expect(oldAutoFocus.preventDefault).toHaveBeenCalledOnce();
	expect(firstTarget.focus).not.toHaveBeenCalled();
	expect(nextTarget.focus).not.toHaveBeenCalled();
	expect(nextSettled).toBe(false);

	const nextAutoFocus = closeAutoFocusEvent();
	nextClose(nextAutoFocus.event);
	emulateBitsDefaultFocus(nextAutoFocus.event, nextTarget);
	await nextSession.settled;
	expect(nextTarget.focus).toHaveBeenCalledOnce();
	expect(nextSettled).toBe(true);
});

it("editor restore targets the captured host and clamps backward selection and scroll", async () => {
	class Host {
		isConnected = true;
		constructor(readonly itemId: string) {}
		dispatchEvent = vi.fn((_event: Event) => true);
	}
	class Textarea {
		isConnected = true;
		value = "abcde";
		selectionStart = 3;
		selectionEnd = 8;
		selectionDirection: "backward" | "forward" | "none" = "backward";
		scrollTop = 42;
		scrollLeft = 19;
		focus = vi.fn();
		matches(selector: string): boolean {
			return selector === "textarea[data-item-id]";
		}
		closest<T extends Element>(selector: string): T | null {
			return selector === "[data-editor-item-id]" ? host as unknown as T : null;
		}
		setSelectionRange = vi.fn();
	}
	const host = new Host("same-item");
	const otherHost = new Host("same-item");
	const textarea = new Textarea();
	function HTMLElementStub() {
		return undefined;
	}
	Object.defineProperty(HTMLElementStub, Symbol.hasInstance, {
		value: (value: unknown) => value === textarea,
	});
	vi.stubGlobal("HTMLElement", HTMLElementStub);
	vi.stubGlobal("document", { activeElement: textarea });
	const adapter = new PaletteFocusAdapter({ open: () => false });
	const session = adapter.remember();
	textarea.selectionStart = 0;
	textarea.selectionEnd = 0;
	textarea.selectionDirection = "none";
	textarea.scrollTop = 0;
	textarea.scrollLeft = 0;
	const close = adapter.closeHandler(session);
	const autoFocus = closeAutoFocusEvent();
	close(autoFocus.event);
	emulateBitsDefaultFocus(autoFocus.event, textarea);
	await session.settled;
	expect(autoFocus.preventDefault).toHaveBeenCalledOnce();
	expect(host.dispatchEvent).toHaveBeenCalledOnce();
	expect(otherHost.dispatchEvent).not.toHaveBeenCalled();
	const dispatched = host.dispatchEvent.mock.calls[0][0] as CustomEvent<{ caretOffset: number }>;
	expect(dispatched.type).toBe("radiora:focus-editor");
	expect(dispatched.detail.caretOffset).toBe(3);
	expect(textarea.setSelectionRange).toHaveBeenCalledWith(3, 5, "backward");
	expect(textarea.scrollTop).toBe(42);
	expect(textarea.scrollLeft).toBe(19);

	const disconnectedSession = adapter.remember();
	host.isConnected = false;
	const disconnectedEvent = closeAutoFocusEvent();
	adapter.closeHandler(disconnectedSession)(disconnectedEvent.event);
	emulateBitsDefaultFocus(disconnectedEvent.event, textarea);
	await disconnectedSession.settled;
	expect(disconnectedEvent.preventDefault).toHaveBeenCalledOnce();
	expect(host.dispatchEvent).toHaveBeenCalledOnce();
	expect(textarea.focus).not.toHaveBeenCalled();
});

it("invalid, disconnected, or disposed close sessions suppress Bits default focus", async () => {
	class Target {
		isConnected = true;
		focus = vi.fn();
		matches(): boolean {
			return false;
		}
	}
	const target = new Target();
	vi.stubGlobal("HTMLElement", Target);
	vi.stubGlobal("document", { activeElement: target });
	const adapter = new PaletteFocusAdapter({ open: () => false });
	const session = adapter.remember();
	target.isConnected = false;
	const disconnectedClose = adapter.closeHandler(session);
	const disconnectedEvent = closeAutoFocusEvent();
	disconnectedClose(disconnectedEvent.event);
	emulateBitsDefaultFocus(disconnectedEvent.event, target);
	await session.settled;
	expect(disconnectedEvent.preventDefault).toHaveBeenCalledOnce();
	expect(target.focus).not.toHaveBeenCalled();

	target.isConnected = true;
	const disposedSession = adapter.remember();
	const disposedClose = adapter.closeHandler(disposedSession);
	adapter.dispose();
	await disposedSession.settled;
	const disposedEvent = closeAutoFocusEvent();
	disposedClose(disposedEvent.event);
	emulateBitsDefaultFocus(disposedEvent.event, target);
	expect(disposedEvent.preventDefault).toHaveBeenCalledOnce();
	expect(target.focus).not.toHaveBeenCalled();
});
