import { describe, expect, test } from "vitest";
import { createConfirmationController } from "../src/ui/confirmation_controller.svelte.ts";

describe("confirmation controller", () => {
	test("rejects submission without a pending action", () => {
		const controller = createConfirmationController();

		expect(controller.rewriteBranchName).toBe("");
		expect(controller.beginSubmission()).toBeNull();
		expect(controller.submitting).toBe(false);
	});

	test("submits non-rewrite actions without a branch name", () => {
		const controller = createConfirmationController();
		controller.request({ action: "trash", occurrenceId: "one", occurrenceCount: 1 });

		expect(controller.beginSubmission()).toEqual({
			action: "trash",
			occurrenceId: "one",
			occurrenceCount: 1,
		});
		expect(controller.submitting).toBe(true);
	});

	test("allows only one pending request", () => {
		const controller = createConfirmationController();

		expect(
			controller.request({ action: "trash", occurrenceId: "one", occurrenceCount: 1 }),
		).toBe(true);
		expect(
			controller.request({ action: "trash", occurrenceId: "two", occurrenceCount: 1 }),
		).toBe(false);
		expect(controller.pending?.action).toBe("trash");
	});

	test("validates rewrite input and retains failed actions", () => {
		const controller = createConfirmationController();
		controller.request({
			action: "rewrite",
			occurrenceId: "occurrence",
			workId: "work",
			sourceBranchId: "branch",
		});

		controller.rewriteBranchName = "   ";
		expect(controller.beginSubmission()).toBeNull();
		expect(controller.submitting).toBe(false);
		controller.rewriteBranchName = "new branch";
		expect(controller.beginSubmission()?.action).toBe("rewrite");
		expect(controller.submitting).toBe(true);
		expect(controller.beginSubmission()).toBeNull();
		expect(controller.reset()).toBe(false);

		controller.finishSubmission(false);
		expect(controller.submitting).toBe(false);
		expect(controller.pending?.action).toBe("rewrite");
		expect(controller.rewriteBranchName).toBe("new branch");

		controller.finishSubmission(true);
		expect(controller.pending).toBeNull();
		expect(controller.rewriteBranchName).toBe("");
	});

	test("resets an idle pending action and rewrite input", () => {
		const controller = createConfirmationController();
		controller.request({
			action: "rewrite",
			occurrenceId: "occurrence",
			workId: "work",
			sourceBranchId: "branch",
		});
		controller.rewriteBranchName = "new branch";

		expect(controller.reset()).toBe(true);
		expect(controller.pending).toBeNull();
		expect(controller.rewriteBranchName).toBe("");
	});
});
