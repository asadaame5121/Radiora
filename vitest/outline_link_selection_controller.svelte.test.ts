import { describe, expect, test, vi } from "vitest";
import type { CreateLinkInput } from "../src/domain/models.ts";
import { OutlineLinkSelectionController } from "../src/ui/outline_link_selection_controller.svelte.ts";

describe("outline link selection controller", () => {
	test("keeps Work selection separate from the source and submits one input per target", async () => {
		const createLink = vi.fn(async (_input: CreateLinkInput): Promise<void> => undefined);
		const controller = new OutlineLinkSelectionController({ createLink });

		controller.start("source", "起点");
		controller.toggleTarget("source");
		controller.toggleTarget("target-a");
		controller.toggleTarget("target-b");
		controller.setType("SUPPORT");
		controller.setDirection("incoming");
		controller.setReason("  同じ理由  ");

		expect(await controller.submit()).toBe(true);
		expect(createLink.mock.calls).toEqual([
			[{ fromId: "target-a", toId: "source", type: "SUPPORT", reason: "同じ理由" }],
			[{ fromId: "target-b", toId: "source", type: "SUPPORT", reason: "同じ理由" }],
		]);
		expect(controller.active).toBe(false);
		expect(controller.selectedWorkIds).toEqual(new Set());
	});

	test("normalizes symmetric selections independently of the direction control", async () => {
		const createLink = vi.fn(async (_input: CreateLinkInput): Promise<void> => undefined);
		const controller = new OutlineLinkSelectionController({ createLink });

		controller.start("source", "起点");
		controller.toggleTarget("target");
		controller.setType("LIKE");
		controller.setDirection("incoming");

		expect(await controller.submit()).toBe(true);
		expect(createLink).toHaveBeenCalledWith({
			fromId: "source",
			toId: "target",
			type: "LIKE",
			reason: undefined,
		});
	});

	test("retains selection and exposes the error after a partial failure", async () => {
		const createLink = vi.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("保存に失敗しました"));
		const controller = new OutlineLinkSelectionController({ createLink });

		controller.start("source", "起点");
		controller.toggleTarget("target-a");
		controller.toggleTarget("target-b");

		expect(await controller.submit()).toBe(false);
		expect(controller.active).toBe(true);
		expect(controller.submitting).toBe(false);
		expect(controller.error).toBe("保存に失敗しました");
		expect(controller.selectedWorkIds).toEqual(new Set(["target-a", "target-b"]));
	});

	test("cancel clears the temporary mode when it is idle", () => {
		const controller = new OutlineLinkSelectionController({
			createLink: vi.fn(async (_input: CreateLinkInput): Promise<void> => undefined),
		});
		controller.start("source", "起点");
		controller.toggleTarget("target");

		expect(controller.cancel()).toBe(true);
		expect(controller.active).toBe(false);
		expect(controller.originWorkId).toBeNull();
		expect(controller.selectedWorkCount).toBe(0);
	});
});
