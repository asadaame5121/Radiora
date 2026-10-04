import type { LinkType } from "../domain/models.ts";
import type { GlobalLineageProjection } from "../services/branch_service.ts";
import type { GlobalLineageFilter } from "../services/global_lineage_filter.ts";
import {
	loadTreeFilterPreference,
	saveTreeFilterPreference,
	type TreeFilterStorage,
} from "./tree_filter_preference.ts";
import {
	loadTreeProjectionPreference,
	saveTreeProjectionPreference,
	type TreeProjection,
	type TreeProjectionStorage,
} from "./tree_projection_preference.ts";

export interface TreeControllerPorts {
	listGlobalLineage: (filter: GlobalLineageFilter) => Promise<GlobalLineageProjection>;
	selectedWorkId: () => string | null;
	onError: (cause: unknown) => void;
}

export interface TreePreferences {
	projectionStorage?: TreeProjectionStorage | null;
	filterStorage?: TreeFilterStorage | null;
}

/** App-lifetime settings/results owner; selection is read, never stored here. */
export class TreeController {
	private _projectionPreference = $state<TreeProjection>("chronology");
	private _filter = $state<GlobalLineageFilter>(loadTreeFilterPreference(null));
	private _projection = $state<GlobalLineageProjection | null>(null);
	private _loading = $state(false);
	private _error = $state<unknown>(null);
	private generation = 0;
	private loadedKey = "";
	private disposed = false;

	constructor(
		private readonly ports: TreeControllerPorts,
		private readonly preferences: TreePreferences = {},
	) {
		this._projectionPreference = loadTreeProjectionPreference(preferences.projectionStorage);
		this._filter = loadTreeFilterPreference(preferences.filterStorage);
	}

	get projectionPreference(): TreeProjection {
		return this._projectionPreference;
	}
	get filter(): GlobalLineageFilter {
		return this._filter;
	}
	get projection(): GlobalLineageProjection | null {
		return this._projection;
	}
	get loading(): boolean {
		return this._loading;
	}
	get error(): unknown {
		return this._error;
	}

	setProjection(next: TreeProjection): void {
		if (this._projectionPreference === next) return;
		this._projectionPreference = next;
		saveTreeProjectionPreference(next, this.preferences.projectionStorage);
	}

	setFilter(next: GlobalLineageFilter): void {
		this.invalidate();
		this._filter = {
			includeIsolated: next.includeIsolated,
			linkTypes: [...next.linkTypes],
			includeWorkIds: [],
		};
		saveTreeFilterPreference(this._filter, this.preferences.filterStorage);
	}

	/** Keep the existing catalogue reconciliation policy, including stored fallback. */
	reconcileRelations(names: readonly LinkType[], reloadStored = false): void {
		const current = reloadStored
			? loadTreeFilterPreference(this.preferences.filterStorage, names)
			: this._filter;
		const missing = names.filter((name) => !current.linkTypes.includes(name));
		const next = missing.length
			? { ...current, linkTypes: [...current.linkTypes, ...missing] }
			: current;
		if (next !== this._filter) this.invalidate();
		this._filter = next;
		if (next !== current) saveTreeFilterPreference(next, this.preferences.filterStorage);
	}

	activeFilter(): GlobalLineageFilter {
		const id = this.ports.selectedWorkId();
		return {
			...this._filter,
			linkTypes: [...this._filter.linkTypes],
			includeWorkIds: id ? [id] : [],
		};
	}

	filterKey(): string {
		return filterKey(this.activeFilter());
	}
	needsRefresh(key: string): boolean {
		return this.loadedKey !== key;
	}

	/**
	 * Reload starts all I/O concurrently, but publishes Tree only after the other
	 * reads succeed. Both reload and visible-Tree refresh use this request scope.
	 * Startup can make Tree optional: report its error/retry state while keeping Outline usable.
	 */
	prepareRefresh(canPublish = () => true, required = true) {
		if (this.disposed) {
			return {
				result: Promise.resolve(),
				publish: () => undefined,
				cancel: () => undefined,
			};
		}
		const filter = this.activeFilter();
		const key = filterKey(filter);
		const generation = ++this.generation;
		const current = () =>
			!this.disposed && generation === this.generation && key === this.filterKey() && canPublish();
		const owned = () => generation === this.generation && !this.disposed;
		let pending: GlobalLineageProjection | null = null;
		this._loading = true;
		this._error = null;
		return {
			result: this.readProjection(filter, current, owned, required).then((projection) => {
				pending = projection;
			}),
			publish: () => {
				if (pending && current()) {
					this._projection = pending;
					this.loadedKey = key;
				}
				pending = null;
				if (owned()) this._loading = false;
			},
			cancel: () => {
				pending = null;
				if (owned()) this.invalidate();
			},
		};
	}

	async refresh(): Promise<void> {
		if (this.disposed) return;
		const request = this.prepareRefresh();
		try {
			await request.result;
			request.publish();
		} catch {
			request.cancel(); /* readProjection recorded and reported the current failure. */
		}
	}

	invalidate(): void {
		this.generation++;
		this._loading = false;
	}
	dispose(): void {
		this.disposed = true;
		this.invalidate();
	}

	private async readProjection(
		filter: GlobalLineageFilter,
		current: () => boolean,
		owned: () => boolean,
		required: boolean,
	): Promise<GlobalLineageProjection | null> {
		try {
			return await this.ports.listGlobalLineage(filter);
		} catch (cause) {
			if (owned()) this._loading = false;
			if (!current()) return null;
			this._error = cause;
			this.ports.onError(cause);
			if (required) throw cause;
			return null;
		}
	}
}

function filterKey(filter: GlobalLineageFilter): string {
	return JSON.stringify([
		filter.includeIsolated,
		[...filter.linkTypes].sort(),
		[...filter.includeWorkIds].sort(),
	]);
}
