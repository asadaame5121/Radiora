import { describe, expect, test } from "vitest";
import { createConfirmationController } from "../src/ui/confirmation_controller.svelte.ts";

describe("confirmation controller", () => {
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

		expect(controller.beginSubmission()).toBeNull();
		controller.rewriteBranchName = "new branch";
		expect(controller.beginSubmission()?.action).toBe("rewrite");
		expect(controller.submitting).toBe(true);
		expect(controller.reset()).toBe(false);

		controller.finishSubmission(false);
		expect(controller.submitting).toBe(false);
		expect(controller.pending?.action).toBe("rewrite");
		expect(controller.rewriteBranchName).toBe("new branch");

		controller.finishSubmission(true);
		expect(controller.pending).toBeNull();
		expect(controller.rewriteBranchName).toBe("");
	});
});
