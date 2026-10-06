import { tick } from "svelte";
import type { LayoutController } from "./layout_controller.svelte.ts";

/** The Inspector View owns its DOM connection, gestures and deferred DOM actions. */
export class InspectorLayoutAdapter {
	private element: HTMLElement | null = null;
	private stopResize: ((persist: boolean) => void) | undefined;
	private request = 0;
	private disposed = false;

	constructor(
		private readonly layout: LayoutController,
		private readonly captureCurrent: () => () => boolean,
		private readonly afterRender: () => Promise<void> = tick,
	) {}

	connect(element: HTMLElement): () => void {
		this.stopResize?.(false);
		this.request++;
		this.element = element;
		return () => {
			if (this.element !== element) return;
			this.stopResize?.(false);
			this.request++;
			this.element = null;
		};
	}

	startResize = (event: PointerEvent): void => {
		const win = this.element?.ownerDocument.defaultView;
		if (this.disposed || !win || event.button !== 0 || this.layout.inspectorCollapsed) return;
		event.preventDefault();
		this.stopResize?.(false);
		const initialWidth = this.layout.inspectorWidth;
		const move = (next: PointerEvent) => {
			if (next.pointerId === event.pointerId) {
				this.layout.previewInspectorWidth(win.innerWidth - next.clientX);
			}
		};
		const stop = (next: PointerEvent) => {
			if (next.pointerId === event.pointerId) this.stopResize?.(true);
		};
		this.stopResize = (persist) => {
			win.removeEventListener("pointermove", move);
			win.removeEventListener("pointerup", stop);
			win.removeEventListener("pointercancel", stop);
			this.stopResize = undefined;
			if (persist) this.layout.setInspectorWidth(this.layout.inspectorWidth);
			else this.layout.previewInspectorWidth(initialWidth);
		};
		win.addEventListener("pointermove", move);
		win.addEventListener("pointerup", stop);
		win.addEventListener("pointercancel", stop);
	};

	async toggleInspector(): Promise<void> {
		if (this.disposed) return;
		const opening = this.layout.inspectorCollapsed;
		this.layout.setInspectorCollapsed(!opening);
		if (!opening) return;
		this.layout.setAsideMode("overview");
		await this.reveal(false);
	}

	async openRelationEditor(): Promise<void> {
		if (this.disposed) return;
		this.layout.openInspector("relation");
		await this.reveal(true);
	}

	private async reveal(focusRelation: boolean): Promise<void> {
		const request = ++this.request;
		const revision = this.layout.inspectorRevision;
		const current = this.captureCurrent();
		await this.afterRender();
		const element = this.element;
		if (
			this.disposed || request !== this.request || revision !== this.layout.inspectorRevision ||
			!current() || this.layout.inspectorCollapsed || !element?.isConnected
		) return;
		element.scrollIntoView({ behavior: "smooth", block: "start" });
		if (focusRelation) {
			element.querySelector<HTMLInputElement>(".link-editor input[type=search]")?.focus();
		}
	}

	dispose(): void {
		this.disposed = true;
		this.request++;
		this.stopResize?.(false);
		this.element = null;
	}
}
