import { expect, test, vi } from "vitest";
import { ScreenNavigationController } from "../src/ui/screen_navigation_controller.svelte.ts";

function setup() {
	let context = { selectedId: "original", comparison: "revision-a", aside: "overview" };
	const restore = vi.fn(async (saved: typeof context) => {
		context = saved;
		return true;
	});
	const controller = new ScreenNavigationController({
		capture: () => ({ ...context }),
		restore,
	});
	return {
		controller,
		restore,
		change: (id: string) => context.selectedId = id,
		context: () => context,
	};
}

test("Option and trash return to their immediate caller without adding history", async () => {
	const { controller } = setup();
	expect(controller.canGoBack).toBe(false);
	controller.open("options");
	controller.open("trash");
	await controller.goBack();
	expect(controller.view).toBe("options");
	await controller.goBack();
	expect(controller.view).toBe("outline");
	expect(controller.canGoBack).toBe(false);
	await controller.goBack();
	expect(controller.view).toBe("outline");
});

test("restores the selection and comparison context of the caller", async () => {
	const { controller, change, context } = setup();
	controller.open("workLineage");
	controller.open("comparison");
	change("other");
	await controller.goBack();
	expect(controller.view).toBe("workLineage");
	expect(context()).toEqual({
		selectedId: "original",
		comparison: "revision-a",
		aside: "overview",
	});
});

test("opening the same screen does not add a duplicate entry", async () => {
	const { controller } = setup();
	controller.open("options");
	controller.open("options");
	await controller.goBack();
	expect(controller.view).toBe("outline");
	expect(controller.canGoBack).toBe(false);
});

test("an inspector-only transition can remember the current screen", async () => {
	const { controller, restore } = setup();
	controller.remember();
	await controller.goBack();
	expect(controller.view).toBe("outline");
	expect(restore).toHaveBeenCalledOnce();
});

test("a blocked or failed restore retains the screen and return entry", async () => {
	const { controller, restore } = setup();
	controller.open("help");
	restore.mockResolvedValueOnce(false);
	await controller.goBack();
	expect(controller.view).toBe("help");
	expect(controller.canGoBack).toBe(true);
	restore.mockRejectedValueOnce(new Error("save failed"));
	await expect(controller.goBack()).rejects.toThrow("save failed");
	expect(controller.view).toBe("help");
	expect(controller.canGoBack).toBe(true);
	await controller.goBack();
	expect(controller.view).toBe("outline");
});

test("concurrent back requests only restore one entry", async () => {
	const { controller, restore } = setup();
	controller.open("options");
	controller.open("trash");
	await Promise.all([controller.goBack(), controller.goBack()]);
	expect(restore).toHaveBeenCalledOnce();
	expect(controller.view).toBe("options");
});
