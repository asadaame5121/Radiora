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
		expect(f.navigation.view).toBe(choice === "cancel" ? "today" : "outline");
		expect(refreshHistory).toHaveBeenCalledTimes(choice === "cancel" ? 0 : 1);
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
	await f.navigation.goBack();
	expect(f.location().hoistOccurrenceId).toBe("source");
});
