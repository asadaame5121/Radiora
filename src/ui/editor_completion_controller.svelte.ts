import type { LinkType } from "../domain/models.ts";
import { findInternalReferenceTrigger } from "../services/internal_reference.ts";
import { findInlineLinkTrigger, replaceInlineLinkTrigger } from "../services/inline_link.ts";
import type { InternalReferenceCompletion } from "../services/internal_reference_service.ts";
import {
	defaultRelationType,
	filterInlineLinkCandidates,
	inlineLinkCandidateCount,
	inlineLinkCandidateFromCreated,
	isSameInlineLinkTrigger,
	isSymmetricType,
	relationTypeNames,
} from "./inline_link_completion.ts";
import type { EditorCompletionPorts } from "./editor_completion_ports.ts";

const REFERENCE_LIMIT = 12, LINK_LIMIT = 16;

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

export function createEditorCompletionController(ports: EditorCompletionPorts) {
	let internalReferenceCompletion = $state<InternalReferenceCompletionState | null>(null);
	let inlineLinkCompletion = $state<InlineLinkCompletionState | null>(null);
	let internalReferenceCompletionRequest = 0;
	let inlineLinkCompletionRequest = 0;

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

	async function searchInlineLinkCandidates(itemId: string, query: string) {
		const sourceWorkId = ports.getSnapshot().items.find((item) => item.id === itemId)?.workId;
		return filterInlineLinkCandidates(
			await ports.api.listInternalReferenceCompletions(query, LINK_LIMIT),
			sourceWorkId,
		);
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
		const selectedId = ports.getSelectedId();
		try {
			const candidates = await ports.api.listInternalReferenceCompletions(
				trigger.query,
				REFERENCE_LIMIT,
			);
			if (request !== internalReferenceCompletionRequest || ports.getSelectedId() !== selectedId) {
				return;
			}
			internalReferenceCompletion = { itemId, range: trigger.range, candidates, activeIndex: 0 };
		} catch (cause) {
			if (request === internalReferenceCompletionRequest && ports.getSelectedId() === selectedId) {
				ports.reportError(cause);
			}
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
		if (isSameInlineLinkTrigger(inlineLinkCompletion, itemId, trigger)) return;
		const request = ++inlineLinkCompletionRequest;
		const selectedId = ports.getSelectedId();
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
			const candidates = await searchInlineLinkCandidates(itemId, trigger.query);
			if (request !== inlineLinkCompletionRequest || ports.getSelectedId() !== selectedId) return;
			const current = inlineLinkCompletion;
			if (!current || current.itemId !== itemId || current.phase !== "candidate") return;
			inlineLinkCompletion = { ...current, candidates, searching: false };
		} catch (cause) {
			if (request === inlineLinkCompletionRequest && ports.getSelectedId() === selectedId) {
				ports.reportError(cause);
			}
		}
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
		const selectedId = ports.getSelectedId();
		inlineLinkCompletion = { ...state, query, candidates: [], activeIndex: 0, searching: true };
		try {
			const candidates = await searchInlineLinkCandidates(itemId, query);
			if (request !== inlineLinkCompletionRequest || ports.getSelectedId() !== selectedId) return;
			const current = inlineLinkCompletion;
			if (!current || current.itemId !== itemId || current.phase !== "candidate") return;
			inlineLinkCompletion = { ...current, query, candidates, activeIndex: 0, searching: false };
		} catch (cause) {
			if (
				request === inlineLinkCompletionRequest && ports.getSelectedId() === selectedId &&
				inlineLinkCompletion
			) {
				inlineLinkCompletion = { ...inlineLinkCompletion, searching: false };
				ports.reportError(cause);
			}
		}
	}

	async function createInlineLinkTarget(itemId: string): Promise<void> {
		const state = inlineLinkCompletion;
		const query = state?.query.trim() ?? "";
		if (
			!state || state.itemId !== itemId || state.phase !== "candidate" || !query || state.creating
		) return;
		const request = ++inlineLinkCompletionRequest;
		const selectedId = ports.getSelectedId();
		inlineLinkCompletion = { ...state, creating: true };
		try {
			const created = await ports.api.quickCapture(query);
			if (
				request !== inlineLinkCompletionRequest || ports.getSelectedId() !== selectedId ||
				!inlineLinkCompletion
			) return;
			inlineLinkCompletion = {
				...inlineLinkCompletion,
				phase: "type",
				selectedCandidate: inlineLinkCandidateFromCreated(created, ports.vocabulary.work),
				selectedType: defaultRelationType(ports.relationTypeNames),
				direction: "forward",
				searching: false,
				creating: false,
			};
			await ports.loadUnplacedWorks();
		} catch (cause) {
			if (
				request === inlineLinkCompletionRequest && ports.getSelectedId() === selectedId &&
				inlineLinkCompletion
			) {
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
			selectedType: defaultRelationType(ports.relationTypeNames),
			direction: "forward",
		};
	}

	function chooseInlineLinkType(itemId: string): void {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || !state.selectedCandidate || !state.selectedType) {
			return;
		}
		if (isSymmetricType(state.selectedType, ports.isSymmetricRelationType)) {
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
			const names = relationTypeNames(ports.relationTypeNames);
			const current = state.selectedType
				? Math.max(0, names.findIndex((type) => type === state.selectedType))
				: 0;
			state.selectedType = names[
				(current + (event.key === "ArrowDown" ? 1 : -1) + names.length) % names.length
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
		const request = ++inlineLinkCompletionRequest;
		const selectedId = ports.getSelectedId();
		try {
			await ports.api.createLink({ fromId, toId, type, origin: "human", status: "asserted" });
			if (request !== inlineLinkCompletionRequest || ports.getSelectedId() !== selectedId) return;
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
			if (request === inlineLinkCompletionRequest && ports.getSelectedId() === selectedId) {
				ports.reportError(cause);
			}
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
		const trigger = findInternalReferenceTrigger(textarea.value, state.range.end, state.range.end);
		if (
			!trigger || trigger.range.start !== state.range.start || trigger.range.end !== state.range.end
		) {
			cancelInternalReferenceCompletion();
			return;
		}
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

	return {
		get internalReferenceCompletion() {
			return internalReferenceCompletion;
		},
		get inlineLinkCompletion() {
			return inlineLinkCompletion;
		},
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
	};
}
