import type { LinkType, OutlineSnapshot, UnplacedWork } from "../domain/models.ts";
import { isSymmetricLinkType, LINK_TYPES } from "../domain/models.ts";
import type { RadioraBindings } from "../shared/bindings.ts";
import { ResumePositionAutosaveCoordinator } from "../services/resume_position_autosave.ts";
import {
	WorkingCopyAutosaveCoordinator,
	type WorkingCopySaveStatus,
} from "../services/working_copy_autosave.ts";
import {
	canonicalInternalReferenceMarkdown,
	findInternalReferenceTrigger,
} from "../services/internal_reference.ts";
import { findInlineLinkTrigger, replaceInlineLinkTrigger } from "../services/inline_link.ts";
import type {
	InternalReferenceBacklink,
	InternalReferenceCompletion,
} from "../services/internal_reference_service.ts";
import { parseMarkdownCandidates } from "../services/markdown_parser.ts";
import type { NavigationTarget } from "../domain/models.ts";

export type InternalReferenceCompletionState = {
	itemId: string;
	range: { start: number; end: number };
	candidates: InternalReferenceCompletion[];
	activeIndex: number;
};

export type InlineLinkCompletionPhase = "candidate" | "type" | "direction";
export type InlineLinkDirection = "forward" | "reverse";
export type InlineLinkCompletionState = {
	itemId: string;
	query: string;
	range: { start: number; end: number };
	candidates: InternalReferenceCompletion[];
	activeIndex: number;
	phase: InlineLinkCompletionPhase;
	selectedCandidate?: InternalReferenceCompletion;
	selectedType?: LinkType;
	direction: InlineLinkDirection;
	searching: boolean;
	creating: boolean;
};

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
	vocabulary: {
		work: string;
		occurrence: string;
		revision: string;
		semanticLink: string;
	};
};

export function createEditorController(ports: EditorControllerPorts) {
	let workingCopySaveStatuses = $state<WorkingCopySaveStatus[]>([]);
	let internalReferenceCompletion = $state<InternalReferenceCompletionState | null>(null);
	let inlineLinkCompletion = $state<InlineLinkCompletionState | null>(null);
	let internalReferenceBacklinks = $state<InternalReferenceBacklink[]>([]);
	let internalReferenceNotice = $state("");
	let internalReferenceCompletionRequest = 0;
	let inlineLinkCompletionRequest = 0;

	const autosave = new WorkingCopyAutosaveCoordinator({
		save: (occurrenceId, text) => ports.api.updateItemText(occurrenceId, text),
		onStatusChange: (statuses) => {
			workingCopySaveStatuses = statuses;
			if (statuses.some((status) => status.phase === "saved") && !autosave.hasUnsavedChanges()) {
				ports.persistSnapshotCache();
			}
		},
	});
	const resumeAutosave = new ResumePositionAutosaveCoordinator({
		save: async (occurrenceId, caretOffset) => {
			await ports.api.saveResumePosition(occurrenceId, caretOffset);
		},
		onError: ports.reportError,
	});

	function cancelInternalReferenceCompletion(): void {
		internalReferenceCompletionRequest++;
		internalReferenceCompletion = null;
	}

	function cancelInlineLinkCompletion(): void {
		inlineLinkCompletionRequest++;
		inlineLinkCompletion = null;
	}

	function clearCompletions(): void {
		cancelInternalReferenceCompletion();
		cancelInlineLinkCompletion();
	}

	function updateLocalText(id: string, textarea: HTMLTextAreaElement): void {
		const text = textarea.value;
		const snapshot = ports.getSnapshot();
		const item = snapshot.items.find((candidate) => candidate.id === id);
		if (!item) return;
		const updatedAt = new Date().toISOString();
		for (const placement of snapshot.items) {
			if (placement.workId === item.workId) {
				placement.text = text;
				placement.updatedAt = updatedAt;
			}
		}
		autosave.queue(item.workId, id, text);
		resumeAutosave.queue(id, textarea.selectionStart);
		void updateInternalReferenceCompletion(id, textarea);
		void updateInlineLinkCompletion(id, textarea);
	}

	function updateEditorSelection(id: string, textarea: HTMLTextAreaElement): void {
		if (ports.getSelectedId() === id) resumeAutosave.queue(id, textarea.selectionStart);
		void updateInlineLinkCompletion(id, textarea);
	}

	async function updateInternalReferenceCompletion(
		itemId: string,
		textarea: HTMLTextAreaElement,
	): Promise<void> {
		const trigger = findInternalReferenceTrigger(
			textarea.value,
			textarea.selectionStart,
			textarea.selectionEnd,
		);
		if (!trigger) {
			cancelInternalReferenceCompletion();
			return;
		}
		const request = ++internalReferenceCompletionRequest;
		try {
			const candidates = await ports.api.listInternalReferenceCompletions(trigger.query, 12);
			if (request !== internalReferenceCompletionRequest) return;
			internalReferenceCompletion = { itemId, range: trigger.range, candidates, activeIndex: 0 };
		} catch (cause) {
			ports.reportError(cause);
		}
	}

	async function updateInlineLinkCompletion(
		itemId: string,
		textarea: HTMLTextAreaElement,
	): Promise<void> {
		const trigger = findInlineLinkTrigger(
			textarea.value,
			textarea.selectionStart,
			textarea.selectionEnd,
		);
		if (!trigger) {
			cancelInlineLinkCompletion();
			return;
		}
		const request = ++inlineLinkCompletionRequest;
		inlineLinkCompletion = {
			itemId,
			query: trigger.query,
			range: trigger.range,
			candidates: [],
			activeIndex: 0,
			phase: "candidate",
			direction: "forward",
			searching: true,
			creating: false,
		};
		try {
			const candidates = (await ports.api.listInternalReferenceCompletions(trigger.query, 16))
				.filter((candidate) => candidate.scope === "work")
				.filter((candidate) =>
					ports.getSnapshot().items.find((item) => item.id === itemId)?.workId !== candidate.workId
				);
			if (request !== inlineLinkCompletionRequest) return;
			const current = inlineLinkCompletion;
			if (!current || current.itemId !== itemId || current.phase !== "candidate") return;
			inlineLinkCompletion = { ...current, candidates, searching: false };
		} catch (cause) {
			if (request === inlineLinkCompletionRequest) ports.reportError(cause);
		}
	}

	function inlineLinkCandidateCount(state: InlineLinkCompletionState): number {
		return state.candidates.length + (state.query.trim() && !state.searching ? 1 : 0);
	}

	function moveInternalReferenceActiveIndex(direction: number): void {
		if (!internalReferenceCompletion?.candidates.length) return;
		const count = internalReferenceCompletion.candidates.length;
		internalReferenceCompletion.activeIndex =
			(internalReferenceCompletion.activeIndex + direction + count) % count;
	}

	function moveInlineLinkActiveIndex(direction: number): void {
		const state = inlineLinkCompletion;
		if (!state || state.phase !== "candidate") return;
		const count = inlineLinkCandidateCount(state);
		if (count) state.activeIndex = (state.activeIndex + direction + count) % count;
	}

	async function updateInlineLinkSearch(itemId: string, query: string): Promise<void> {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || state.phase !== "candidate") return;
		const request = ++inlineLinkCompletionRequest;
		inlineLinkCompletion = { ...state, query, candidates: [], activeIndex: 0, searching: true };
		try {
			const candidates = (await ports.api.listInternalReferenceCompletions(query, 16))
				.filter((candidate) => candidate.scope === "work")
				.filter((candidate) =>
					ports.getSnapshot().items.find((item) => item.id === itemId)?.workId !== candidate.workId
				);
			if (request !== inlineLinkCompletionRequest) return;
			const current = inlineLinkCompletion;
			if (!current || current.itemId !== itemId || current.phase !== "candidate") return;
			inlineLinkCompletion = { ...current, query, candidates, activeIndex: 0, searching: false };
		} catch (cause) {
			if (request === inlineLinkCompletionRequest && inlineLinkCompletion) {
				inlineLinkCompletion = { ...inlineLinkCompletion, searching: false };
				ports.reportError(cause);
			}
		}
	}

	function inlineLinkCandidateFromCreated(work: UnplacedWork): InternalReferenceCompletion {
		const displayName = work.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ??
			`(空の${ports.vocabulary.work})`;
		return {
			scope: "work",
			id: work.workId,
			workId: work.workId,
			displayName,
			scopeLabel: "未配置",
			shortId: work.workId.slice(0, 8),
			canonicalMarkdown: canonicalInternalReferenceMarkdown(displayName, "work", work.workId),
		};
	}

	async function createInlineLinkTarget(itemId: string): Promise<void> {
		const state = inlineLinkCompletion;
		const query = state?.query.trim() ?? "";
		if (
			!state || state.itemId !== itemId || state.phase !== "candidate" || !query || state.creating
		) return;
		const request = ++inlineLinkCompletionRequest;
		inlineLinkCompletion = { ...state, creating: true };
		try {
			const created = await ports.api.quickCapture(query);
			if (request !== inlineLinkCompletionRequest || !inlineLinkCompletion) return;
			inlineLinkCompletion = {
				...inlineLinkCompletion,
				phase: "type",
				selectedCandidate: inlineLinkCandidateFromCreated(created),
				selectedType: "RELATED",
				direction: "forward",
				searching: false,
				creating: false,
			};
			await ports.loadUnplacedWorks();
		} catch (cause) {
			if (request === inlineLinkCompletionRequest && inlineLinkCompletion) {
				inlineLinkCompletion = { ...inlineLinkCompletion, creating: false };
				ports.reportError(cause);
			}
		}
	}

	function selectInlineLinkCandidate(itemId: string, candidate: InternalReferenceCompletion): void {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || candidate.scope !== "work") return;
		inlineLinkCompletion = {
			...state,
			phase: "type",
			selectedCandidate: candidate,
			selectedType: "RELATED",
			direction: "forward",
		};
	}

	function chooseInlineLinkType(itemId: string): void {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || !state.selectedCandidate || !state.selectedType) {
			return;
		}
		if (isSymmetricLinkType(state.selectedType)) {
			void commitInlineLink(itemId);
			return;
		}
		inlineLinkCompletion = { ...state, phase: "direction" };
	}

	function selectInlineLinkType(itemId: string, type: LinkType): void {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || state.phase !== "type") return;
		state.selectedType = type;
		chooseInlineLinkType(itemId);
	}

	function setInlineLinkDirection(itemId: string, direction: InlineLinkDirection): void {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || state.phase !== "direction") return;
		state.direction = direction;
	}

	function selectInlineLinkActiveEntry(itemId: string): void {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || state.phase !== "candidate") return;
		const candidate = state.candidates[state.activeIndex];
		if (candidate) selectInlineLinkCandidate(itemId, candidate);
		else if (
			state.activeIndex === state.candidates.length && state.query.trim() && !state.searching
		) {
			void createInlineLinkTarget(itemId);
		}
	}

	function handleInlineLinkOmniKeydown(event: KeyboardEvent, itemId: string): void {
		if (event.isComposing) return;
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId) return;
		if (event.key === "Escape") {
			event.preventDefault();
			cancelInlineLinkCompletion();
			return;
		}
		if (state.phase === "candidate" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
			event.preventDefault();
			moveInlineLinkActiveIndex(event.key === "ArrowDown" ? 1 : -1);
			return;
		}
		if (
			state.phase === "candidate" && event.key === "Enter" && event.shiftKey &&
			state.query.trim() && !state.searching
		) {
			event.preventDefault();
			void createInlineLinkTarget(itemId);
			return;
		}
		if (state.phase === "type" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
			event.preventDefault();
			const current = state.selectedType ? LINK_TYPES.indexOf(state.selectedType) : 0;
			state.selectedType = LINK_TYPES[
				(current + (event.key === "ArrowDown" ? 1 : -1) + LINK_TYPES.length) % LINK_TYPES.length
			];
			return;
		}
		if (
			state.phase === "direction" &&
			(event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" ||
				event.key === "ArrowDown")
		) {
			event.preventDefault();
			state.direction = event.key === "ArrowLeft" || event.key === "ArrowUp"
				? "reverse"
				: "forward";
			return;
		}
		if (event.key !== "Enter" && event.key !== "Tab") return;
		event.preventDefault();
		if (state.phase === "candidate") selectInlineLinkActiveEntry(itemId);
		else if (state.phase === "type") chooseInlineLinkType(itemId);
		else void commitInlineLink(itemId);
	}

	async function commitInlineLink(itemId: string): Promise<void> {
		const state = inlineLinkCompletion;
		const item = ports.getSnapshot().items.find((entry) => entry.id === itemId);
		const candidate = state?.selectedCandidate;
		const type = state?.selectedType;
		if (
			!state || state.itemId !== itemId || !item || !candidate || !type ||
			candidate.scope !== "work"
		) return;
		if (item.workId === candidate.workId) {
			ports.reportError(`同じNode自身には${ports.vocabulary.semanticLink}できません。`);
			return;
		}
		const textarea = ports.findTextarea(itemId);
		const currentTrigger = textarea
			? findInlineLinkTrigger(textarea.value, state.range.end, state.range.end)
			: null;
		if (
			!textarea || !currentTrigger || currentTrigger.range.start !== state.range.start ||
			currentTrigger.range.end !== state.range.end
		) {
			ports.reportError(
				`入力が変更されたため、@${ports.vocabulary.semanticLink}を確定できませんでした。`,
			);
			cancelInlineLinkCompletion();
			return;
		}
		const fromId = state.direction === "forward" ? item.workId : candidate.workId;
		const toId = state.direction === "forward" ? candidate.workId : item.workId;
		try {
			await ports.api.createLink({ fromId, toId, type, origin: "human", status: "asserted" });
			const replacement = replaceInlineLinkTrigger(textarea.value, state.range, "");
			cancelInlineLinkCompletion();
			textarea.focus();
			textarea.setRangeText("", state.range.start, state.range.end, "end");
			textarea.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					inputType: "insertReplacementText",
					data: "",
				}),
			);
			await ports.reload(item.id);
			ports.requestFocus(item.id, replacement.caretOffset);
		} catch (cause) {
			ports.reportError(cause);
		}
	}

	function applyInternalReferenceCompletion(
		itemId: string,
		candidate: InternalReferenceCompletion,
	): void {
		const state = internalReferenceCompletion;
		const item = ports.getSnapshot().items.find((entry) => entry.id === itemId);
		if (!state || state.itemId !== itemId || !item) return;
		const textarea = ports.findTextarea(itemId);
		if (!textarea) return;
		cancelInternalReferenceCompletion();
		textarea.focus();
		textarea.setRangeText(candidate.canonicalMarkdown, state.range.start, state.range.end, "end");
		textarea.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertReplacementText",
				data: candidate.canonicalMarkdown,
			}),
		);
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
			internalReferenceBacklinks = await ports.api.listInternalReferenceBacklinks("work", workId);
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
			return internalReferenceCompletion;
		},
		get inlineLinkCompletion() {
			return inlineLinkCompletion;
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
		updateInternalReferenceCompletion,
		updateInlineLinkCompletion,
		updateInlineLinkSearch,
		inlineLinkCandidateCount,
		moveInternalReferenceActiveIndex,
		moveInlineLinkActiveIndex,
		cancelInternalReferenceCompletion,
		cancelInlineLinkCompletion,
		clearCompletions,
		selectInlineLinkActiveEntry,
		handleInlineLinkOmniKeydown,
		createInlineLinkTarget,
		selectInlineLinkCandidate,
		chooseInlineLinkType,
		selectInlineLinkType,
		setInlineLinkDirection,
		commitInlineLink,
		applyInternalReferenceCompletion,
		referencesIn: (text: string) => parseMarkdownCandidates(text).internalReferences,
		openInternalReference,
		openEditorInternalReference,
		loadInternalReferenceBacklinks,
		openInternalReferenceBacklink,
	};
}
