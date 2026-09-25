import { describe, expect, test, vi } from "vitest";
import type { LinkType, OutlineSnapshot } from "../src/domain/models.ts";
import { createEditorController } from "../src/ui/editor_controller.svelte.ts";

function createController(overrides?: {
	api?: Partial<Parameters<typeof createEditorController>[0]["api"]>;
	snapshot?: OutlineSnapshot;
	selectedId?: string | null;
	findTextarea?: (itemId: string) => HTMLTextAreaElement | null;
	relationTypeNames?: () => readonly LinkType[];
	isSymmetricRelationType?: (type: LinkType) => boolean;
	ports?: Partial<Parameters<typeof createEditorController>[0]>;
}) {
	const listInternalReferenceCompletions = vi.fn().mockResolvedValue([
		{
			scope: "work",
			id: "work-1",
			workId: "work-1",
			displayName: "First",
			scopeLabel: "Work",
			shortId: "work-1",
			canonicalMarkdown: "[First](radiora://work/work-1)",
		},
		{
			scope: "work",
			id: "work-2",
			workId: "work-2",
			displayName: "Second",
			scopeLabel: "Work",
			shortId: "work-2",
			canonicalMarkdown: "[Second](radiora://work/work-2)",
		},
	]);
	const api = {
		updateItemText: vi.fn().mockResolvedValue(undefined),
		saveResumePosition: vi.fn().mockResolvedValue(undefined),
		listInternalReferenceCompletions,
		quickCapture: vi.fn().mockResolvedValue({
			workId: "work-created",
			branchId: "branch-created",
			text: "Created Work",
			createdAt: "2026-08-10T00:00:00.000Z",
			updatedAt: "2026-08-10T00:00:00.000Z",
		}),
		createLink: vi.fn().mockResolvedValue(undefined),
		resolveInternalReferences: vi.fn().mockResolvedValue([]),
		listInternalReferenceBacklinks: vi.fn().mockResolvedValue([]),
		...overrides?.api,
	};
	const ports: Parameters<typeof createEditorController>[0] = {
		api,
		getSnapshot: () => overrides?.snapshot ?? { items: [], links: [], knots: [], stashItemIds: [] },
		getSelectedId: () => overrides?.selectedId ?? null,
		reload: vi.fn().mockResolvedValue(true),
		loadUnplacedWorks: vi.fn().mockResolvedValue(undefined),
		openNavigationTarget: vi.fn().mockResolvedValue(undefined),
		loadRevisions: vi.fn().mockResolvedValue(undefined),
		openRevisionComparison: vi.fn(),
		requestFocus: vi.fn(),
		findTextarea: overrides?.findTextarea ?? vi.fn().mockReturnValue(null),
		reportError: vi.fn(),
		errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
		persistSnapshotCache: vi.fn(),
		relationTypeNames: overrides?.relationTypeNames,
		isSymmetricRelationType: overrides?.isSymmetricRelationType,
		vocabulary: {
			work: "Work",
			occurrence: "Occurrence",
			revision: "Revision",
			semanticLink: "Link",
		},
		...overrides?.ports,
	};
	const controller = createEditorController(ports);
	return { controller, ports, api, listInternalReferenceCompletions };
}

if (typeof globalThis.InputEvent === "undefined") {
	class MockInputEvent extends Event {
		inputType: string;
		data: string;
		constructor(type: string, init?: { bubbles?: boolean; inputType?: string; data?: string }) {
			super(type, init);
			this.inputType = init?.inputType ?? "";
			this.data = init?.data ?? "";
		}
	}
	(globalThis as typeof globalThis & { InputEvent: typeof MockInputEvent }).InputEvent =
		MockInputEvent;
}

function mockKeyboardEvent(
	init: { key: string; shiftKey?: boolean; isComposing?: boolean },
): KeyboardEvent {
	return {
		key: init.key,
		shiftKey: init.shiftKey ?? false,
		isComposing: init.isComposing ?? false,
		preventDefault: vi.fn(),
	} as KeyboardEvent;
}

function mockTextarea(
	value: string,
	selectionStart = value.length,
	selectionEnd = selectionStart,
): HTMLTextAreaElement {
	const listeners: Record<string, ((event: Event) => void)[]> = {};
	const textarea = {
		value,
		selectionStart,
		selectionEnd,
		focus: vi.fn(),
		setRangeText: vi.fn((replacement: string, start?: number, end?: number) => {
			const s = typeof start === "number" ? start : textarea.selectionStart;
			const e = typeof end === "number" ? end : textarea.selectionEnd;
			textarea.value = textarea.value.slice(0, s) + replacement + textarea.value.slice(e);
			textarea.selectionStart = s + replacement.length;
			textarea.selectionEnd = s + replacement.length;
		}),
		dispatchEvent: vi.fn((event: Event) => {
			for (const listener of listeners[event.type] ?? []) listener(event);
			return true;
		}),
		addEventListener: (type: string, listener: (event: Event) => void) => {
			listeners[type] = [...(listeners[type] ?? []), listener];
		},
		removeEventListener: (type: string, listener: (event: Event) => void) => {
			listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
		},
	};
	return textarea as HTMLTextAreaElement;
}

describe("editor controller", () => {
	test("owns internal-reference completion state", async () => {
		const { controller, listInternalReferenceCompletions } = createController();
		const textarea = mockTextarea("[[Fi", 4, 4);

		await controller.updateInternalReferenceCompletion("item-1", textarea);

		expect(listInternalReferenceCompletions).toHaveBeenCalledWith("Fi", 12);
		expect(controller.internalReferenceCompletion?.itemId).toBe("item-1");
		expect(controller.internalReferenceCompletion?.candidates).toHaveLength(2);

		controller.moveInternalReferenceActiveIndex(1);
		expect(controller.internalReferenceCompletion?.activeIndex).toBe(1);
		controller.cancelInternalReferenceCompletion();
		expect(controller.internalReferenceCompletion).toBeNull();
	});

	describe("autosave and local text updates", () => {
		test("updateLocalText updates branch working copy and queues autosave", async () => {
			const item = {
				id: "item-1",
				workId: "work-1",
				text: "initial",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: "branch-1" },
				createdAt: "2026-08-10T00:00:00.000Z",
				updatedAt: "2026-08-10T00:00:00.000Z",
			};
			const snapshot: OutlineSnapshot = {
				items: [item],
				links: [],
				knots: [],
				stashItemIds: [],
			};
			const { controller, api, ports } = createController({ snapshot });
			const textarea = mockTextarea("updated text", 12, 12);

			controller.updateLocalText("item-1", textarea);

			expect(item.text).toBe("updated text");
			expect(controller.hasUnsavedChanges()).toBe(true);
			expect(controller.drafts()).toHaveLength(1);

			await controller.flushAutosave("work-1");
			expect(api.updateItemText).toHaveBeenCalledWith("item-1", "updated text");
			expect(controller.hasUnsavedChanges()).toBe(false);
			expect(ports.persistSnapshotCache).toHaveBeenCalled();
		});

		test("updateLocalText debounces autosave and coalesces rapid edits", async () => {
			vi.useFakeTimers();
			try {
				const item = {
					id: "item-1",
					workId: "work-1",
					text: "initial",
					parentId: null,
					orderKey: 0,
					collapsed: false,
					revisionSelector: { mode: "branch" as const, branchId: "branch-1" },
					createdAt: "2026-08-10T00:00:00.000Z",
					updatedAt: "2026-08-10T00:00:00.000Z",
				};
				const snapshot: OutlineSnapshot = {
					items: [item],
					links: [],
					knots: [],
					stashItemIds: [],
				};
				const { controller, api } = createController({ snapshot });
				const textarea1 = mockTextarea("edit 1", 6, 6);

				controller.updateLocalText("item-1", textarea1);
				expect(api.updateItemText).not.toHaveBeenCalled();

				// Advance partially through the debounce interval (100ms < 250ms)
				await vi.advanceTimersByTimeAsync(100);
				expect(api.updateItemText).not.toHaveBeenCalled();

				// Second rapid edit before first debounce fires (coalescing)
				const textarea2 = mockTextarea("edit 2 (coalesced)", 18, 18);
				controller.updateLocalText("item-1", textarea2);
				expect(api.updateItemText).not.toHaveBeenCalled();

				// Advance past original timer (total 250ms elapsed, but only 150ms since second edit)
				await vi.advanceTimersByTimeAsync(150);
				expect(api.updateItemText).not.toHaveBeenCalled();

				// Advance until second timer expires (250ms from second edit)
				await vi.advanceTimersByTimeAsync(100);
				expect(api.updateItemText).toHaveBeenCalledTimes(1);
				expect(api.updateItemText).toHaveBeenCalledWith("item-1", "edit 2 (coalesced)");
			} finally {
				vi.useRealTimers();
			}
		});

		test("updateLocalText ignores pinned revision items", () => {
			const item = {
				id: "item-pinned",
				workId: "work-1",
				text: "pinned",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "pinned" as const, revisionId: "rev-1" },
				createdAt: "2026-08-10T00:00:00.000Z",
				updatedAt: "2026-08-10T00:00:00.000Z",
			};
			const snapshot: OutlineSnapshot = {
				items: [item],
				links: [],
				knots: [],
				stashItemIds: [],
			};
			const { controller } = createController({ snapshot });
			const textarea = mockTextarea("new text");

			controller.updateLocalText("item-pinned", textarea);
			expect(controller.hasUnsavedChanges()).toBe(false);
		});

		test("updateEditorSelection queues resume autosave for selected item", async () => {
			const { controller, api } = createController({ selectedId: "item-1" });
			const textarea = mockTextarea("text", 5, 5);

			controller.updateEditorSelection("item-1", textarea);
			await controller.flushResume();

			expect(api.saveResumePosition).toHaveBeenCalledWith("item-1", 5);
		});

		test("flush keeps the rejection contract and retry saves the retained draft", async () => {
			const item = {
				id: "item-1",
				workId: "work-1",
				text: "initial",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: "branch-1" },
				createdAt: "2026-08-10T00:00:00.000Z",
				updatedAt: "2026-08-10T00:00:00.000Z",
			};
			const snapshot: OutlineSnapshot = {
				items: [item],
				links: [],
				knots: [],
				stashItemIds: [],
			};
			const cause = new Error("disk full");
			const updateItemText = vi.fn()
				.mockRejectedValueOnce(cause)
				.mockResolvedValueOnce(undefined);
			const { controller, api } = createController({ snapshot, api: { updateItemText } });
			controller.updateLocalText("item-1", mockTextarea("unsaved latest text"));

			await expect(controller.flushAutosave("work-1")).rejects.toBe(cause);
			expect(controller.workingCopySaveStatus?.phase).toBe("failed");
			expect(controller.drafts()[0]?.text).toBe("unsaved latest text");

			await controller.retryAutosave();
			expect(api.updateItemText).toHaveBeenNthCalledWith(2, "item-1", "unsaved latest text");
			expect(controller.drafts()).toEqual([]);
		});
	});

	describe("inline link completion lifecycle", () => {
		test("detects @ trigger and enters candidate phase", async () => {
			const item = {
				id: "item-1",
				workId: "work-self",
				text: "Hello @Target",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: "b-1" },
			};
			const { controller, listInternalReferenceCompletions } = createController({
				snapshot: { items: [item], links: [], knots: [], stashItemIds: [] },
			});
			const textarea = mockTextarea("Hello @Target", 13, 13);

			await controller.updateInlineLinkCompletion("item-1", textarea);

			expect(listInternalReferenceCompletions).toHaveBeenCalledWith("Target", 16);
			expect(controller.inlineLinkCompletion).not.toBeNull();
			expect(controller.inlineLinkCompletion?.phase).toBe("candidate");
			expect(controller.inlineLinkCompletion?.query).toBe("Target");
			if (controller.inlineLinkCompletion) {
				expect(controller.inlineLinkCandidateCount(controller.inlineLinkCompletion)).toBe(3);
			}

			controller.moveInlineLinkActiveIndex(1);
			expect(controller.inlineLinkCompletion?.activeIndex).toBe(1);

			controller.cancelInlineLinkCompletion();
			expect(controller.inlineLinkCompletion).toBeNull();
		});

		test("selectInlineLinkCandidate transitions to type phase", async () => {
			const item = {
				id: "item-1",
				workId: "work-self",
				text: "@Target",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: "b-1" },
			};
			const { controller } = createController({
				snapshot: { items: [item], links: [], knots: [], stashItemIds: [] },
				relationTypeNames: () => ["RELATED" as LinkType, "PARENT" as LinkType],
			});
			const textarea = mockTextarea("@Target", 7, 7);

			await controller.updateInlineLinkCompletion("item-1", textarea);
			controller.selectInlineLinkCandidate("item-1", {
				scope: "work",
				id: "work-target",
				workId: "work-target",
				displayName: "Target",
				scopeLabel: "Work",
				shortId: "work-tar",
				canonicalMarkdown: "[Target](radiora://work/work-target)",
			});

			expect(controller.inlineLinkCompletion?.phase).toBe("type");
			expect(controller.inlineLinkCompletion?.selectedType).toBe("RELATED");
		});

		test("chooseInlineLinkType with asymmetric relation transitions to direction phase", async () => {
			const item = {
				id: "item-1",
				workId: "work-self",
				text: "@Target",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: "b-1" },
			};
			const { controller } = createController({
				snapshot: { items: [item], links: [], knots: [], stashItemIds: [] },
				relationTypeNames: () => ["PARENT" as LinkType, "RELATED" as LinkType],
				isSymmetricRelationType: (type) => type === "RELATED",
			});
			const textarea = mockTextarea("@Target", 7, 7);

			await controller.updateInlineLinkCompletion("item-1", textarea);
			controller.selectInlineLinkCandidate("item-1", {
				scope: "work",
				id: "work-target",
				workId: "work-target",
				displayName: "Target",
				scopeLabel: "Work",
				shortId: "work-tar",
				canonicalMarkdown: "[Target](radiora://work/work-target)",
			});

			controller.selectInlineLinkType("item-1", "PARENT" as LinkType);
			expect(controller.inlineLinkCompletion?.phase).toBe("direction");

			controller.setInlineLinkDirection("item-1", "reverse");
			expect(controller.inlineLinkCompletion?.direction).toBe("reverse");
		});

		test("createInlineLinkTarget quickCaptures new work and moves to type phase", async () => {
			const item = {
				id: "item-1",
				workId: "work-self",
				text: "@NewItem",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: "b-1" },
			};
			const { controller, api, ports } = createController({
				snapshot: { items: [item], links: [], knots: [], stashItemIds: [] },
			});
			const textarea = mockTextarea("@NewItem", 8, 8);

			await controller.updateInlineLinkCompletion("item-1", textarea);
			await controller.createInlineLinkTarget("item-1");

			expect(api.quickCapture).toHaveBeenCalledWith("NewItem");
			expect(ports.loadUnplacedWorks).toHaveBeenCalled();
			expect(controller.inlineLinkCompletion?.phase).toBe("type");
			expect(controller.inlineLinkCompletion?.selectedCandidate?.workId).toBe("work-created");
		});

		test("commitInlineLink creates link and replaces trigger in textarea", async () => {
			const item = {
				id: "item-1",
				workId: "work-self",
				text: "See @Target for info",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: "b-1" },
			};
			const textarea = mockTextarea("See @Target for info", 11, 11);
			const { controller, api, ports } = createController({
				snapshot: { items: [item], links: [], knots: [], stashItemIds: [] },
				findTextarea: () => textarea,
			});

			await controller.updateInlineLinkCompletion("item-1", textarea);
			controller.selectInlineLinkCandidate("item-1", {
				scope: "work",
				id: "work-target",
				workId: "work-target",
				displayName: "Target",
				scopeLabel: "Work",
				shortId: "work-tar",
				canonicalMarkdown: "[Target](radiora://work/work-target)",
			});

			await controller.commitInlineLink("item-1");

			expect(api.createLink).toHaveBeenCalledWith({
				fromId: "work-self",
				toId: "work-target",
				type: "RELATED",
				origin: "human",
				status: "asserted",
			});
			expect(textarea.value).toBe("See  for info");
			expect(textarea.setRangeText).toHaveBeenCalledWith("", 4, 11, "end");
			expect(ports.reload).toHaveBeenCalledWith("item-1");
			expect(ports.requestFocus).toHaveBeenCalled();
			expect(controller.inlineLinkCompletion).toBeNull();
		});

		test("commitInlineLink rejects linking node to itself", async () => {
			const item = {
				id: "item-1",
				workId: "work-self",
				text: "@Self",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: "b-1" },
			};
			const textarea = mockTextarea("@Self", 5, 5);
			const { controller, ports } = createController({
				snapshot: { items: [item], links: [], knots: [], stashItemIds: [] },
				findTextarea: () => textarea,
			});

			await controller.updateInlineLinkCompletion("item-1", textarea);
			controller.selectInlineLinkCandidate("item-1", {
				scope: "work",
				id: "work-self",
				workId: "work-self",
				displayName: "Self",
				scopeLabel: "Work",
				shortId: "work-sel",
				canonicalMarkdown: "[Self](radiora://work/work-self)",
			});

			await controller.commitInlineLink("item-1");
			expect(ports.reportError).toHaveBeenCalledWith("同じNode自身にはLinkできません。");
		});

		test("handleInlineLinkOmniKeydown handles keyboard navigation and escape", async () => {
			const item = {
				id: "item-1",
				workId: "work-self",
				text: "@Target",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: "b-1" },
			};
			const { controller } = createController({
				snapshot: { items: [item], links: [], knots: [], stashItemIds: [] },
			});
			const textarea = mockTextarea("@Target", 7, 7);

			await controller.updateInlineLinkCompletion("item-1", textarea);

			// ArrowDown moves index
			const downEvent = mockKeyboardEvent({ key: "ArrowDown" });
			controller.handleInlineLinkOmniKeydown(downEvent, "item-1");
			expect(controller.inlineLinkCompletion?.activeIndex).toBe(1);

			// Escape cancels
			const escEvent = mockKeyboardEvent({ key: "Escape" });
			controller.handleInlineLinkOmniKeydown(escEvent, "item-1");
			expect(controller.inlineLinkCompletion).toBeNull();
		});
	});

	describe("internal references and backlinks", () => {
		test("applyInternalReferenceCompletion sets canonical markdown in textarea", async () => {
			const item = {
				id: "item-1",
				workId: "work-1",
				text: "[[Fi",
				parentId: null,
				orderKey: 0,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: "b-1" },
			};
			const textarea = mockTextarea("[[Fi", 4, 4);
			const { controller } = createController({
				snapshot: { items: [item], links: [], knots: [], stashItemIds: [] },
				findTextarea: () => textarea,
			});

			await controller.updateInternalReferenceCompletion("item-1", textarea);

			controller.applyInternalReferenceCompletion("item-1", {
				scope: "work",
				id: "work-1",
				workId: "work-1",
				displayName: "First",
				scopeLabel: "Work",
				shortId: "work-1",
				canonicalMarkdown: "[First](radiora://work/work-1)",
			});

			expect(textarea.setRangeText).toHaveBeenCalled();
			expect(textarea.dispatchEvent).toHaveBeenCalled();
		});

		test("openInternalReference navigates to resolved work", async () => {
			const resolution = {
				status: "resolved",
				reference: { scope: "work", id: "work-target", range: { start: 0, end: 10 } },
				navigationTarget: {
					kind: "occurrence",
					workId: "work-target",
					occurrenceId: "occ-target",
					ancestorOccurrenceIds: [],
					fellBack: false,
				},
			};
			const { controller, ports } = createController({
				api: {
					resolveInternalReferences: vi.fn().mockResolvedValue([resolution]),
				},
			});

			await controller.openInternalReference(
				"[Ref](radiora://work/work-target)",
				"work",
				"work-target",
			);

			expect(ports.openNavigationTarget).toHaveBeenCalledWith(resolution.navigationTarget);
			expect(controller.internalReferenceNotice).toBe("");
		});

		test("openInternalReference navigates to revision and opens comparison", async () => {
			const resolution = {
				status: "resolved",
				reference: { scope: "revision", id: "rev-1", range: { start: 0, end: 10 } },
				workId: "work-target",
				revision: { id: "rev-1" },
				navigationTarget: {
					kind: "occurrence",
					workId: "work-target",
					occurrenceId: "occ-target",
					ancestorOccurrenceIds: [],
					fellBack: false,
				},
			};
			const { controller, ports } = createController({
				api: {
					resolveInternalReferences: vi.fn().mockResolvedValue([resolution]),
				},
			});

			await controller.openInternalReference(
				"[Rev](radiora://revision/rev-1)",
				"revision",
				"rev-1",
			);

			expect(ports.openNavigationTarget).toHaveBeenCalledWith(resolution.navigationTarget);
			expect(ports.loadRevisions).toHaveBeenCalledWith("work-target");
			expect(ports.openRevisionComparison).toHaveBeenCalledWith("rev-1");
		});

		test("openEditorInternalReference parses radiora URL", async () => {
			const resolution = {
				status: "resolved",
				reference: { scope: "work", id: "w-url", range: { start: 0, end: 10 } },
				navigationTarget: {
					kind: "occurrence",
					workId: "w-url",
					occurrenceId: "occ-url",
					ancestorOccurrenceIds: [],
					fellBack: false,
				},
			};
			const { controller, ports } = createController({
				api: {
					resolveInternalReferences: vi.fn().mockResolvedValue([resolution]),
				},
			});

			await controller.openEditorInternalReference("radiora://work/w-url");
			expect(ports.openNavigationTarget).toHaveBeenCalledWith(resolution.navigationTarget);
		});

		test("loadInternalReferenceBacklinks loads backlinks and clearBacklinks clears them", async () => {
			const backlink = {
				source: { scope: "work" as const, workId: "w-source" },
				target: { scope: "work" as const, workId: "w-target" },
			};
			const { controller } = createController({
				api: {
					listInternalReferenceBacklinks: vi.fn().mockResolvedValue([backlink]),
				},
			});

			await controller.loadInternalReferenceBacklinks("w-target");
			expect(controller.internalReferenceBacklinks).toEqual([backlink]);

			controller.clearBacklinks();
			expect(controller.internalReferenceBacklinks).toEqual([]);
		});

		test("openInternalReferenceBacklink opens revision backlink", async () => {
			const resolution = {
				status: "resolved",
				reference: { scope: "revision", id: "rev-back", range: { start: 0, end: 10 } },
				navigationTarget: {
					kind: "occurrence",
					workId: "work-rev",
					occurrenceId: "occ-rev",
					ancestorOccurrenceIds: [],
					fellBack: false,
				},
			};
			const { controller, ports } = createController({
				api: {
					resolveInternalReferences: vi.fn().mockResolvedValue([resolution]),
				},
			});

			await controller.openInternalReferenceBacklink({
				source: { scope: "revision", workId: "work-rev", revisionId: "rev-back" },
				target: { scope: "work", workId: "work-target" },
			});

			expect(ports.openNavigationTarget).toHaveBeenCalledWith(resolution.navigationTarget);
		});

		test("openInternalReference handles unresolved states and errors", async () => {
			const { controller } = createController({
				api: {
					resolveInternalReferences: vi.fn()
						.mockResolvedValueOnce([]) // empty
						.mockResolvedValueOnce([{
							status: "missing",
							reason: "見つかりません",
							reference: { scope: "work", id: "w-1", range: { start: 0, end: 5 } },
						}])
						.mockResolvedValueOnce([{
							status: "resolved",
							reference: { scope: "revision", id: "rev-1", range: { start: 0, end: 5 } },
							revision: { id: "rev-1" },
							navigationTarget: { kind: "work", workId: "w-1", fellBack: true },
						}])
						.mockRejectedValueOnce(new Error("Network fail")),
				},
			});

			// Empty resolution
			await controller.openInternalReference("[Ref](radiora://work/w-1)", "work", "w-1");
			expect(controller.internalReferenceNotice).toBe("参照を解析できませんでした。");

			// Missing reason
			await controller.openInternalReference("[Ref](radiora://work/w-1)", "work", "w-1");
			expect(controller.internalReferenceNotice).toBe("見つかりません");

			// Revision with work navigationTarget
			await controller.openInternalReference(
				"[Ref](radiora://revision/rev-1)",
				"revision",
				"rev-1",
			);
			expect(controller.internalReferenceNotice).toContain(
				"所有Workに表示可能なOccurrenceがありません。",
			);

			// Error
			await controller.openInternalReference("[Ref](radiora://work/w-1)", "work", "w-1");
			expect(controller.internalReferenceNotice).toBe("Network fail");
		});

		test("loadInternalReferenceBacklinks catches and formats errors", async () => {
			const { controller } = createController({
				api: {
					listInternalReferenceBacklinks: vi.fn().mockRejectedValue(new Error("Backlink error")),
				},
			});

			await controller.loadInternalReferenceBacklinks("w-err");
			expect(controller.internalReferenceNotice).toBe("Backlink error");
		});

		test("workingCopySaveStatus exposes priority order and clearCompletions cancels completions", () => {
			const { controller } = createController();
			expect(controller.workingCopySaveStatuses).toEqual([]);
			expect(controller.workingCopySaveStatus).toBeUndefined();

			controller.clearCompletions();
			expect(controller.internalReferenceCompletion).toBeNull();
			expect(controller.inlineLinkCompletion).toBeNull();
		});

		test("referencesIn parses markdown internal references", () => {
			const { controller } = createController();
			const refs = controller.referencesIn("[Doc](radiora://work/doc-1)");
			expect(refs).toBeDefined();
		});
	});
});
