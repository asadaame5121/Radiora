import type { OutlineItem } from "../domain/models.ts";
import type { BrowsingOutlineProjection } from "../services/browsing_navigation_state.ts";
import type { ScreenNavigator } from "./screen_navigation_destination.ts";
import type { ViewMode } from "./app_view_mode.ts";
import { EditorReturnController, focusOutlineEditor } from "./editor_return_controller.svelte.ts";

export class KeyboardWorkspaceController {
	readonly editorReturn: EditorReturnController;
	get position() {
		return this.editorReturn.position;
	}
	constructor(
		private readonly ports: {
			selectedId(): string | null;
			hoistId(): string | null;
			view(): ViewMode;
			navigation: ScreenNavigator;
			longFormActive(): boolean;
			select(id: string): boolean;
			setHoist(id: string | null): void;
			projection(): BrowsingOutlineProjection;
			items(): readonly OutlineItem[];
			clearTemporaryExpansion(): void;
			setCollapsed(id: string, collapsed: boolean): Promise<void>;
			reload(): Promise<unknown>;
		},
	) {
		this.editorReturn = new EditorReturnController({
			navigation: ports.navigation,
			hasItem: (id) => ports.items().some((item) => item.id === id),
		});
	}
	remember = (): void => {
		const id = this.ports.selectedId();
		if (id && this.ports.view() === "outline" && !this.ports.longFormActive()) {
			this.editorReturn.remember(id, this.ports.hoistId());
		}
	};
	openOutline = async (): Promise<void> => {
		await this.ports.navigation.navigate({ view: "outline" });
	};
	openTree = async (): Promise<void> => {
		this.remember();
		await this.ports.navigation.navigate({ view: "globalLineage" });
	};
	openLongForm = async (): Promise<void> => {
		this.remember();
		await this.ports.navigation.navigate({
			view: "outline",
			occurrenceId: this.ports.selectedId(),
			longForm: true,
		});
	};

	returnToEditor = (): Promise<void> => this.editorReturn.restore();
	saveLongForm = async (): Promise<void> => {
		if (this.position) await this.returnToEditor();
		else await this.ports.navigation.navigate({ view: "outline", longForm: false });
	};
	focusSearch = (): void => {
		this.remember();
		document.querySelector<HTMLInputElement>(".omniwindow input")?.focus();
	};
	setAllCollapsed = async (collapsed: boolean): Promise<void> => {
		const projection = this.ports.projection();
		const items = projection.items.filter((item) => item.collapsed !== collapsed);
		try {
			// Sequential writes reuse the existing persistence boundary without concurrent store mutations.
			for (const item of items) await this.ports.setCollapsed(item.id, collapsed);
		} finally {
			this.ports.clearTemporaryExpansion();
			await this.ports.reload();
		}
		const id = collapsed ? projection.rootOccurrenceIds[0] ?? null : this.ports.selectedId();
		if (id && !this.ports.select(id)) return;
		await focusOutlineEditor(id);
	};
	zoomOut = async (): Promise<void> => {
		const root = this.ports.items().find((item) => item.id === this.ports.hoistId());
		if (!root) return;
		this.ports.setHoist(root.parentId);
		this.ports.select(root.id);
		await focusOutlineEditor(root.id);
	};
}
