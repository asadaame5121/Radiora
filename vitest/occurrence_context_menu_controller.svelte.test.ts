import { afterEach, expect, it, vi } from "vitest";
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
	const navigate = vi.fn(async () => undefined);
	const controller = new OccurrenceContextMenuController({
		exists: () => true,
		select: () => true,
		selected: () => selected,
		execute,
		navigate,
		actions: {},
		run: async (action) => {
			await action();
		},
	});
	controller.open("a", "tree", new Mouse() as unknown as MouseEvent);
	expect(controller.state).toMatchObject({ targetId: "a", x: 5, y: 7 });
	await controller.execute("remove-occurrence");
	expect(execute).toHaveBeenCalledWith("removeOccurrence");
	selected = "b";
	await controller.execute("create-link");
	expect(execute).toHaveBeenCalledTimes(1);
	await controller.execute("zoom");
	expect(navigate).toHaveBeenCalledWith("a", "zoom");
	controller.close();
	await controller.execute("remove-occurrence");
	expect(execute).toHaveBeenCalledTimes(1);
	expect(controller.state).toBeNull();
});
