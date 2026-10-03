import type { ViewMode } from "./app_view_mode.ts";

/** Owns the only boundary that may publish a prepared destination and its screen. */
export class ScreenNavigationController<Destination extends { view: ViewMode }, Prepared> {
	private currentView = $state<ViewMode>("outline");
	private request = 0;
	private receipt = 0;

	constructor(
		private readonly ports: {
			prepare(destination: Destination, current: () => boolean): Promise<Prepared>;
			guard(prepared: Prepared, current: () => boolean): Promise<boolean>;
			valid?(prepared: Prepared): boolean;
			commit(prepared: Prepared): void;
			afterCommit?(prepared: Prepared, current: () => boolean): Promise<void>;
			cancelPending(): void;
			reportError?(cause: unknown): void;
		},
	) {}

	get view(): ViewMode {
		return this.currentView;
	}
	get canGoBack(): boolean {
		return this.view !== "outline";
	}
	/** Read-only receipt for domain operations that finish after another navigation request. */
	get origin(): number {
		return this.receipt;
	}

	navigate = async (destination: Destination, origin = this.origin): Promise<boolean> => {
		if (origin !== this.origin) return false;
		const request = ++this.request;
		++this.receipt;
		const current = () => request === this.request;
		this.ports.cancelPending();
		try {
			const prepared = await this.ports.prepare(destination, current);
			if (
				!current() || !await this.ports.guard(prepared, current) || !current() ||
				this.ports.valid?.(prepared) === false
			) return false;
			this.ports.commit(prepared);
			this.currentView = destination.view;
			++this.receipt;
			await this.ports.afterCommit?.(prepared, current);
			return true;
		} catch (cause) {
			if (!this.ports.reportError) throw cause;
			if (current()) this.ports.reportError(cause);
			return false;
		}
	};
}
