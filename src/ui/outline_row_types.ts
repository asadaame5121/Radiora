import type { LinkType, OutlineItem } from "../domain/models.ts";
import type { VisibleRow } from "./outline_view_model.ts";
import type { InlineLinkDirection } from "./editor_controller.svelte.ts";
import type { InternalReferenceCompletion as InternalReferenceCompletionType } from "../services/internal_reference_service.ts";
import type { RadioraInternalReferenceCandidate } from "../services/markdown_parser.ts";
import type {
	InlineSemanticLinkCandidate,
	InlineSemanticLinkDiagnostic,
} from "../services/inline_semantic_link.ts";
import type { SemanticLinkAnnotation } from "../services/semantic_link_annotations.ts";

export type InlineSemanticLinksProjection = {
	readonly candidates: readonly InlineSemanticLinkCandidate[];
	readonly diagnostics: readonly InlineSemanticLinkDiagnostic[];
};

export type OutlineLinkSelectionDirection = "outgoing" | "incoming";

export type OutlineLinkSelectionViewState = {
	readonly active: boolean;
	readonly originWorkId: string | null;
	readonly originDisplayName: string;
	readonly selectedWorkIds: ReadonlySet<string>;
	readonly selectedWorkCount: number;
	readonly selectedType: LinkType;
	readonly direction: OutlineLinkSelectionDirection;
	readonly reason: string;
	readonly submitting: boolean;
	readonly error: string;
};

export type OutlineLinkSelectionHandlers = {
	setType: (type: LinkType) => void;
	setDirection: (direction: OutlineLinkSelectionDirection) => void;
	setReason: (reason: string) => void;
	submit: () => void | Promise<void>;
	cancel: () => void;
};

export type OutlineRowHandlers = {
	openOccurrenceContextMenu: (id: string, mode: "outline", event: MouseEvent) => void;
	handleOccurrenceContextMenuKeydown: (id: string, mode: "outline", event: KeyboardEvent) => void;
	deselectFromBlank: (event: MouseEvent) => void;
	dropOn: (item: OutlineItem) => void;
	toggle: (row: VisibleRow) => void;
	selectOccurrence: (id: string) => void;
	toggleLinkSelection: (workId: string) => void;
	hoistOccurrence: (id: string) => void;
	updateLocalText: (id: string, textarea: HTMLTextAreaElement) => void;
	updateEditorSelection: (id: string, textarea: HTMLTextAreaElement) => void;
	handleKeydown: (
		event: KeyboardEvent,
		row: VisibleRow,
		textarea: HTMLTextAreaElement,
		compositionGuard?: boolean,
	) => void;
	openEditorInternalReference: (destination: string) => void | Promise<void>;
	applyInternalReferenceCompletion: (
		id: string,
		candidate: InternalReferenceCompletionType,
	) => void;
	updateInlineLinkSearch: (id: string, query: string) => void;
	handleInlineLinkOmniKeydown: (event: KeyboardEvent, id: string) => void;
	selectInlineLinkCandidate: (id: string, candidate: InternalReferenceCompletionType) => void;
	createInlineLinkTarget: (id: string) => void;
	selectInlineLinkType: (id: string, type: LinkType) => void;
	setInlineLinkDirection: (id: string, direction: InlineLinkDirection) => void;
	commitInlineLink: (id: string) => void;
	openInternalReference: (
		text: string,
		scope: "work" | "revision",
		id: string,
		start?: number,
	) => void;
	inspectInlineSemanticLink: (candidate: InlineSemanticLinkCandidate) => void;
};

export type OutlineHelpers = {
	inlineSemanticLinksFor: (text: string) => InlineSemanticLinksProjection;
	semanticLinkAnnotationsFor: (id: string) => readonly SemanticLinkAnnotation[];
	bodyFor: (item: OutlineItem) => string;
	titleFor: (item: OutlineItem) => string;
	referencesIn: (text: string) => readonly RadioraInternalReferenceCandidate[];
	annotationDirection: (annotation: SemanticLinkAnnotation) => string;
};
