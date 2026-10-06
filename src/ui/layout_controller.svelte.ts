import {
	DEFAULT_UI_LAYOUT_PREFERENCE,
	clampInspectorWidth,
	loadUiLayoutPreference,
	saveUiLayoutPreference,
	type UiLayoutPreference,
	type UiLayoutPreferenceStorage,
} from "./ui_layout_preference.ts";

export type InspectorAsideMode = "overview" | "relation" | "history" | "query";

/** User preferences and temporary Inspector context have separate write authority. */
export class LayoutController {
	private saved = $state.raw<UiLayoutPreference>(DEFAULT_UI_LAYOUT_PREFERENCE);
	private liveInspectorCollapsed = $state(false);
	private liveInspectorWidth = $state(DEFAULT_UI_LAYOUT_PREFERENCE.inspectorWidth);
	private liveAsideMode = $state<InspectorAsideMode>("overview");
	private revision = 0;

	constructor(private readonly storage?: UiLayoutPreferenceStorage | null) {
		this.saved = loadUiLayoutPreference(storage);
		this.liveInspectorCollapsed = this.saved.inspectorCollapsed;
		this.liveInspectorWidth = this.saved.inspectorWidth;
	}

	get preference() { return this.saved; }
	get navCollapsed() { return this.saved.navCollapsed; }
	get inspectorCollapsed() { return this.liveInspectorCollapsed; }
	get inspectorWidth() { return this.liveInspectorWidth; }
	get asideMode() { return this.liveAsideMode; }
	get inspectorRevision() { return this.revision; }

	captureInspector() {
		return { mode: this.liveAsideMode, collapsed: this.liveInspectorCollapsed };
	}

	applyInspector(context: { mode: InspectorAsideMode; collapsed: boolean }): void {
		this.revision++;
		this.liveAsideMode = context.mode;
		this.liveInspectorCollapsed = context.collapsed;
	}

	openInspector(mode: InspectorAsideMode): void {
		this.applyInspector({ mode, collapsed: false });
	}

	setAsideMode(mode: InspectorAsideMode): void {
		this.revision++;
		this.liveAsideMode = mode;
	}

	toggleNavigation(): void {
		this.setNavigationCollapsed(!this.saved.navCollapsed);
	}

	setNavigationCollapsed(next: boolean): void {
		this.saved = { ...this.saved, navCollapsed: next };
		this.persist();
	}

	setInspectorCollapsed(next: boolean): void {
		this.revision++;
		this.liveInspectorCollapsed = next;
		this.saved = { ...this.saved, inspectorCollapsed: next };
		this.persist();
	}

	previewInspectorWidth(next: number): void {
		if (Number.isFinite(next)) this.liveInspectorWidth = clampInspectorWidth(next);
	}

	setInspectorWidth(next: number): void {
		if (!Number.isFinite(next)) return;
		this.previewInspectorWidth(next);
		this.saved = { ...this.saved, inspectorWidth: this.liveInspectorWidth };
		this.persist();
	}

	private persist(): void {
		saveUiLayoutPreference(this.saved, this.storage);
	}
}
