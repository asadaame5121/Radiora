import { expect, test, vi } from "vitest";
import type { OutlineItem } from "../src/domain/models.ts";
import { HistoricalTimeController } from "../src/ui/historical_time_controller.svelte.ts";
import { ScreenNavigationController } from "../src/ui/screen_navigation_controller.svelte.ts";
import { createWorkController, type WorkApiPort } from "../src/ui/work_controller.svelte.ts";

function item(id: string): OutlineItem {
	return {
		id,
		workId: id,
		text: id,
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `${id}-main` },
		createdAt: "2026-09-05T00:00:00.000Z",
		updatedAt: "2026-09-05T00:00:00.000Z",
	};
}

function setup() {
	const original = item("original");
	const created = item("created");
	let selectedId = original.id;
	const navigation = new ScreenNavigationController({
		capture: () => ({ selectedId }),
		restore: async (context: { selectedId: string }) => {
			selectedId = context.selectedId;
			return true;
		},
	});
	navigation.open("unplaced");
	const guard = new HistoricalTimeController({
		save: vi.fn().mockResolvedValue(undefined),
		reload: vi.fn().mockResolvedValue(true),
		select: vi.fn(),
	});
	guard.select(original);
	guard.draft.original = "unsaved";
	const reportError = vi.fn();
	const ports = {
		api: {
			createItem: vi.fn().mockResolvedValue(created),
			placeUnplacedWork: vi.fn().mockResolvedValue(created),
			listUnplacedWorks: vi.fn().mockResolvedValue([]),
		} as WorkApiPort,
		getSnapshot: () => ({ items: [original], links: [], knots: [], stashItemIds: [] }),
		reload: vi.fn(async (_focusId?: string, afterSelection?: () => void) => {
			const commit = () => {
				selectedId = created.id;
				afterSelection?.();
			};
			if (guard.select(created, commit)) commit();
			return true;
		}),
		openView: (view: "outline" | "unplaced" | "stubs" | "duplicates" | "trash") =>
			navigation.open(view),
		prepareView: (view: "outline" | "unplaced" | "stubs" | "duplicates" | "trash") =>
			navigation.prepareOpen(view),
		selectOccurrence: vi.fn(),
		requestConfirmation: vi.fn().mockResolvedValue(undefined),
		reportError,
	};
	return {
		controller: createWorkController(ports),
		navigation,
		guard,
		ports,
		selected: () => selectedId,
	};
}

for (const operation of ["place", "root capture"] as const) {
	for (const choice of ["cancel", "discard"] as const) {
		test(`${operation} commits screen history only after selection is accepted: ${choice}`, async () => {
			const { controller, navigation, guard, ports, selected } = setup();
			if (operation === "place") await controller.placeUnplaced("created", null);
			else await controller.performQuickCapture("created", "root");
			expect(guard.pending?.item?.id).toBe("created");
			expect(navigation.view).toBe("unplaced");
			expect(selected()).toBe("original");
			expect(ports.selectOccurrence).not.toHaveBeenCalled();
			await guard.resolvePending(choice);
			expect(navigation.view).toBe(choice === "cancel" ? "unplaced" : "outline");
			expect(selected()).toBe(choice === "cancel" ? "original" : "created");
			if (choice !== "cancel") {
				await navigation.goBack();
				expect(navigation.view).toBe("unplaced");
				expect(selected()).toBe("original");
			}
			await navigation.goBack();
			expect(navigation.view).toBe("outline");
			expect(navigation.canGoBack).toBe(false);
		});
	}

	test(`${operation} does not commit navigation when reloading fails`, async () => {
		const { controller, navigation, ports } = setup();
		const error = new Error("reload failed");
		ports.reload.mockRejectedValueOnce(error);
		if (operation === "place") await controller.placeUnplaced("created", null);
		else await controller.performQuickCapture("created", "root");
		expect(ports.reportError).toHaveBeenCalledWith(error);
		expect(navigation.view).toBe("unplaced");
		await navigation.goBack();
		expect(navigation.canGoBack).toBe(false);
	});
}
