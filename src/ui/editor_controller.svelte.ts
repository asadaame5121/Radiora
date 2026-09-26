import type { LinkType, OutlineSnapshot } from "../domain/models.ts";
import type { RadioraBindings } from "../shared/bindings.ts";
import { ResumePositionAutosaveCoordinator } from "../services/resume_position_autosave.ts";
import {
	WorkingCopyAutosaveCoordinator,
	type WorkingCopySaveStatus,
} from "../services/working_copy_autosave.ts";
import type { InternalReferenceBacklink } from "../services/internal_reference_service.ts";
import { parseMarkdownCandidates } from "../services/markdown_parser.ts";
import type { NavigationTarget } from "../domain/models.ts";
import { createEditorCompletionController } from "./editor_completion_controller.svelte.ts";
import { applyBranchWorkingCopyText } from "./editor_working_copy.ts";

type EditorApi = Pick<
	RadioraBindings,
	| "updateItemText"
	| "saveResumePosition"
	| "listInternalReferenceCompletions"
	| "quickCapture"
	| "createLink"
	| "resolveInternalReferences"
	| "listInternalReferenceBacklinks"
>;

export type EditorControllerPorts = {
	api: EditorApi;
	getSnapshot(): OutlineSnapshot;
	getSelectedId(): string | null;
	reload(focusId?: string): Promise<unknown>;
	loadUnplacedWorks(): Promise<void>;
	openNavigationTarget(target: NavigationTarget): Promise<void>;
	loadRevisions(workId: string): Promise<void>;
	openRevisionComparison(revisionId: string): void;
	requestFocus(itemId: string, caretOffset?: number): void;
	findTextarea(itemId: string): HTMLTextAreaElement | null;
	reportError(cause: unknown): void;
	errorMessage(cause: unknown): string;
	persistSnapshotCache(): void;
	relationTypeNames?: () => readonly LinkType[];
	isSymmetricRelationType?: (type: LinkType) => boolean;
	vocabulary: {
		work: string;
		occurrence: string;
		revision: string;
		semanticLink: string;
	};
};

export function createEditorController(ports: EditorControllerPorts) {
	let workingCopySaveStatuses = $state<WorkingCopySaveStatus[]>([]);
	let internalReferenceBacklinks = $state<InternalReferenceBacklink[]>([]);
	let internalReferenceNotice = $state("");

	const autosave = new WorkingCopyAutosaveCoordinator({
		save: (occurrenceId, text) => ports.api.updateItemText(occurrenceId, text),
		onStatusChange: (statuses) => {
			workingCopySaveStatuses = statuses;
			if (statuses.some((status) => status.phase === "saved") && !autosave.hasUnsavedChanges()) {
				ports.persistSnapshotCache();
			}
		},
	});
	const completion = createEditorCompletionController(ports);
	const resumeAutosave = new ResumePositionAutosaveCoordinator({
		save: async (occurrenceId, caretOffset) => {
			await ports.api.saveResumePosition(occurrenceId, caretOffset);
		},
		onError: ports.reportError,
	});

	function updateLocalText(id: string, textarea: HTMLTextAreaElement): void {
		const text = textarea.value;
		const snapshot = ports.getSnapshot();
		const item = snapshot.items.find((candidate) => candidate.id === id);
		if (!item || item.revisionSelector.mode !== "branch") return;
		const updatedAt = new Date().toISOString();
		applyBranchWorkingCopyText(snapshot.items, item, text, updatedAt);
		autosave.queue(item.workId, item.revisionSelector.branchId, id, text);
		resumeAutosave.queue(id, textarea.selectionStart);
		void completion.updateInternalReferenceCompletion(id, textarea);
		void completion.updateInlineLinkCompletion(id, textarea);
	}

	function updateEditorSelection(id: string, textarea: HTMLTextAreaElement): void {
		if (ports.getSelectedId() === id) resumeAutosave.queue(id, textarea.selectionStart);
		void completion.updateInlineLinkCompletion(id, textarea);
	}

	async function openInternalReference(
		markdown: string,
		scope: "work" | "revision",
		id: string,
		start?: number,
	): Promise<void> {
		try {
			const resolutions = await ports.api.resolveInternalReferences(markdown);
			const resolution = resolutions.find((candidate) =>
				candidate.reference.scope === scope && candidate.reference.id === id &&
				(start === undefined || candidate.reference.range.start === start)
			);
			if (!resolution) {
				internalReferenceNotice = "参照を解析できませんでした。";
				return;
			}
			if (resolution.status !== "resolved" || !resolution.navigationTarget) {
				internalReferenceNotice = resolution.reason ?? "参照先へ移動できません。";
				return;
			}
			internalReferenceNotice = "";
			if (resolution.reference.scope === "revision" && resolution.revision) {
				if (resolution.navigationTarget.kind === "work") {
					internalReferenceNotice =
						`固定${ports.vocabulary.revision}は存在しますが、所有${ports.vocabulary.work}に表示可能な${ports.vocabulary.occurrence}がありません。`;
					return;
				}
				await ports.openNavigationTarget(resolution.navigationTarget);
				await ports.loadRevisions(resolution.workId!);
				ports.openRevisionComparison(resolution.revision.id);
				return;
			}
			await ports.openNavigationTarget(resolution.navigationTarget);
		} catch (cause) {
			internalReferenceNotice = ports.errorMessage(cause);
		}
	}

	async function openEditorInternalReference(destination: string): Promise<void> {
		const match = /^radiora:\/\/(work|revision)\/([^/?#\s]+)(?:#[^\s]*)?$/u.exec(destination);
		if (!match) return;
		await openInternalReference(`[ref](${destination})`, match[1] as "work" | "revision", match[2]);
	}

	async function loadInternalReferenceBacklinks(workId: string): Promise<void> {
		try {
			internalReferenceBacklinks =
				(await ports.api.listInternalReferenceBacklinks("work", workId)) ?? [];
		} catch (cause) {
			internalReferenceNotice = ports.errorMessage(cause);
		}
	}

	async function openInternalReferenceBacklink(backlink: InternalReferenceBacklink): Promise<void> {
		const source = backlink.source;
		const markdown = source.scope === "work"
			? `[source](radiora://work/${source.workId})`
			: `[source](radiora://revision/${source.revisionId})`;
		await openInternalReference(
			markdown,
			source.scope,
			source.scope === "work" ? source.workId : source.revisionId,
		);
	}

	return {
		get workingCopySaveStatuses() {
			return workingCopySaveStatuses;
		},
		get workingCopySaveStatus() {
			return workingCopySaveStatuses.find((status) => status.phase === "failed") ??
				workingCopySaveStatuses.find((status) => status.phase === "saving") ??
				workingCopySaveStatuses.find((status) => status.phase === "unsaved") ??
				workingCopySaveStatuses[0];
		},
		get internalReferenceCompletion() {
			return completion.internalReferenceCompletion;
		},
		get inlineLinkCompletion() {
			return completion.inlineLinkCompletion;
		},
		get internalReferenceBacklinks() {
			return internalReferenceBacklinks;
		},
		get internalReferenceNotice() {
			return internalReferenceNotice;
		},
		clearBacklinks: () => internalReferenceBacklinks = [],
		hasUnsavedChanges: () => autosave.hasUnsavedChanges(),
		drafts: () => autosave.drafts(),
		flushAutosave: (workId?: string) => autosave.flush(workId),
		flushResume: () => resumeAutosave.flush(),
		retryAutosave: () => autosave.retry(),
		updateLocalText,
		updateEditorSelection,
		updateInternalReferenceCompletion: completion.updateInternalReferenceCompletion,
		updateInlineLinkCompletion: completion.updateInlineLinkCompletion,
		updateInlineLinkSearch: completion.updateInlineLinkSearch,
		inlineLinkCandidateCount: completion.inlineLinkCandidateCount,
		moveInternalReferenceActiveIndex: completion.moveInternalReferenceActiveIndex,
		moveInlineLinkActiveIndex: completion.moveInlineLinkActiveIndex,
		cancelInternalReferenceCompletion: completion.cancelInternalReferenceCompletion,
		cancelInlineLinkCompletion: completion.cancelInlineLinkCompletion,
		clearCompletions: completion.clearCompletions,
		selectInlineLinkActiveEntry: completion.selectInlineLinkActiveEntry,
		handleInlineLinkOmniKeydown: completion.handleInlineLinkOmniKeydown,
		createInlineLinkTarget: completion.createInlineLinkTarget,
		selectInlineLinkCandidate: completion.selectInlineLinkCandidate,
		chooseInlineLinkType: completion.chooseInlineLinkType,
		selectInlineLinkType: completion.selectInlineLinkType,
		setInlineLinkDirection: completion.setInlineLinkDirection,
		commitInlineLink: completion.commitInlineLink,
		applyInternalReferenceCompletion: completion.applyInternalReferenceCompletion,
		referencesIn: (text: string) => parseMarkdownCandidates(text).internalReferences,
		openInternalReference,
		openEditorInternalReference,
		loadInternalReferenceBacklinks,
		openInternalReferenceBacklink,
	};
}
