import { afterEach, expect, it, vi } from "vitest";
import { CommandExecutionController } from "../src/ui/command_execution_controller.ts";
import { OccurrenceContextMenuController } from "../src/ui/occurrence_context_menu_controller.svelte.ts";
afterEach(() => vi.unstubAllGlobals());
it("dispatches common commands and rejects a stale or closed menu", async () => {
	class Element {
		getBoundingClientRect() {
			return { left: 12, bottom: 24 };
		}
	}
	class Mouse {
		clientX = 5;
		clientY = 7;
		target = null;
		currentTarget = new Element();
		preventDefault = vi.fn();
	}
	vi.stubGlobal("HTMLElement", Element);
	vi.stubGlobal("SVGElement", Element);
	vi.stubGlobal("MouseEvent", Mouse);
	let selected = "a";
	const execute = vi.fn(async () => undefined);
	const remove = vi.fn(async () => undefined);
	const navigate = vi.fn(async () => undefined);
	const controller = new OccurrenceContextMenuController({
		exists: () => true,
		select: () => true,
		selected: () => selected,
		execute,
		remove,
		navigate,
		actions: {},
		run: async (action) => {
			await action();
		},
	});
	controller.open("a", "tree", new Mouse() as unknown as MouseEvent);
	expect(controller.state).toMatchObject({ targetId: "a", x: 5, y: 7 });
	await controller.execute("remove-occurrence");
	expect(remove).toHaveBeenCalledWith("a");
	await controller.execute("create-link");
	expect(execute).toHaveBeenCalledWith("createLink");
	selected = "b";
	await controller.execute("create-link");
	expect(execute).toHaveBeenCalledTimes(1);
	await controller.execute("zoom");
	expect(navigate).toHaveBeenCalledWith("a", "zoom");
	controller.close();
	await controller.execute("remove-occurrence");
	expect(execute).toHaveBeenCalledTimes(1);
	expect(remove).toHaveBeenCalledTimes(1);
	expect(controller.state).toBeNull();
});

it("removes from Tree under the shared lock while keyboard removal stays Outline-only", async () => {
	class Mouse {
		target = null;
		currentTarget = null;
		clientX = 0;
		clientY = 0;
		preventDefault = vi.fn();
	}
	vi.stubGlobal("MouseEvent", Mouse);
	vi.stubGlobal("HTMLElement", class {});
	vi.stubGlobal("SVGElement", class {});
	let release!: () => void;
	const pending = new Promise<void>((resolve) => release = resolve);
	const remove = vi.fn(() => pending);
	const unavailable = vi.fn();
	const execution = new CommandExecutionController({
		context: () => ({
			startupReady: true,
			selectedOccurrenceId: "a",
			isOutline: false,
			hasSelectedBranch: true,
			hasSelectedRecoverySnapshot: false,
			canOpenLinkEditor: true,
			quickCaptureText: "",
			quickCaptureSubmitting: false,
			isHoisted: false,
		}),
		operations: { removeOccurrence: () => remove() },
		reportError: vi.fn(),
		reportUnavailable: unavailable,
	});
	await execution.execute("removeOccurrence");
	expect(remove).not.toHaveBeenCalled();
	expect(unavailable).toHaveBeenCalledWith("アウトライン編集で実行できます。");
	let selected = "a";
	const menu = new OccurrenceContextMenuController({
		exists: () => true,
		select: () => true,
		selected: () => selected,
		execute: execution.execute,
		remove,
		navigate: vi.fn(),
		actions: {},
		run: execution.run,
	});
	menu.open("a", "tree", new Mouse() as unknown as MouseEvent);
	const deleting = menu.execute("remove-occurrence");
	await menu.execute("remove-occurrence");
	expect(remove).toHaveBeenCalledTimes(1);
	expect(remove).toHaveBeenCalledWith("a");
	release();
	await deleting;
	selected = "b";
	await menu.execute("remove-occurrence");
	menu.close();
	await menu.execute("remove-occurrence");
	expect(remove).toHaveBeenCalledTimes(1);
});
