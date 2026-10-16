import { expect, test, vi } from "vitest";
import { BranchRewriteController } from "../src/ui/branch_rewrite_controller.ts";
import type { RadioraBindings } from "../src/shared/bindings.ts";
import { navigationFixture } from "./navigation_fixture.ts";

for (const choice of ["save", "discard", "cancel"] as const) {
	test(`branch placement navigates only after ${choice}`, async () => {
		const f = navigationFixture();
		await f.navigation.navigate({ view: "today" });
		f.dirty();
		const refreshHistory = vi.fn();
		const api = {
			rewriteAsNewBranch: vi.fn(async () => ({ status: "created", branch: { id: "new" } })),
			createOccurrence: vi.fn(async () => f.created),
		} as unknown as Pick<RadioraBindings, "rewriteAsNewBranch" | "createOccurrence">;
		const controller = new BranchRewriteController({
			api,
			getSnapshot: f.snapshot,
			navigation: f.navigation,
			reload: vi.fn(async () => true),
			refreshHistory,
		});
		const pending = controller.confirmRewrite({
			action: "rewrite",
			occurrenceId: "source",
			sourceBranchId: "branch-source",
			workId: "work-source",
		}, "new");
		await vi.waitFor(() => expect(f.guard.pending).not.toBeNull());
		expect(f.selected()).toBe("source");
		await f.guard.resolvePending(choice);
		await pending;
		expect(api.rewriteAsNewBranch).toHaveBeenCalledWith(
			"branch-source",
			"new",
			"confirmed",
		);
		expect(api.createOccurrence).toHaveBeenCalledWith({
			workId: "work-source",
			branchId: "new",
			parentId: null,
			afterId: "source",
			contextualHeading: undefined,
		});
		expect(f.navigation.view).toBe(choice === "cancel" ? "today" : "outline");
		expect(f.selected()).toBe(choice === "cancel" ? "source" : f.created.id);
		expect(refreshHistory).toHaveBeenCalledTimes(1);
	});
}

test("failed branch creation preserves the origin and Outline return state", async () => {
	const f = navigationFixture();
	await f.navigation.navigate({ view: "today" });
	const api = {
		rewriteAsNewBranch: vi.fn(async () => {
			throw new Error("offline");
		}),
		createOccurrence: vi.fn(),
	} as unknown as Pick<RadioraBindings, "rewriteAsNewBranch" | "createOccurrence">;
	const controller = new BranchRewriteController({
		api,
		getSnapshot: f.snapshot,
		navigation: f.navigation,
		reload: vi.fn(),
		refreshHistory: vi.fn(),
	});
	await expect(
		controller.confirmRewrite({
			action: "rewrite",
			occurrenceId: "source",
			sourceBranchId: "branch-source",
			workId: "work-source",
		}, "new"),
	).rejects.toThrow("offline");
	expect(api.rewriteAsNewBranch).toHaveBeenCalledWith(
		"branch-source",
		"new",
		"confirmed",
	);
	expect(api.createOccurrence).not.toHaveBeenCalled();
	await f.navigation.goBack();
	expect(f.location().hoistOccurrenceId).toBe("source");
});

test("a persisted rewrite refreshes history even when its navigation origin is stale", async () => {
	const f = navigationFixture();
	let finishCreation!: () => void;
	const creating = new Promise<void>((resolve) => finishCreation = resolve);
	const api = {
		rewriteAsNewBranch: vi.fn(async () => {
			await creating;
			return { status: "created", branch: { id: "new" } };
		}),
		createOccurrence: vi.fn(async () => f.created),
	} as unknown as Pick<RadioraBindings, "rewriteAsNewBranch" | "createOccurrence">;
	const refreshHistory = vi.fn(async () => undefined);
	const controller = new BranchRewriteController({
		api,
		getSnapshot: f.snapshot,
		navigation: f.navigation,
		reload: vi.fn(async () => true),
		refreshHistory,
	});
	const rewriting = controller.confirmRewrite({
		action: "rewrite",
		occurrenceId: "source",
		sourceBranchId: "branch-source",
		workId: "work-source",
	}, "new");
	await f.navigation.navigate({ view: "help" });
	finishCreation();
	await rewriting;
	expect(api.createOccurrence).toHaveBeenCalledTimes(1);
	expect(api.rewriteAsNewBranch).toHaveBeenCalledWith(
		"branch-source",
		"new",
		"confirmed",
	);
	expect(refreshHistory).toHaveBeenCalledWith("work-source");
	expect(f.navigation.view).toBe("help");
	expect(f.selected()).toBe("source");
});
