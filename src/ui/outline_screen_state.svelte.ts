import type { OutlineSnapshot } from "../domain/models.ts";
import {
	ancestorBreadcrumb,
	browseToOutlineOccurrence,
	type BrowsingNavigationState,
	currentBrowsingLocation,
	reconcileBrowsingState,
	setBrowsingHoist,
} from "../services/browsing_navigation_state.ts";
import type { OutlineFilter } from "../services/outline_filter.ts";
import type { InspectorAsideMode } from "./InspectorView.svelte";
import type { EditorPosition } from "./editor_return_controller.svelte.ts";
import type { ScreenDestination } from "./screen_navigation_destination.ts";

export interface OutlineViewport {
	editorPosition?: EditorPosition;
	panelScrollTop: number;
	panelScrollLeft: number;
	restoreScroll?: boolean;
	focus: "editor" | "rows" | "first-item" | "long-form";
}

export interface OutlineScreenPorts {
	captureBrowsing(): BrowsingNavigationState;
	commitBrowsing(state: BrowsingNavigationState): void;
	filter(): OutlineFilter;
	setFilter(filter: OutlineFilter): void;
	expanded(): readonly string[];
	setExpanded(ids: string[]): void;
	inspector(): { mode: InspectorAsideMode; collapsed: boolean };
	setInspector(context: { mode: InspectorAsideMode; collapsed: boolean }): void;
	longForm(): boolean;
	setLongForm(active: boolean, itemId: string | null): void;
	capturePosition(): OutlineViewport;
	restorePosition(position: OutlineViewport, current: () => boolean): Promise<void>;
}

export interface OutlineScreenContext {
	browsing: BrowsingNavigationState;
	filter: OutlineFilter;
	expandedIds: string[];
	inspector: ReturnType<OutlineScreenPorts["inspector"]>;
	longForm: boolean;
	viewport: OutlineViewport;
}

/** Outline owns its suspended workspace independently of every other screen's selection. */
export class OutlineScreenState {
	private suspended: OutlineScreenContext | null = null;
	constructor(private readonly ports: OutlineScreenPorts) {}

	capture(): OutlineScreenContext {
		return $state.snapshot({
			browsing: this.ports.captureBrowsing(),
			filter: this.ports.filter(),
			expandedIds: [...this.ports.expanded()],
			inspector: this.ports.inspector(),
			longForm: this.ports.longForm(),
			viewport: this.ports.capturePosition(),
		});
	}

	remember(context: OutlineScreenContext): void {
		this.suspended = context;
	}

	prepare(
		destination: ScreenDestination,
		snapshot: OutlineSnapshot,
		departure: OutlineScreenContext | null,
	): OutlineScreenContext {
		const saved = departure ?? this.suspended ?? this.capture();
		const browsing = prepareBrowsing(saved.browsing, destination, snapshot);
		const explicit = destination.occurrenceId !== undefined;
		const id = currentBrowsingLocation(browsing).selectedOccurrenceId;
		const longForm = destination.longForm ?? (explicit ? false : saved.longForm);
		const viewport = prepareViewport(saved, destination, browsing, longForm);
		return {
			...saved,
			browsing,
			longForm,
			viewport,
			expandedIds: [
				...new Set([
					...(destination.expandedIds ?? saved.expandedIds),
					...ancestorBreadcrumb(snapshot, id).map((item) => item.id),
				]),
			].filter((key) => snapshot.items.some((item) => item.id === key)),
			inspector: destination.query ? { mode: "query", collapsed: false } : saved.inspector,
		};
	}

	apply(context: OutlineScreenContext): void {
		this.ports.commitBrowsing(context.browsing);
		this.ports.setFilter(context.filter);
		this.ports.setExpanded(context.expandedIds);
		this.ports.setInspector(context.inspector);
		this.ports.setLongForm(
			context.longForm,
			currentBrowsingLocation(context.browsing).selectedOccurrenceId,
		);
	}

	restoreViewport(context: OutlineScreenContext, current: () => boolean): Promise<void> {
		return this.ports.restorePosition(context.viewport, current);
	}
}

function prepareBrowsing(
	saved: BrowsingNavigationState,
	destination: ScreenDestination,
	snapshot: OutlineSnapshot,
): BrowsingNavigationState {
	let browsing = reconcileBrowsingState(saved, snapshot);
	if (destination.hoistId !== undefined) browsing = setBrowsingHoist(browsing, destination.hoistId);
	if (destination.occurrenceId === undefined) return browsing;
	if (
		destination.occurrenceId && !snapshot.items.some((item) => item.id === destination.occurrenceId)
	) throw new Error("移動先の項目が見つかりません。");
	return browseToOutlineOccurrence(browsing, snapshot, destination.occurrenceId);
}

function destinationFocus(longForm: boolean, id: string | null): OutlineViewport["focus"] {
	if (longForm) return "long-form";
	return id ? "editor" : "rows";
}

function explicitViewport(
	destination: ScreenDestination,
	browsing: BrowsingNavigationState,
	longForm: boolean,
): OutlineViewport {
	const { selectedOccurrenceId: id, hoistOccurrenceId: hoistId } = currentBrowsingLocation(
		browsing,
	);
	return {
		focus: destinationFocus(longForm, id),
		panelScrollTop: destination.editorPosition?.panelScrollTop ?? 0,
		panelScrollLeft: 0,
		restoreScroll: Boolean(destination.editorPosition),
		editorPosition: destination.editorPosition ??
			(id
				? {
					itemId: id,
					hoistId,
					start: destination.caretOffset ?? 0,
					end: destination.caretOffset ?? 0,
					scrollTop: 0,
					scrollLeft: 0,
					panelScrollTop: 0,
				}
				: undefined),
	};
}

function prepareViewport(
	saved: OutlineScreenContext,
	destination: ScreenDestination,
	browsing: BrowsingNavigationState,
	longForm: boolean,
): OutlineViewport {
	const id = currentBrowsingLocation(browsing).selectedOccurrenceId;
	let viewport = saved.viewport;
	if (destination.longForm !== undefined && longForm !== saved.longForm) {
		viewport = { ...viewport, focus: destinationFocus(longForm, id) };
	}
	if (destination.occurrenceId !== undefined || destination.editorPosition) {
		viewport = explicitViewport(destination, browsing, longForm);
	}
	if (viewport.editorPosition && viewport.editorPosition.itemId !== id) {
		viewport = { ...viewport, editorPosition: undefined, focus: id ? "editor" : "rows" };
	}
	return viewport;
}
