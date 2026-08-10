import { describe, expect, test, vi } from "vitest";
import type { OutlineSnapshot, UnplacedWork } from "../src/domain/models.ts";
import type { DuplicateCandidate } from "../src/services/duplicate_candidates.ts";
import {
	createWorkController,
	duplicateCandidateKey,
	duplicateCandidateReason,
	type WorkApiPort,
	type WorkControllerPorts,
} from "../src/ui/work_controller.svelte.ts";

const EMPTY_SNAPSHOT: OutlineSnapshot = { items: [], links: [], knots: [], stashItemIds: [] };

function candidate(firstId: string, secondId: string, label: string): DuplicateCandidate {
	return {
		workA: { workId: firstId, title: firstId },
		workB: { workId: secondId, title: secondId },
		score: 3,
		reasons: [{ kind: "title", label, score: 3 }],
	};
}

function createPorts(apiOverrides: Partial<WorkApiPort>): WorkControllerPorts {
	return {
		api: apiOverrides as WorkApiPort,
		getSnapshot: () => EMPTY_SNAPSHOT,
		reload: vi.fn(async () => true),
		openView: vi.fn(),
		selectOccurrence: vi.fn(),
		requestConfirmation: vi.fn(async () => {}),
		reportError: vi.fn(),
	};
}

describe("work controller", () => {
	test("excluded duplicate candidates stay excluded after reloading", async () => {
		const excluded = candidate("work-b", "work-a", "タイトルが一致");
		const remaining = candidate("work-c", "work-d", "共通タグ");
		const listDuplicateCandidates = vi.fn(async () => [excluded, remaining]);
		const controller = createWorkController(createPorts({ listDuplicateCandidates }));

		await controller.loadDuplicates();
		expect(controller.duplicateCandidates).toEqual([excluded, remaining]);
		expect(controller.duplicateCandidateKey(excluded)).toBe("work-a:work-b");
		expect(duplicateCandidateKey(excluded)).toBe("work-a:work-b");
		expect(controller.duplicateCandidateReason(excluded)).toBe("タイトルが一致");
		expect(duplicateCandidateReason(remaining)).toBe("共通タグ");

		controller.excludeDuplicateCandidate(excluded);
		expect(controller.excludedDuplicateCandidateKeys).toEqual(["work-a:work-b"]);
		expect(controller.duplicateCandidates).toEqual([remaining]);

		await controller.loadDuplicates();
		expect(listDuplicateCandidates).toHaveBeenCalledTimes(2);
		expect(controller.duplicateCandidates).toEqual([remaining]);
	});

	test("refreshes unplaced state after an update I/O operation", async () => {
		const before: UnplacedWork = {
			workId: "work-1",
			branchId: "branch-1",
			text: "before",
			createdAt: "2026-08-09T00:00:00.000Z",
			updatedAt: "2026-08-09T00:00:00.000Z",
		};
		const after = { ...before, text: "after", updatedAt: "2026-08-09T00:01:00.000Z" };
		const updateUnplacedWorkText = vi.fn(async () => {});
		const listUnplacedWorks = vi.fn()
			.mockResolvedValueOnce([before])
			.mockResolvedValueOnce([after]);
		const controller = createWorkController(createPorts({
			updateUnplacedWorkText,
			listUnplacedWorks,
		}));

		await controller.loadUnplacedWorks();
		expect(controller.unplacedWorks).toEqual([before]);

		await controller.updateUnplacedText(before, "after");
		expect(updateUnplacedWorkText).toHaveBeenCalledWith("work-1", "after");
		expect(controller.unplacedWorks).toEqual([after]);
	});
});
