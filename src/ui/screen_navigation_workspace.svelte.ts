import { tick } from "svelte";
import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import { currentBrowsingLocation } from "../services/browsing_navigation_state.ts";
import {
	type OutlineScreenContext,
	type OutlineScreenPorts,
	OutlineScreenState,
} from "./outline_screen_state.svelte.ts";
import type { ScreenDestination, ScreenNavigator } from "./screen_navigation_destination.ts";
import { ScreenNavigationController } from "./screen_navigation_controller.svelte.ts";

export interface ScreenNavigationWorkspacePorts {
	outline: OutlineScreenPorts;
	snapshot(): OutlineSnapshot;
	readOutline(): Promise<OutlineSnapshot>;
	publishOutline(snapshot: OutlineSnapshot): void;
	selection: {
		current(): string | null;
		guard(item: OutlineItem | null, current: () => boolean): Promise<boolean>;
		commit(id: string | null, item: OutlineItem | null): void;
		cancelPending(): void;
	};
	editor: { save(): Promise<boolean>; flush(): Promise<void> };
	screens: {
		/** Feature-owned preparation returns an internal synchronous publication port. */
		prepare(destination: ScreenDestination): Promise<() => void>;
		focusTree(): void;
	};
	reportError(cause: unknown): void;
}

interface PreparedDestination {
	destination: ScreenDestination;
	departure: OutlineScreenContext | null;
	outline: OutlineScreenContext | null;
	snapshot: OutlineSnapshot;
	selectedId: string | null;
	originSelectedId: string | null;
	publishScreen(): void;
}

/** All cross-screen requests pass this boundary; callers never receive a commit callback. */
export class ScreenNavigationWorkspace implements ScreenNavigator {
	private readonly outline: OutlineScreenState;
	private readonly navigation: ScreenNavigationController<
		ScreenDestination,
		PreparedDestination | null
	>;
	constructor(private readonly ports: ScreenNavigationWorkspacePorts) {
		this.outline = new OutlineScreenState(ports.outline);
		this.navigation = new ScreenNavigationController({
			prepare: (destination, current) => this.prepare(destination, current),
			guard: (prepared, current) => this.guard(prepared, current),
			valid: (prepared) =>
				Boolean(prepared && prepared.originSelectedId === ports.selection.current()),
			commit: (prepared) => {
				if (prepared) this.commit(prepared);
			},
			afterCommit: (prepared, current) =>
				prepared ? this.afterCommit(prepared, current) : Promise.resolve(),
			cancelPending: () => ports.selection.cancelPending(),
			reportError: ports.reportError,
		});
	}
	get view() {
		return this.navigation.view;
	}
	get canGoBack() {
		return this.navigation.canGoBack;
	}
	get pendingView() {
		return this.navigation.pendingView;
	}
	get origin() {
		return this.navigation.origin;
	}

	navigate = (destination: ScreenDestination, origin = this.origin): Promise<boolean> =>
		this.navigation.navigate(destination, origin);

	goBack = (): Promise<boolean> =>
		this.canGoBack ? this.navigate({ view: "outline" }) : Promise.resolve(false);
	openInspectorTool = (_mode: "query"): Promise<boolean> =>
		this.navigate({ view: "outline", query: true });

	private async prepare(
		destination: ScreenDestination,
		current: () => boolean,
	): Promise<PreparedDestination | null> {
		const originSelectedId = this.ports.selection.current();
		const departure = this.view === "outline" ? this.outline.capture() : null;
		if (!await this.ports.editor.save() || !current()) return null;
		await this.ports.editor.flush();
		if (!current()) return null;
		let snapshot = this.ports.snapshot();
		if (
			destination.occurrenceId &&
			!snapshot.items.some((item) => item.id === destination.occurrenceId)
		) snapshot = await this.ports.readOutline();
		if (!current()) return null;
		const outline = destination.view === "outline"
			? this.outline.prepare(destination, snapshot, departure)
			: null;
		return {
			destination,
			departure,
			outline,
			snapshot,
			publishScreen: () => undefined,
			originSelectedId,
			selectedId: outline
				? currentBrowsingLocation(outline.browsing).selectedOccurrenceId
				: destination.occurrenceId ?? this.ports.selection.current(),
		};
	}

	private async guard(
		prepared: PreparedDestination | null,
		requestCurrent: () => boolean,
	): Promise<boolean> {
		if (!prepared) return false;
		const current = () =>
			requestCurrent() && prepared.originSelectedId === this.ports.selection.current();
		const item = prepared.snapshot.items.find((value) => value.id === prepared.selectedId) ?? null;
		if (!await this.ports.selection.guard(item, current) || !current()) return false;
		const { destination } = prepared;
		if (destination.view === "outline" || destination.occurrenceId !== undefined) {
			if (!await this.refreshGuardedDestination(prepared, item, current)) return false;
		}
		prepared.publishScreen = await this.ports.screens.prepare(destination);
		return current();
	}

	private async refreshGuardedDestination(
		prepared: PreparedDestination,
		item: OutlineItem | null,
		current: () => boolean,
	): Promise<boolean> {
		const { destination } = prepared;
		// Saving a guard may refresh source data. Publish a fresh snapshot, never the pre-guard one.
		const snapshot = await this.ports.readOutline();
		if (!current()) return false;
		if (
			destination.occurrenceId &&
			!snapshot.items.some((value) => value.id === destination.occurrenceId)
		) throw new Error("移動先の項目が見つかりません。");
		const outline = destination.view === "outline"
			? this.outline.prepare(destination, snapshot, prepared.departure)
			: null;
		const selectedId = outline
			? currentBrowsingLocation(outline.browsing).selectedOccurrenceId
			: prepared.selectedId;
		const next = snapshot.items.find((value) => value.id === selectedId) ?? null;
		if (
			next?.workId !== item?.workId &&
			(!await this.ports.selection.guard(next, current) || !current())
		) return false;
		prepared.snapshot = snapshot;
		prepared.outline = outline;
		prepared.selectedId = selectedId;
		return current();
	}

	private commit(prepared: PreparedDestination): void {
		const { outline, departure, destination, snapshot, selectedId } = prepared;
		if (departure && destination.view !== "outline") this.outline.remember(departure);
		if (outline || destination.occurrenceId !== undefined) this.ports.publishOutline(snapshot);
		if (outline) this.outline.apply(outline);
		this.ports.selection.commit(
			selectedId,
			snapshot.items.find((item) => item.id === selectedId) ?? null,
		);
		prepared.publishScreen();
	}

	private async afterCommit(prepared: PreparedDestination, current: () => boolean): Promise<void> {
		await tick();
		if (!current()) return;
		if (prepared.outline) {
			await this.outline.restoreViewport(
				prepared.outline,
				() => current() && prepared.selectedId === this.ports.selection.current(),
			);
		} else if (prepared.destination.view === "globalLineage") this.ports.screens.focusTree();
	}
}
