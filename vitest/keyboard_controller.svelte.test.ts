import { afterEach, expect, test, vi } from "vitest";
import type { OutlineItem } from "../src/domain/models.ts";
import type { CommandContext } from "../src/ui/command_service.ts";
import { KeyboardController } from "../src/ui/keyboard_controller.svelte.ts";
import { LongFormController } from "../src/ui/long_form_controller.svelte.ts";
import { KeyboardWorkspaceController } from "../src/ui/keyboard_workspace_controller.svelte.ts";
import { projectBrowsingOutline } from "../src/services/browsing_navigation_state.ts";
import type { ViewMode } from "../src/ui/app_view_mode.ts";

afterEach(() => vi.unstubAllGlobals());

test.each(["globalLineage", "options"] as const)(
	"Save persists manuscripts opened from %s without a return position",
	async (initialView) => {
		vi.stubGlobal("document", { querySelector: vi.fn().mockReturnValue(null) });
		const persistence = {
			flush: vi.fn().mockResolvedValue(undefined),
			save: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined),
			reload: vi.fn().mockResolvedValue(true),
			reportError: vi.fn(),
		};
		const longForm = new LongFormController(persistence);
		let view: ViewMode = initialView;
		const item = { id: "tree-item", text: "original" } as OutlineItem;
		const ports = {
			selectedId: () => item.id,
			hoistId: () => null,
			view: () => view,
			prepareView: (next: ViewMode) => () => {
				view = next;
			},
			longFormActive: () => longForm.state.active,
			leaveLongForm: () => longForm.save(),
			startLongForm: () => longForm.start(item),
			select: vi.fn().mockReturnValue(true),
			selectWhenReady: vi.fn().mockResolvedValue(true),
			setHoist: vi.fn(),
			reveal: vi.fn(),
			items: () => [item],
			projection: vi.fn(),
			clearTemporaryExpansion: vi.fn(),
			setCollapsed: vi.fn(),
			reload: vi.fn(),
		};
		const workspace = new KeyboardWorkspaceController(ports);
		await workspace.openLongForm();
		expect(workspace.position).toBeNull();
		longForm.input("edited manuscript");
		await workspace.saveLongForm();
		expect(persistence.save).toHaveBeenCalledWith(item.id, "edited manuscript");
		expect(longForm.state).toMatchObject({ active: true, dirty: true, text: "edited manuscript" });
		expect(persistence.reload).not.toHaveBeenCalled();
		await workspace.saveLongForm();
		expect(persistence.reload).toHaveBeenCalledWith(item.id);
		expect(longForm.state.active).toBe(false);
		expect(ports.select).not.toHaveBeenCalled();
		expect(view).toBe("outline");
	},
);

test("collapse all includes hidden descendants in the current hoist and reloads after partial failure", async () => {
	vi.stubGlobal("document", { querySelector: vi.fn().mockReturnValue(null) });
	vi.stubGlobal("CSS", { escape: (value: string) => value });
	const items = [
		{ id: "root", parentId: null, collapsed: true },
		{ id: "child", parentId: "root", collapsed: false },
		{ id: "outside", parentId: null, collapsed: false },
	] as OutlineItem[];
	const ports = {
		selectedId: () => "root",
		hoistId: () => "root",
		view: () => "outline" as const,
		prepareView: () => vi.fn(),
		longFormActive: () => false,
		leaveLongForm: vi.fn().mockResolvedValue(true),
		startLongForm: vi.fn(),
		select: vi.fn().mockReturnValue(true),
		selectWhenReady: vi.fn().mockResolvedValue(true),
		setHoist: vi.fn(),
		reveal: vi.fn(),
		projection: () =>
			projectBrowsingOutline({ items, links: [], knots: [], stashItemIds: [] }, "root"),
		items: () => items,
		clearTemporaryExpansion: vi.fn(),
		setCollapsed: vi.fn().mockResolvedValue(undefined),
		reload: vi.fn().mockResolvedValue(true),
	};
	const controller = new KeyboardWorkspaceController(ports);
	await controller.setAllCollapsed(true);
	expect(ports.setCollapsed.mock.calls).toEqual([["child", true]]);
	ports.setCollapsed.mockClear();
	ports.setCollapsed.mockRejectedValueOnce(new Error("offline"));
	await expect(controller.setAllCollapsed(false)).rejects.toThrow("offline");
	expect(ports.setCollapsed.mock.calls).toEqual([["root", false]]);
	expect(ports.reload).toHaveBeenCalledTimes(2);
	expect(ports.clearTemporaryExpansion).toHaveBeenCalledTimes(2);
});

function event(key: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return {
		key,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		preventDefault: vi.fn(),
		stopImmediatePropagation: vi.fn(),
		...modifiers,
	} as KeyboardEvent;
}

test("reserved Alt+Left suppresses native Back while dialogs or startup block commands", () => {
	const execute = vi.fn().mockResolvedValue(undefined);
	const keyboard = new KeyboardController({
		context: () => ({ startupReady: true, canGoBack: true }) as CommandContext,
		blocked: () => true,
		execute,
		reportError: vi.fn(),
	});
	const back = event("ArrowLeft", { altKey: true });
	expect(keyboard.handle(back)).toBe(true);
	expect(back.preventDefault).toHaveBeenCalledOnce();
	expect(back.stopImmediatePropagation).toHaveBeenCalledOnce();
	expect(execute).not.toHaveBeenCalled();
});

test("reserved Alt+Left executes screen back once and ignores repeats", async () => {
	const execute = vi.fn().mockResolvedValue(undefined);
	const keyboard = new KeyboardController({
		context: () => ({ startupReady: true, canGoBack: true }) as CommandContext,
		blocked: () => false,
		execute,
		reportError: vi.fn(),
	});
	expect(keyboard.handle(event("ArrowLeft", { altKey: true }))).toBe(true);
	await Promise.resolve();
	expect(execute).toHaveBeenCalledWith("goBack");
	expect(keyboard.handle(event("ArrowLeft", { altKey: true, repeat: true }))).toBe(true);
	expect(execute).toHaveBeenCalledOnce();
});

test.each([{ isComposing: true }, { keyCode: 229 }])(
	"reserved Alt+Left prevents browser Back without application navigation during IME: %j",
	async (composition) => {
		const execute = vi.fn().mockResolvedValue(undefined);
		const keyboard = new KeyboardController({
			context: () => ({ startupReady: true, canGoBack: true }) as CommandContext,
			blocked: () => false,
			execute,
			reportError: vi.fn(),
		});
		keyboard.open = true;
		const back = event("ArrowLeft", { altKey: true, ...composition });
		expect(keyboard.handle(back)).toBe(true);
		expect(back.preventDefault).toHaveBeenCalledOnce();
		expect(back.stopImmediatePropagation).toHaveBeenCalledOnce();
		expect(keyboard.open).toBe(false);
		await Promise.resolve();
		expect(execute).not.toHaveBeenCalled();
	},
);

test("chords consume input, reject unavailable commands, and leave reserved keys alone", async () => {
	vi.stubGlobal("document", { activeElement: null });
	vi.stubGlobal("HTMLTextAreaElement", class {});
	const execute = vi.fn().mockResolvedValue(undefined);
	const context = {
		startupReady: true,
		isOutline: true,
		selectedOccurrenceId: null,
	} as CommandContext;
	const keyboard = new KeyboardController({
		context: () => context,
		blocked: () => false,
		execute,
		reportError: vi.fn(),
	});
	for (const key of ["o", "f", "r", "p", "k"]) {
		expect(keyboard.handle(event(key, { ctrlKey: true }))).toBe(false);
	}
	expect(keyboard.handle(event("/", { ctrlKey: true, shiftKey: true }))).toBe(false);
	keyboard.handle(event("/", { ctrlKey: true }));
	expect(keyboard.open).toBe(true);
	const stray = event("z");
	keyboard.handle(stray);
	expect(stray.preventDefault).toHaveBeenCalled();
	expect(keyboard.open).toBe(true);
	await keyboard.choose("startLongFormEditing");
	expect(execute).not.toHaveBeenCalled();
	expect(keyboard.notice).not.toBe("");
	keyboard.handle(event("O", { shiftKey: true }));
	await Promise.resolve();
	expect(execute).toHaveBeenCalledWith("showOutline");
	expect(keyboard.open).toBe(false);
});

test("IME composition and dialogs cancel a pending chord", () => {
	vi.stubGlobal("document", { activeElement: null });
	vi.stubGlobal("HTMLTextAreaElement", class {});
	let blocked = false;
	const keyboard = new KeyboardController({
		context: () => ({ startupReady: true }) as CommandContext,
		blocked: () => blocked,
		execute: vi.fn(),
		reportError: vi.fn(),
	});
	keyboard.handle(event("/", { ctrlKey: true }));
	expect(keyboard.handle(event("Process", { isComposing: true }))).toBe(false);
	expect(keyboard.open).toBe(false);
	keyboard.handle(event("/", { ctrlKey: true }));
	blocked = true;
	expect(keyboard.handle(event("o"))).toBe(false);
	expect(keyboard.open).toBe(false);
});

test("manuscript save retains the original item and preserves edits on failure", async () => {
	const ports = {
		flush: vi.fn().mockResolvedValue(undefined),
		save: vi.fn().mockRejectedValue(new Error("offline")),
		reload: vi.fn().mockResolvedValue(true),
		reportError: vi.fn(),
	};
	const controller = new LongFormController(ports);
	await controller.start({ id: "source", text: "original" } as OutlineItem);
	controller.input("edited");
	await controller.start({ id: "other", text: "other text" } as OutlineItem);
	expect(await controller.save()).toBe(false);
	expect(ports.save).toHaveBeenCalledWith("source", "edited");
	expect(controller.state).toMatchObject({ active: true, dirty: true, text: "edited" });
	expect(ports.reload).not.toHaveBeenCalled();
	ports.save.mockResolvedValue(undefined);
	expect(await controller.save()).toBe(true);
	expect(ports.reload).toHaveBeenCalledWith("source");
	expect(controller.state.active).toBe(false);
});

test("manuscript save waits for reload selection and retains the editor when selection is cancelled", async () => {
	let settle!: (accepted: boolean) => void;
	const selection = new Promise<boolean>((resolve) => {
		settle = resolve;
	});
	const ports = {
		flush: vi.fn().mockResolvedValue(undefined),
		save: vi.fn().mockResolvedValue(undefined),
		reload: vi.fn(() => selection),
		reportError: vi.fn(),
	};
	const controller = new LongFormController(ports);
	await controller.start({ id: "source", text: "original" } as OutlineItem);
	controller.input("edited");
	const save = controller.save();
	await vi.waitFor(() => expect(ports.reload).toHaveBeenCalledWith("source"));
	expect(controller.state.active).toBe(true);
	settle(false);
	expect(await save).toBe(false);
	expect(controller.state).toMatchObject({ active: true, text: "edited" });
});
