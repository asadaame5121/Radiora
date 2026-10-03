import { expect, test, vi } from "vitest";
import type { OutlineItem } from "../src/domain/models.ts";
import { BranchRewriteController } from "../src/ui/branch_rewrite_controller.ts";
import { HistoricalTimeController } from "../src/ui/historical_time_controller.svelte.ts";
import { ScreenNavigationController } from "../src/ui/screen_navigation_controller.svelte.ts";

function setup(dirty = false) {
	const original = { id: "original", workId: "original" } as OutlineItem;
	const source = { id: "source", workId: "source", parentId: null } as OutlineItem;
	const created = { ...source, id: "created" };
	let selectedId = dirty ? original.id : source.id;
	const navigation = new ScreenNavigationController({
		capture: () => selectedId,
		restore: async (id: string) => {
			selectedId = id;
			return true;
		},
	});
	navigation.open("today");
	const guard = new HistoricalTimeController({
		save: vi.fn().mockResolvedValue(undefined),
		reload: vi.fn(),
		select: vi.fn(),
	});
	guard.select(dirty ? original : source);
	if (dirty) {
		guard.draft.start.unknown = false;
		guard.draft.start.year = "2026";
	}
	const ports = {
		api: {
			rewriteAsNewBranch: vi.fn().mockResolvedValue({
				status: "created",
				branch: { id: "branch", name: "new branch" },
			}),
			createOccurrence: vi.fn().mockResolvedValue(created),
		},
		getSnapshot: () => ({ items: [original, source], links: [], knots: [], stashItemIds: [] }),
		prepareView: () => navigation.prepareOpen("outline"),
		reload: vi.fn(async (_id: string, afterSelection: () => void) => {
			const commit = () => {
				selectedId = created.id;
				afterSelection();
			};
			if (guard.select(created, commit)) commit();
			return true;
		}),
		refreshHistory: vi.fn().mockResolvedValue(undefined),
	};
	const controller = new BranchRewriteController(ports);
	const rewrite = () =>
		controller.confirmRewrite({
			action: "rewrite",
			occurrenceId: source.id,
			workId: source.workId,
			sourceBranchId: "source-main",
		}, "new branch");
	return { navigation, guard, ports, rewrite, selected: () => selectedId };
}

test("branch rewrite captures the original occurrence before selecting its new placement", async () => {
	const { navigation, ports, rewrite, selected } = setup();
	await rewrite();
	expect(selected()).toBe("created");
	expect(navigation.view).toBe("outline");
	expect(ports.api.createOccurrence).toHaveBeenCalledWith({
		workId: "source",
		branchId: "branch",
		parentId: null,
		afterId: "source",
		contextualHeading: "new branch",
	});
	await navigation.goBack();
	expect(selected()).toBe("source");
	expect(navigation.view).toBe("today");
});

test.each(["cancel", "discard", "save"] as const)(
	"branch rewrite commits the screen only when its placement selection is accepted: %s",
	async (choice) => {
		const { navigation, guard, rewrite, selected } = setup(true);
		await rewrite();
		expect(guard.pending?.item?.id).toBe("created");
		expect(navigation.view).toBe("today");
		expect(selected()).toBe("original");
		await guard.resolvePending(choice);
		if (choice !== "cancel") {
			expect(navigation.view).toBe("outline");
			expect(selected()).toBe("created");
			await navigation.goBack();
		}
		expect(navigation.view).toBe("today");
		expect(selected()).toBe("original");
		await navigation.goBack();
		expect(navigation.canGoBack).toBe(false);
	},
);

test.each(["creation", "reload"] as const)(
	"failed %s does not commit branch navigation",
	async (stage) => {
		const { navigation, ports, rewrite } = setup();
		const error = new Error("offline");
		if (stage === "creation") ports.api.createOccurrence.mockRejectedValueOnce(error);
		else ports.reload.mockRejectedValueOnce(error);
		await expect(rewrite()).rejects.toBe(error);
		expect(navigation.view).toBe("today");
		await navigation.goBack();
		expect(navigation.canGoBack).toBe(false);
	},
);
