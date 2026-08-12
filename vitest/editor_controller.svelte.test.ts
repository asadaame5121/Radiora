import { describe, expect, test, vi } from "vitest";
import { createEditorController } from "../src/ui/editor_controller.svelte.ts";

function createController() {
	const listInternalReferenceCompletions = vi.fn().mockResolvedValue([
		{
			scope: "work",
			id: "work-1",
			workId: "work-1",
			displayName: "First",
			isEmpty: false,
			scopeLabel: "Work",
			shortId: "work-1",
			canonicalMarkdown: "[First](radiora://work/work-1)",
		},
		{
			scope: "work",
			id: "work-2",
			workId: "work-2",
			displayName: "Second",
			isEmpty: false,
			scopeLabel: "Work",
			shortId: "work-2",
			canonicalMarkdown: "[Second](radiora://work/work-2)",
		},
	]);
	const controller = createEditorController({
		api: {
			updateItemText: vi.fn(),
			saveResumePosition: vi.fn(),
			listInternalReferenceCompletions,
			quickCapture: vi.fn(),
			createLink: vi.fn(),
			resolveInternalReferences: vi.fn(),
			listInternalReferenceBacklinks: vi.fn(),
		},
		getSnapshot: () => ({ items: [], links: [], knots: [], stashItemIds: [] }),
		getSelectedId: () => null,
		reload: vi.fn(),
		loadUnplacedWorks: vi.fn(),
		openNavigationTarget: vi.fn(),
		loadRevisions: vi.fn(),
		openRevisionComparison: vi.fn(),
		requestFocus: vi.fn(),
		findTextarea: vi.fn().mockReturnValue(null),
		reportError: vi.fn(),
		errorMessage: String,
		persistSnapshotCache: vi.fn(),
		vocabulary: {
			work: "Work",
			occurrence: "Occurrence",
			revision: "Revision",
			semanticLink: "Link",
		},
	});
	return { controller, listInternalReferenceCompletions };
}

describe("editor controller", () => {
	test("owns internal-reference completion state", async () => {
		const { controller, listInternalReferenceCompletions } = createController();
		const textarea = {
			value: "[[Fi",
			selectionStart: 4,
			selectionEnd: 4,
		} as HTMLTextAreaElement;

		await controller.updateInternalReferenceCompletion("item-1", textarea);

		expect(listInternalReferenceCompletions).toHaveBeenCalledWith("Fi", 12);
		expect(controller.internalReferenceCompletion?.itemId).toBe("item-1");
		expect(controller.internalReferenceCompletion?.candidates).toHaveLength(2);

		controller.moveInternalReferenceActiveIndex(1);
		expect(controller.internalReferenceCompletion?.activeIndex).toBe(1);
		controller.cancelInternalReferenceCompletion();
		expect(controller.internalReferenceCompletion).toBeNull();
	});
});
