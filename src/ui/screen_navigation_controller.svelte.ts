import type { ViewMode } from "./app_view_mode.ts";

/** Screen history is independent of outline browsing and the editor return shortcut. */
export class ScreenNavigationController<Context> {
	view = $state<ViewMode>("outline");
	private history = $state.raw<{ view: ViewMode; context: Context }[]>([]);
	private restoring = false;

	constructor(
		private readonly ports: {
			capture(): Context;
			restore(context: Context): Promise<boolean>;
			afterRestore?(context: Context, view: ViewMode): Promise<void>;
		},
	) {}

	get canGoBack(): boolean {
		return this.history.length > 0;
	}

	remember(): void {
		if (this.restoring) return;
		this.history = [...this.history, { view: this.view, context: this.ports.capture() }];
	}

	open(view: ViewMode): void {
		if (this.restoring || this.view === view) return;
		this.remember();
		this.view = view;
	}

	goBack = async (): Promise<void> => {
		const entry = this.history.at(-1);
		if (!entry || this.restoring) return;
		this.restoring = true;
		try {
			if (!await this.ports.restore(entry.context)) return;
			this.view = entry.view;
			this.history = this.history.slice(0, -1);
			await this.ports.afterRestore?.(entry.context, entry.view);
		} finally {
			this.restoring = false;
		}
	};
}
