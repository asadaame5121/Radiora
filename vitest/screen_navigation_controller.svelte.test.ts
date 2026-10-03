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

test("a guarded destination change preserves the context from before selection", async () => {
	const { controller, change, context } = setup();
	controller.open("today");
	const commit = controller.prepareOpen("outline");
	change("destination");
	commit();
	commit();
	await controller.goBack();
	expect(controller.view).toBe("today");
	expect(context().selectedId).toBe("original");
	await controller.goBack();
	expect(controller.view).toBe("outline");
	expect(controller.canGoBack).toBe(false);
});

test("an uncommitted guarded transition does not change the screen or history", async () => {
	const { controller } = setup();
	controller.prepareOpen("today");
	expect(controller.view).toBe("outline");
	expect(controller.canGoBack).toBe(false);
	const commit = controller.prepareOpen("outline");
	commit();
	expect(controller.canGoBack).toBe(false);
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

test("a prepared transition cannot supersede a later screen transition", async () => {
	const { controller } = setup();
	controller.open("workLineage");
	const comparison = controller.prepareOpen("comparison");
	controller.open("help");
	comparison();
	expect(controller.view).toBe("help");
	await controller.goBack();
	expect(controller.view).toBe("workLineage");
	await controller.goBack();
	expect(controller.view).toBe("outline");
	expect(controller.canGoBack).toBe(false);
});

test("returning to the same origin does not reactivate an old prepared transition", async () => {
	const { controller } = setup();
	controller.open("workLineage");
	const comparison = controller.prepareOpen("comparison");
	controller.open("help");
	await controller.goBack();
	comparison();
	expect(controller.view).toBe("workLineage");
	await controller.goBack();
	expect(controller.view).toBe("outline");
	expect(controller.canGoBack).toBe(false);
});

test("a successful Back invalidates a transition prepared on the screen being left", async () => {
	const { controller } = setup();
	controller.open("workLineage");
	const comparison = controller.prepareOpen("comparison");
	await controller.goBack();
	comparison();
	expect(controller.view).toBe("outline");
	expect(controller.canGoBack).toBe(false);
});

test("an inspector transition invalidates older prepared screen transitions", async () => {
	const { controller } = setup();
	const comparison = controller.prepareOpen("comparison");
	controller.remember();
	comparison();
	expect(controller.view).toBe("outline");
	await controller.goBack();
	expect(controller.canGoBack).toBe(false);
});

test("only the first of two prepared transitions on one origin can commit", async () => {
	const { controller } = setup();
	const comparison = controller.prepareOpen("comparison");
	const help = controller.prepareOpen("help");
	help();
	comparison();
	expect(controller.view).toBe("help");
	await controller.goBack();
	expect(controller.view).toBe("outline");
	expect(controller.canGoBack).toBe(false);
});

test("a cancelled Back preserves a prepared transition on the unchanged screen", async () => {
	const { controller, restore } = setup();
	controller.open("workLineage");
	const comparison = controller.prepareOpen("comparison");
	restore.mockResolvedValueOnce(false);
	await controller.goBack();
	comparison();
	expect(controller.view).toBe("comparison");
	await controller.goBack();
	expect(controller.view).toBe("workLineage");
});
