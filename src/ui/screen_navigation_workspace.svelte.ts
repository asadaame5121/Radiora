import { tick } from "svelte";
import {
	type BrowsingNavigationState,
	currentBrowsingLocation,
} from "../services/browsing_navigation_state.ts";
import type { OutlineFilter } from "../services/outline_filter.ts";
import type { InspectorAsideMode } from "./InspectorView.svelte";
import type { ViewMode } from "./app_view_mode.ts";
import type { ComparisonNavigationContext } from "./comparison_controller.svelte.ts";
import { captureEditorPosition, focusOutlineEditor } from "./editor_return_controller.svelte.ts";
import { ScreenNavigationController } from "./screen_navigation_controller.svelte.ts";

interface InspectorContext {
	mode: InspectorAsideMode;
	collapsed: boolean;
}

export interface ScreenNavigationWorkspacePorts {
	browsing: {
		captureBrowsing(): BrowsingNavigationState;
		restore(state: BrowsingNavigationState): boolean;
	};
	selection: { current(): string | null; hasItem(id: string): boolean };
	outline: {
		filter(): OutlineFilter;
		setFilter(filter: OutlineFilter): void;
		expanded(): readonly string[];
		setExpanded(ids: string[]): void;
	};
	inspector: { capture(): InspectorContext; restore(context: InspectorContext): void };
	comparison: {
		captureNavigationContext(): ComparisonNavigationContext;
		restoreNavigationContext(context: ComparisonNavigationContext): void;
	};
	editor: { save(): Promise<boolean>; flush(): Promise<void>; longFormActive(): boolean };
}

/** Coordinates screen context through feature ports; each feature retains its own invariants. */
export class ScreenNavigationWorkspace {
	private readonly navigation: ScreenNavigationController<
		ReturnType<ScreenNavigationWorkspace["capture"]>
	>;

	constructor(private readonly ports: ScreenNavigationWorkspacePorts) {
		this.navigation = new ScreenNavigationController({
			capture: () => this.capture(),
			restore: (context) => this.restore(context),
			afterRestore: (context, view) => this.focus(context, view),
		});
	}

	get view(): ViewMode {
		return this.navigation.view;
	}
	get canGoBack(): boolean {
		return this.navigation.canGoBack;
	}
	open(view: ViewMode): void {
		this.navigation.open(view);
	}
	goBack = (): Promise<void> => this.navigation.goBack();

	openInspectorTool(mode: "query", dedicatedView: boolean): void {
		const current = this.ports.inspector.capture();
		if (current.mode === mode && !dedicatedView && !current.collapsed) return;
		if (dedicatedView) this.open("outline");
		else this.navigation.remember();
		this.ports.inspector.restore({ mode, collapsed: false });
	}

	private capture() {
		const browsing = this.ports.browsing.captureBrowsing();
		const selectedId = this.ports.selection.current();
		return {
			browsing,
			expandedIds: [...this.ports.outline.expanded()],
			filter: $state.snapshot(this.ports.outline.filter()),
			inspector: { ...this.ports.inspector.capture() },
			comparison: this.ports.comparison.captureNavigationContext(),
			editorPosition: selectedId && this.view === "outline" && !this.ports.editor.longFormActive()
				? captureEditorPosition(selectedId, currentBrowsingLocation(browsing).hoistOccurrenceId)
				: undefined,
		};
	}

	private async restore(
		context: ReturnType<ScreenNavigationWorkspace["capture"]>,
	): Promise<boolean> {
		if (!await this.ports.editor.save()) return false;
		await this.ports.editor.flush();
		if (!this.ports.browsing.restore(context.browsing)) return false;
		this.ports.outline.setExpanded(
			context.expandedIds.filter((id) => this.ports.selection.hasItem(id)),
		);
		this.ports.outline.setFilter(context.filter);
		this.ports.inspector.restore(context.inspector);
		this.ports.comparison.restoreNavigationContext(context.comparison);
		return true;
	}

	private async focus(
		context: ReturnType<ScreenNavigationWorkspace["capture"]>,
		view: ViewMode,
	): Promise<void> {
		await tick();
		if (view === "outline") {
			const id = this.ports.selection.current();
			await focusOutlineEditor(
				id,
				context.editorPosition?.itemId === id ? context.editorPosition : undefined,
			);
		} else if (view === "globalLineage") {
			(document.querySelector<SVGElement>(".tree-node.selected") ??
				document.querySelector<SVGElement>(".tree-node"))?.focus();
		}
	}
}
