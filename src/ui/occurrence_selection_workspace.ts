import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import {
	activateBrowsingPane,
	ancestorBreadcrumb,
	browseToOutlineOccurrence,
	type BrowsingLocation,
	type BrowsingNavigationState,
	createBrowsingNavigationState,
	currentBrowsingLocation,
	reconcileBrowsingState,
	setBrowsingHoist,
} from "../services/browsing_navigation_state.ts";
import type { HistoricalTimeController } from "./historical_time_controller.svelte.ts";

interface SelectionPorts {
	current(): string | null;
	/** Internal App publication port; never passed to Views or domain operations. */
	publish(id: string | null): void;
	snapshot(): OutlineSnapshot;
	publishStartupSnapshot(snapshot: OutlineSnapshot): void;
	interruptNavigation(): void;
	clearCompletions(): void;
	form: Pick<
		HistoricalTimeController,
		| "canSelectImmediately"
		| "canSelect"
		| "commitSelection"
		| "reconcileSelection"
		| "cancelPending"
		| "dirty"
		| "submitting"
	>;
	outline: {
		visible(): boolean;
		browsing(): BrowsingNavigationState;
		publishBrowsing(state: BrowsingNavigationState): void;
		expanded(): readonly string[];
		publishExpanded(ids: string[]): void;
		capturePanels(): void;
		restorePane(id: string | null, current: () => boolean): Promise<void>;
	};
	reportError(cause: unknown): void;
}

interface PreparedSelection {
	id: string | null;
	item: OutlineItem | null;
	browsing?: BrowsingNavigationState;
	expanded?: string[];
	paneId?: string;
}

/** Coordinates selection/form/browsing commits; App remains the sole selection state owner. */
export class OccurrenceSelectionWorkspace {
	private generation = 0;
	private initialRestorationOpen = true;
	private disposed = false;

	constructor(private readonly ports: SelectionPorts) {}

	select(id: string | null, afterSelection?: (current: () => boolean) => void): boolean {
		return this.request(() => this.prepareOccurrence(id), afterSelection);
	}

	switchPane(paneId: string): boolean {
		if (!this.ports.outline.visible()) return false;
		return this.request(() => this.preparePane(paneId), (current) => {
			const id = this.ports.current();
			void this.ports.outline.restorePane(id, current).catch((cause) => {
				if (current()) this.ports.reportError(cause);
			});
		});
	}

	/** Hoist changes scope, not the global selection; keep the active pane aligned. */
	setHoist(id: string | null): void {
		if (this.disposed || !this.ports.outline.visible()) return;
		const snapshot = this.ports.snapshot();
		if (id !== null && !findItem(snapshot, id)) return;
		this.ports.interruptNavigation();
		this.cancelPending();
		const scoped = setBrowsingHoist(this.ports.outline.browsing(), id);
		this.ports.outline.publishBrowsing(
			browseToOutlineOccurrence(scoped, snapshot, this.ports.current()),
		);
	}

	/** Workspace has already applied its prepared Outline state and checked its request. */
	commitPrepared(id: string | null, item: OutlineItem | null): void {
		if (this.disposed) return;
		this.cancelPending();
		this.commit({ id, item });
	}

	/**
	 * Caller authorizes its startup session and body drafts. This Workspace additionally protects
	 * its selection request history and historical form, whose commits it coordinates.
	 */
	restoreInitial(
		snapshot: OutlineSnapshot,
		location: BrowsingLocation,
		sessionAllowsRestore: () => boolean,
	): boolean {
		if (
			this.disposed || !this.initialRestorationOpen || !sessionAllowsRestore() ||
			this.ports.form.dirty || this.ports.form.submitting
		) return false;
		this.cancelPending();
		const browsing = reconcileBrowsingState(
			createBrowsingNavigationState("pane-1", location),
			snapshot,
		);
		const id = currentBrowsingLocation(browsing).selectedOccurrenceId;
		this.ports.publishStartupSnapshot(snapshot);
		this.commit({ id, item: findItem(snapshot, id), browsing });
		return true;
	}

	/** Reload owns the snapshot/draft overlay. This operation only corrects selection metadata. */
	reconcile(): void {
		if (this.disposed) return;
		this.initialRestorationOpen = false;
		const snapshot = this.ports.snapshot();
		const item = findItem(snapshot, this.ports.current());
		const id = item?.id ?? null;
		if (id !== this.ports.current()) this.cancelPending();
		const browsing = this.ports.outline.visible()
			? reconcileBrowsingState(this.ports.outline.browsing(), snapshot)
			: undefined;
		const expanded = browsing
			? this.ports.outline.expanded().filter((key) =>
				snapshot.items.some((value) => value.id === key)
			)
			: undefined;
		this.commit({ id, item, browsing, expanded }, "correction");
	}

	cancelPending(): void {
		this.generation++;
		this.initialRestorationOpen = false;
		this.ports.form.cancelPending();
	}

	dispose(): void {
		this.disposed = true;
		this.cancelPending();
	}

	/** A token for render-delayed focus/caret work, including the A→B→A case. */
	currentReceipt(): () => boolean {
		const generation = this.generation;
		return () => !this.disposed && generation === this.generation;
	}

	private request(
		prepare: () => PreparedSelection | null,
		afterSelection?: (current: () => boolean) => void,
	): boolean {
		if (this.disposed) return false;
		const next = prepare();
		if (!next) return false;
		this.ports.interruptNavigation();
		this.cancelPending();
		const current = this.currentReceipt();
		if (this.ports.form.canSelectImmediately(next.item)) {
			this.accept(next, current, afterSelection);
			return true;
		}
		void this.acceptWhenReady(prepare, next, current, afterSelection).catch((cause) => {
			if (current()) this.ports.reportError(cause);
		});
		return false;
	}

	private async acceptWhenReady(
		prepare: () => PreparedSelection | null,
		next: PreparedSelection,
		current: () => boolean,
		afterSelection?: (current: () => boolean) => void,
	): Promise<void> {
		while (current()) {
			if (!await this.ports.form.canSelect(next.item, current) || !current()) return;
			const latest = prepare();
			if (!latest) return;
			if (this.ports.form.canSelectImmediately(latest.item)) {
				this.accept(latest, current, afterSelection);
				return;
			}
			next = latest;
		}
	}

	private accept(
		next: PreparedSelection,
		current: () => boolean,
		afterSelection?: (current: () => boolean) => void,
	): void {
		if (!current()) return;
		if (next.paneId) this.ports.outline.capturePanels();
		this.commit(next);
		afterSelection?.(current);
	}

	private commit(next: PreparedSelection, mode: "selection" | "correction" = "selection"): void {
		if (mode === "correction" || next.paneId || this.ports.current() !== next.id) {
			this.ports.clearCompletions();
		}
		if (next.browsing) this.ports.outline.publishBrowsing(next.browsing);
		if (next.expanded) this.ports.outline.publishExpanded(next.expanded);
		this.ports.publish(next.id);
		if (mode === "correction") this.ports.form.reconcileSelection(next.item);
		else this.ports.form.commitSelection(next.item);
	}

	private prepareOccurrence(id: string | null): PreparedSelection | null {
		const snapshot = this.ports.snapshot();
		const item = findItem(snapshot, id);
		if (id !== null && !item) return null;
		const browsing = this.ports.outline.visible()
			? browseToOutlineOccurrence(this.ports.outline.browsing(), snapshot, id)
			: undefined;
		return { id, item, browsing };
	}

	private preparePane(paneId: string): PreparedSelection | null {
		const state = this.ports.outline.browsing();
		if (!this.ports.outline.visible() || !state.panes.some((pane) => pane.id === paneId)) {
			return null;
		}
		const snapshot = this.ports.snapshot();
		const browsing = reconcileBrowsingState(activateBrowsingPane(state, paneId), snapshot);
		const id = currentBrowsingLocation(browsing).selectedOccurrenceId;
		return {
			id,
			item: findItem(snapshot, id),
			browsing,
			paneId,
			expanded: ancestorBreadcrumb(snapshot, id).map((item) => item.id),
		};
	}
}

function findItem(snapshot: OutlineSnapshot, id: string | null): OutlineItem | null {
	return snapshot.items.find((item) => item.id === id) ?? null;
}
