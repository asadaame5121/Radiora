import type { LinkType, OutlineItem } from "../domain/models.ts";
import type { VisibleRow } from "./outline_view_model.ts";
import type { InlineLinkDirection } from "./editor_completion_controller.svelte.ts";
import type { InternalReferenceCompletion as InternalReferenceCompletionType } from "../services/internal_reference_service.ts";
import type { RadioraInternalReferenceCandidate } from "../services/markdown_parser.ts";
import type {
	InlineSemanticLinkCandidate,
	InlineSemanticLinkDiagnostic,
} from "../services/inline_semantic_link.ts";
import type { SemanticLinkAnnotation } from "../services/semantic_link_annotations.ts";

import type { OutlineRowSource } from "./outline_row_source.ts";

export type { OutlineRowSource };

export type InlineSemanticLinksProjection = {
	readonly candidates: readonly InlineSemanticLinkCandidate[];
	readonly diagnostics: readonly InlineSemanticLinkDiagnostic[];
};

/** Inline body editing. Without it, rows show their text read-only. */
export type OutlineRowEditingHandlers<T extends OutlineRowSource> = {
	updateLocalText: (id: string, textarea: HTMLTextAreaElement) => void;
	updateEditorSelection: (id: string, textarea: HTMLTextAreaElement) => void;
	discardUntouchedEmptyItem: (id: string) => void;
	handleKeydown: (
		event: KeyboardEvent,
		row: VisibleRow<T>,
		textarea: HTMLTextAreaElement,
		compositionGuard?: boolean,
	) => void;
	openEditorInternalReference: (destination: string) => void | Promise<void>;
};

/** Drag-and-drop placement. Without it, rows are not draggable. */
export type OutlineRowDragHandlers<T extends OutlineRowSource> = {
	dropOn: (item: T) => void;
};

export type OutlineRowHoistHandlers = {
	hoistOccurrence: (id: string) => void;
};

export type OutlineRowContextMenuHandlers = {
	openOccurrenceContextMenu: (id: string, mode: "outline", event: MouseEvent) => void;
	handleOccurrenceContextMenuKeydown: (id: string, mode: "outline", event: KeyboardEvent) => void;
};

export type OutlineRowCompletionHandlers = {
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
};

export type OutlineRowReferenceHandlers = {
	openInternalReference: (
		text: string,
		scope: "work" | "revision",
		id: string,
		start?: number,
	) => void;
	inspectInlineSemanticLink: (candidate: InlineSemanticLinkCandidate) => void;
};

/**
 * Row callbacks. Selection and disclosure are always required; each optional group enables one
 * feature, so a caller wires only the features it owns instead of passing no-op callbacks.
 */
export type OutlineRowHandlers<T extends OutlineRowSource = OutlineItem> = {
	deselectFromBlank: (event: MouseEvent) => void;
	toggle: (row: VisibleRow<T>) => void;
	selectOccurrence: (id: string) => void;
	readonly editing?: OutlineRowEditingHandlers<T>;
	readonly drag?: OutlineRowDragHandlers<T>;
	readonly hoist?: OutlineRowHoistHandlers;
	readonly contextMenu?: OutlineRowContextMenuHandlers;
	readonly completion?: OutlineRowCompletionHandlers;
	readonly references?: OutlineRowReferenceHandlers;
};

/** Body/link annotations shown under a row. */
export type OutlineRowAnnotationHelpers = {
	inlineSemanticLinksFor: (text: string) => InlineSemanticLinksProjection;
	semanticLinkAnnotationsFor: (id: string) => readonly SemanticLinkAnnotation[];
	referencesIn: (text: string) => readonly RadioraInternalReferenceCandidate[];
	annotationDirection: (annotation: SemanticLinkAnnotation) => string;
};

export type OutlineHelpers<T extends OutlineRowSource = OutlineItem> = {
	bodyFor: (item: T) => string;
	titleFor: (item: T) => string;
	readonly annotations?: OutlineRowAnnotationHelpers;
};
