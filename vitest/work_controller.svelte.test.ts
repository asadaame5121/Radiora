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
		requestConfirmation: vi.fn(async () => {
			// intentional no-op
		}),
		reportError: vi.fn(),
	};
}

describe("work controller", () => {
	test("exposes empty feature state before loading", () => {
		const controller = createWorkController(createPorts({}));

		expect(controller.quickCaptureSubmitting).toBe(false);
		expect(controller.unplacedWorks).toEqual([]);
		expect(controller.stubEntries).toEqual([]);
		expect(controller.duplicateCandidates).toEqual([]);
		expect(controller.excludedDuplicateCandidateKeys).toEqual([]);
		expect(controller.unplacedLinkType).toBe("RELATED");
		expect(controller.trashEntries).toEqual([]);
	});

	test("joins every duplicate reason in display order", () => {
		const duplicate = candidate("work-a", "work-b", "same title");
		duplicate.reasons.push({ kind: "tag", label: "same tag", score: 1 });

		expect(duplicateCandidateReason(duplicate)).toBe("same title / same tag");
	});

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
		controller.excludeDuplicateCandidate(excluded);
		expect(controller.excludedDuplicateCandidateKeys).toEqual(["work-a:work-b"]);

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
		const updateUnplacedWorkText = vi.fn(async () => {
			// intentional no-op
		});
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

	describe("quick capture", () => {
		test("captures to root with afterId from existing roots", async () => {
			const createItem = vi.fn().mockResolvedValue({ id: "item-new", workId: "work-new" });
			const reload = vi.fn().mockResolvedValue(true);
			const openView = vi.fn();
			const clearQuickCaptureInput = vi.fn();
			const snapshot: OutlineSnapshot = {
				items: [
					{
						id: "root-1",
						workId: "w-1",
						parentId: null,
						orderKey: 10,
						collapsed: false,
						text: "R1",
						revisionSelector: { mode: "branch", branchId: "b-1" },
					},
					{
						id: "root-2",
						workId: "w-2",
						parentId: null,
						orderKey: 20,
						collapsed: false,
						text: "R2",
						revisionSelector: { mode: "branch", branchId: "b-2" },
					},
					{
						id: "child-1",
						workId: "w-3",
						parentId: "root-1",
						orderKey: 15,
						collapsed: false,
						text: "C1",
						revisionSelector: { mode: "branch", branchId: "b-3" },
					},
				],
				links: [],
				knots: [],
				stashItemIds: [],
			};
			const ports = createPorts({ createItem });
			ports.getSnapshot = () => snapshot;
			ports.reload = reload;
			ports.openView = openView;
			ports.clearQuickCaptureInput = clearQuickCaptureInput;

			const controller = createWorkController(ports);
			await controller.performQuickCapture("New root item", "root");

			expect(createItem).toHaveBeenCalledWith({
				text: "New root item",
				parentId: null,
				afterId: "root-2",
			});
			expect(openView).toHaveBeenCalledWith("outline");
			expect(reload).toHaveBeenCalledWith("item-new");
			expect(clearQuickCaptureInput).toHaveBeenCalled();
			expect(controller.quickCaptureSubmitting).toBe(false);
		});

		test("captures to root with afterId null when no roots exist", async () => {
			const createItem = vi.fn().mockResolvedValue({ id: "item-first", workId: "work-first" });
			const ports = createPorts({ createItem });
			const controller = createWorkController(ports);

			await controller.performQuickCapture("First item", "root");

			expect(createItem).toHaveBeenCalledWith({
				text: "First item",
				parentId: null,
				afterId: null,
			});
		});

		test("captures to unplaced and reloads outline and unplaced works", async () => {
			const quickCapture = vi.fn().mockResolvedValue({ workId: "w-unplaced" });
			const listUnplacedWorks = vi.fn().mockResolvedValue([]);
			const reload = vi.fn().mockResolvedValue(true);
			const clearQuickCaptureInput = vi.fn();
			const ports = createPorts({ quickCapture, listUnplacedWorks });
			ports.reload = reload;
			ports.clearQuickCaptureInput = clearQuickCaptureInput;

			const controller = createWorkController(ports);
			await controller.performQuickCapture("Unplaced memo", "unplaced");

			expect(quickCapture).toHaveBeenCalledWith("Unplaced memo");
			expect(reload).toHaveBeenCalled();
			expect(listUnplacedWorks).toHaveBeenCalled();
			expect(clearQuickCaptureInput).toHaveBeenCalled();
			expect(controller.quickCaptureSubmitting).toBe(false);
		});

		test("reports error and resets submitting flag when capture fails", async () => {
			const error = new Error("Capture failed");
			const quickCapture = vi.fn().mockRejectedValue(error);
			const reportError = vi.fn();
			const ports = createPorts({ quickCapture });
			ports.reportError = reportError;

			const controller = createWorkController(ports);
			await controller.performQuickCapture("Failed capture", "unplaced");

			expect(reportError).toHaveBeenCalledWith(error);
			expect(controller.quickCaptureSubmitting).toBe(false);
		});
	});

	describe("unplaced operations", () => {
		test("openUnplaced loads works and switches view", async () => {
			const listUnplacedWorks = vi.fn().mockResolvedValue([]);
			const openView = vi.fn();
			const ports = createPorts({ listUnplacedWorks });
			ports.openView = openView;

			const controller = createWorkController(ports);
			await controller.openUnplaced();

			expect(listUnplacedWorks).toHaveBeenCalled();
			expect(openView).toHaveBeenCalledWith("unplaced");
		});

		test("placeUnplaced places work, reloads, opens outline, and selects item", async () => {
			const createdItem = { id: "occ-1", workId: "w-1" };
			const placeUnplacedWork = vi.fn().mockResolvedValue(createdItem);
			const listUnplacedWorks = vi.fn().mockResolvedValue([]);
			const reload = vi.fn().mockResolvedValue(true);
			const openView = vi.fn();
			const selectOccurrence = vi.fn();
			const ports = createPorts({ placeUnplacedWork, listUnplacedWorks });
			ports.reload = reload;
			ports.openView = openView;
			ports.selectOccurrence = selectOccurrence;

			const controller = createWorkController(ports);
			await controller.placeUnplaced("w-1", "parent-1");

			expect(placeUnplacedWork).toHaveBeenCalledWith({ workId: "w-1", parentId: "parent-1" });
			expect(reload).toHaveBeenCalledWith("occ-1");
			expect(listUnplacedWorks).toHaveBeenCalled();
			expect(openView).toHaveBeenCalledWith("outline");
			expect(selectOccurrence).toHaveBeenCalledWith("occ-1");
		});

		test("linkUnplaced creates link with specified direction and type, then clears target", async () => {
			const createLink = vi.fn().mockResolvedValue(undefined);
			const reload = vi.fn().mockResolvedValue(true);
			const ports = createPorts({ createLink });
			ports.reload = reload;

			const controller = createWorkController(ports);

			// Blank target should return early
			controller.unplacedLinkTargets = { "w-1": "   " };
			await controller.linkUnplaced("w-1");
			expect(createLink).not.toHaveBeenCalled();

			// Default direction (from w-1 to target)
			controller.unplacedLinkTargets = { "w-1": "target-1" };
			controller.unplacedLinkType = "PARENT";
			await controller.linkUnplaced("w-1");

			expect(createLink).toHaveBeenCalledWith({
				fromId: "w-1",
				toId: "target-1",
				type: "PARENT",
			});
			expect(controller.unplacedLinkTargets["w-1"]).toBe("");
			expect(reload).toHaveBeenCalledTimes(1);

			// Reverse direction (to: from target to w-1)
			controller.unplacedLinkTargets = { "w-2": "target-2" };
			controller.unplacedLinkDirections = { "w-2": "to" };
			controller.unplacedLinkType = "CHILD";
			await controller.linkUnplaced("w-2");

			expect(createLink).toHaveBeenCalledWith({
				fromId: "target-2",
				toId: "w-2",
				type: "CHILD",
			});
			expect(controller.unplacedLinkTargets["w-2"]).toBe("");
		});

		test("unplaced operations catch and report errors", async () => {
			const error = new Error("Fail");
			const reportError = vi.fn();
			const ports = createPorts({
				listUnplacedWorks: vi.fn().mockRejectedValue(error),
				placeUnplacedWork: vi.fn().mockRejectedValue(error),
				createLink: vi.fn().mockRejectedValue(error),
				updateUnplacedWorkText: vi.fn().mockRejectedValue(error),
			});
			ports.reportError = reportError;

			const controller = createWorkController(ports);
			await controller.openUnplaced();
			expect(reportError).toHaveBeenCalledWith(error);

			await controller.placeUnplaced("w-1", null);
			expect(reportError).toHaveBeenCalledWith(error);

			const failedWork: UnplacedWork = {
				workId: "w-1",
				branchId: "b-1",
				text: "fail",
				createdAt: "2026-08-09T00:00:00.000Z",
				updatedAt: "2026-08-09T00:00:00.000Z",
			};
			await controller.updateUnplacedText(failedWork, "err");
			expect(reportError).toHaveBeenCalledWith(error);

			controller.unplacedLinkDirections = { "w-1": "from" };
			expect(controller.unplacedLinkDirections).toEqual({ "w-1": "from" });

			controller.unplacedLinkTargets = { "w-1": "target-1" };
			await controller.linkUnplaced("w-1");
			expect(reportError).toHaveBeenCalledWith(error);
		});
	});

	describe("stubs operations", () => {
		test("openStubs loads entries and opens stubs view", async () => {
			const listStubs = vi.fn().mockResolvedValue([]);
			const openView = vi.fn();
			const ports = createPorts({ listStubs });
			ports.openView = openView;

			const controller = createWorkController(ports);
			await controller.openStubs();

			expect(listStubs).toHaveBeenCalled();
			expect(openView).toHaveBeenCalledWith("stubs");
		});

		test("createStubFromList creates stub and reloads stubs", async () => {
			const createStub = vi.fn().mockResolvedValue({ work: { id: "s-1" } });
			const listStubs = vi.fn().mockResolvedValue([]);
			const ports = createPorts({ createStub, listStubs });

			const controller = createWorkController(ports);
			await controller.createStubFromList();

			expect(createStub).toHaveBeenCalledWith("stub-list");
			expect(listStubs).toHaveBeenCalled();
		});

		test("updateStubText guards against empty text and unchanged text", async () => {
			const updateUnplacedWorkText = vi.fn().mockResolvedValue(undefined);
			const listStubs = vi.fn().mockResolvedValue([]);
			const ports = createPorts({ updateUnplacedWorkText, listStubs });

			const controller = createWorkController(ports);
			const entry = {
				workId: "w-stub",
				title: "Initial",
				text: "Initial text",
				createdAt: "2026-08-10T00:00:00.000Z",
				updatedAt: "2026-08-10T00:00:00.000Z",
				resolved: false,
				backlinks: [],
			};

			// Empty/whitespace text guard
			await controller.updateStubText(entry, "   ");
			expect(updateUnplacedWorkText).not.toHaveBeenCalled();

			// Unchanged text guard
			await controller.updateStubText(entry, "Initial text");
			expect(updateUnplacedWorkText).not.toHaveBeenCalled();

			// Valid updated text
			await controller.updateStubText(entry, "Updated text");
			expect(updateUnplacedWorkText).toHaveBeenCalledWith("w-stub", "Updated text");
			expect(listStubs).toHaveBeenCalled();
		});

		test("resolveStubEntry resolves stub and reloads stubs and unplaced", async () => {
			const resolveStub = vi.fn().mockResolvedValue(undefined);
			const listStubs = vi.fn().mockResolvedValue([]);
			const listUnplacedWorks = vi.fn().mockResolvedValue([]);
			const ports = createPorts({ resolveStub, listStubs, listUnplacedWorks });

			const controller = createWorkController(ports);
			await controller.resolveStubEntry("w-stub");

			expect(resolveStub).toHaveBeenCalledWith("w-stub");
			expect(listStubs).toHaveBeenCalled();
			expect(listUnplacedWorks).toHaveBeenCalled();
		});

		test("stub operations report errors", async () => {
			const error = new Error("Stub error");
			const reportError = vi.fn();
			const ports = createPorts({
				listStubs: vi.fn().mockRejectedValue(error),
				createStub: vi.fn().mockRejectedValue(error),
				updateUnplacedWorkText: vi.fn().mockRejectedValue(error),
				resolveStub: vi.fn().mockRejectedValue(error),
			});
			ports.reportError = reportError;

			const controller = createWorkController(ports);
			await controller.openStubs();
			expect(reportError).toHaveBeenCalledWith(error);

			await controller.createStubFromList();
			expect(reportError).toHaveBeenCalledWith(error);

			const entry = {
				workId: "w-stub",
				title: "T",
				text: "Old",
				createdAt: "2026-08-10T00:00:00.000Z",
				updatedAt: "2026-08-10T00:00:00.000Z",
				resolved: false,
				backlinks: [],
			};
			await controller.updateStubText(entry, "New");
			expect(reportError).toHaveBeenCalledWith(error);

			await controller.resolveStubEntry("w-stub");
			expect(reportError).toHaveBeenCalledWith(error);
		});
	});

	describe("duplicate operations", () => {
		test("openDuplicates loads candidates and opens duplicates view", async () => {
			const listDuplicateCandidates = vi.fn().mockResolvedValue([]);
			const openView = vi.fn();
			const ports = createPorts({ listDuplicateCandidates });
			ports.openView = openView;

			const controller = createWorkController(ports);
			await controller.openDuplicates();

			expect(listDuplicateCandidates).toHaveBeenCalled();
			expect(openView).toHaveBeenCalledWith("duplicates");
		});

		test("createDuplicateCandidateLink creates link, excludes candidate, and reloads", async () => {
			const dup = candidate("work-1", "work-2", "same title");
			const createLink = vi.fn().mockResolvedValue(undefined);
			const reload = vi.fn().mockResolvedValue(true);
			const listDuplicateCandidates = vi.fn().mockResolvedValue([dup]);
			const ports = createPorts({ createLink, listDuplicateCandidates });
			ports.reload = reload;

			const controller = createWorkController(ports);
			await controller.loadDuplicates();
			expect(controller.duplicateCandidates).toHaveLength(1);

			await controller.createDuplicateCandidateLink(dup, "LIKE");

			expect(createLink).toHaveBeenCalledWith({
				fromId: "work-1",
				toId: "work-2",
				type: "LIKE",
				origin: "human",
				status: "asserted",
				reason: "same title",
			});
			expect(controller.duplicateCandidates).toHaveLength(0);
			expect(reload).toHaveBeenCalled();
		});

		test("requestDuplicateMerge requests confirmation with preview", async () => {
			const preview = {
				sourceWork: { id: "w-src", title: "Src" },
				survivorWork: { id: "w-surv", title: "Surv" },
				reparentedOccurrences: [],
				repointedLinks: [],
			};
			const previewWorkMerge = vi.fn().mockResolvedValue(preview);
			const requestConfirmation = vi.fn().mockResolvedValue(undefined);
			const ports = createPorts({ previewWorkMerge });
			ports.requestConfirmation = requestConfirmation;

			const controller = createWorkController(ports);
			await controller.requestDuplicateMerge("w-src", "w-surv");

			expect(previewWorkMerge).toHaveBeenCalledWith("w-src", "w-surv");
			expect(requestConfirmation).toHaveBeenCalledWith({
				action: "merge-duplicate",
				preview,
			});
		});

		test("confirmDuplicateMerge merges works, reloads outline and duplicates", async () => {
			const preview = {
				sourceWork: { id: "w-src", title: "Src" },
				survivorWork: { id: "w-surv", title: "Surv" },
				reparentedOccurrences: [],
				repointedLinks: [],
			};
			const mergeWorks = vi.fn().mockResolvedValue(undefined);
			const reload = vi.fn().mockResolvedValue(true);
			const listDuplicateCandidates = vi.fn().mockResolvedValue([]);
			const ports = createPorts({ mergeWorks, listDuplicateCandidates });
			ports.reload = reload;

			const controller = createWorkController(ports);
			await controller.confirmDuplicateMerge(preview as unknown as WorkMergePreview);

			expect(mergeWorks).toHaveBeenCalledWith(preview);
			expect(reload).toHaveBeenCalled();
			expect(listDuplicateCandidates).toHaveBeenCalled();
		});

		test("duplicate operations report errors", async () => {
			const error = new Error("Dup error");
			const reportError = vi.fn();
			const ports = createPorts({
				listDuplicateCandidates: vi.fn().mockRejectedValue(error),
				createLink: vi.fn().mockRejectedValue(error),
				previewWorkMerge: vi.fn().mockRejectedValue(error),
			});
			ports.reportError = reportError;

			const controller = createWorkController(ports);
			await controller.openDuplicates();
			expect(reportError).toHaveBeenCalledWith(error);

			await controller.createDuplicateCandidateLink(candidate("a", "b", "reason"), "RELATED");
			expect(reportError).toHaveBeenCalledWith(error);

			await controller.requestDuplicateMerge("a", "b");
			expect(reportError).toHaveBeenCalledWith(error);
		});
	});

	describe("trash operations", () => {
		test("openTrash loads entries and opens trash view", async () => {
			const listTrash = vi.fn().mockResolvedValue([]);
			const openView = vi.fn();
			const ports = createPorts({ listTrash });
			ports.openView = openView;

			const controller = createWorkController(ports);
			await controller.openTrash();

			expect(listTrash).toHaveBeenCalled();
			expect(openView).toHaveBeenCalledWith("trash");
		});

		test("restoreTrash restores work, reloads trash and outline", async () => {
			const restoreWork = vi.fn().mockResolvedValue(undefined);
			const listTrash = vi.fn().mockResolvedValue([]);
			const reload = vi.fn().mockResolvedValue(true);
			const ports = createPorts({ restoreWork, listTrash });
			ports.reload = reload;

			const controller = createWorkController(ports);
			await controller.restoreTrash("w-trash");

			expect(restoreWork).toHaveBeenCalledWith("w-trash");
			expect(listTrash).toHaveBeenCalled();
			expect(reload).toHaveBeenCalled();
		});

		test("trashOccurrence finds item and requests confirmation with count", async () => {
			const requestConfirmation = vi.fn().mockResolvedValue(undefined);
			const snapshot: OutlineSnapshot = {
				items: [
					{
						id: "occ-1",
						workId: "work-target",
						parentId: null,
						orderKey: 1,
						collapsed: false,
						text: "T1",
						revisionSelector: { mode: "branch", branchId: "b-1" },
					},
					{
						id: "occ-2",
						workId: "work-target",
						parentId: null,
						orderKey: 2,
						collapsed: false,
						text: "T2",
						revisionSelector: { mode: "branch", branchId: "b-1" },
					},
				],
				links: [],
				knots: [],
				stashItemIds: [],
			};
			const ports = createPorts({});
			ports.getSnapshot = () => snapshot;
			ports.requestConfirmation = requestConfirmation;

			const controller = createWorkController(ports);

			// Item not found should return early
			await controller.trashOccurrence("non-existent");
			expect(requestConfirmation).not.toHaveBeenCalled();

			// Item found
			await controller.trashOccurrence("occ-1");
			expect(requestConfirmation).toHaveBeenCalledWith({
				action: "trash",
				occurrenceId: "occ-1",
				occurrenceCount: 2,
			});
		});

		test("purgeTrash requests confirmation with entry details", async () => {
			const requestConfirmation = vi.fn().mockResolvedValue(undefined);
			const ports = createPorts({});
			ports.requestConfirmation = requestConfirmation;

			const controller = createWorkController(ports);
			const entry: TrashEntry = {
				work: {
					id: "work-purge",
					createdAt: "2026-08-01T00:00:00.000Z",
					updatedAt: "2026-08-01T00:00:00.000Z",
				},
				occurrenceCount: 3,
				linkCount: 2,
			};

			await controller.purgeTrash(entry);
			expect(requestConfirmation).toHaveBeenCalledWith({
				action: "purge",
				workId: "work-purge",
				occurrenceCount: 3,
				linkCount: 2,
			});
		});

		test("confirmTrash trashes work, deselects occurrence, and reloads", async () => {
			const trashWork = vi.fn().mockResolvedValue(undefined);
			const selectOccurrence = vi.fn();
			const reload = vi.fn().mockResolvedValue(true);
			const ports = createPorts({ trashWork });
			ports.selectOccurrence = selectOccurrence;
			ports.reload = reload;

			const controller = createWorkController(ports);
			await controller.confirmTrash("occ-1");

			expect(trashWork).toHaveBeenCalledWith("occ-1");
			expect(selectOccurrence).toHaveBeenCalledWith(null);
			expect(reload).toHaveBeenCalled();
		});

		test("confirmPurge purges work, reloads trash, and reloads bookmarks", async () => {
			const purgeWork = vi.fn().mockResolvedValue(undefined);
			const listTrash = vi.fn().mockResolvedValue([]);
			const reloadBookmarks = vi.fn().mockResolvedValue(undefined);
			const ports = createPorts({ purgeWork, listTrash });
			ports.reloadBookmarks = reloadBookmarks;

			const controller = createWorkController(ports);
			await controller.confirmPurge("w-purge");

			expect(purgeWork).toHaveBeenCalledWith("w-purge");
			expect(listTrash).toHaveBeenCalled();
			expect(reloadBookmarks).toHaveBeenCalled();
		});

		test("trash operations report errors", async () => {
			const error = new Error("Trash error");
			const reportError = vi.fn();
			const ports = createPorts({
				listTrash: vi.fn().mockRejectedValue(error),
				restoreWork: vi.fn().mockRejectedValue(error),
			});
			ports.reportError = reportError;

			const controller = createWorkController(ports);
			await controller.openTrash();
			expect(reportError).toHaveBeenCalledWith(error);

			await controller.restoreTrash("w-1");
			expect(reportError).toHaveBeenCalledWith(error);
		});
	});
});
