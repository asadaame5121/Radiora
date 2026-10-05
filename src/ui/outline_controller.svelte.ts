import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import type { WorkingCopyDraft } from "../services/working_copy_autosave.ts";
import { applyBranchWorkingCopyText } from "./editor_working_copy.ts";
import { branchKey, overlayDrafts } from "./outline_draft_overlay.ts";

export interface OutlinePublication {
	current(): boolean;
	publish(snapshot: OutlineSnapshot): boolean;
}

interface OutlinePorts {
	readOutline(): Promise<OutlineSnapshot>;
	prepareBookmarks(current: () => boolean): {
		result: Promise<void>;
		publish(): void;
		cancel(): void;
	};
	drafts(): readonly WorkingCopyDraft[];
	prepareTree(current: () => boolean, required: boolean): {
		result: Promise<void>;
		publish(): void;
		cancel(): void;
	};
	reconcileSelection(): void;
	selectionReceipt(): () => boolean;
	focus(id: string, current: () => boolean): void;
	persist(snapshot: OutlineSnapshot): void;
	reportError(cause: unknown): void;
	clearError(): void;
}

/** App-lifetime owner of the Outline drawing cache and all read publication authority. */
export class OutlineController {
	private _snapshot = $state<OutlineSnapshot>({
		items: [],
		links: [],
		knots: [],
		stashItemIds: [],
	});
	private _loading = $state(true);
	private _hasSnapshot = $state(false);
	private savedSnapshot: OutlineSnapshot = this._snapshot;
	private generation = 0;
	private published = false;
	private disposed = false;
	private readEdits: Set<string> | null = null;
	private cancelPending: (() => void) | null = null;

	constructor(private readonly ports: OutlinePorts) {}
	get snapshot() {
		return this._snapshot;
	}
	get loading() {
		return this._loading;
	}
	get hasSnapshot() {
		return this._hasSnapshot;
	}
	get cacheSnapshot() {
		return this.savedSnapshot;
	}

	/** Navigation start/disposal cancels a staged reload immediately, including its Tree scope. */
	invalidate(): void {
		this.generation++;
		this.cancelPending?.();
		this.cancelPending = null;
		this.readEdits = null;
		this._loading = false;
	}

	begin(canPublish = () => true): OutlinePublication {
		if (this.disposed || !canPublish()) return { current: () => false, publish: () => false };
		this.invalidate();
		const generation = this.generation;
		const initialDrafts = this.ports.drafts();
		const readEdits = new Set<string>();
		this.readEdits = readEdits;
		let accepted = false;
		const current = () => !this.disposed && generation === this.generation && canPublish();
		return {
			current,
			publish: (snapshot) => {
				if (accepted || !current()) return false;
				accepted = true;
				const next = overlayDrafts(snapshot, [...initialDrafts, ...this.ports.drafts()]);
				// Input saved during this read is still newer than its backend response.
				for (const item of this._snapshot.items) {
					if (item.revisionSelector.mode === "branch" && readEdits.has(branchKey(item))) {
						applyBranchWorkingCopyText(next.items, item, item.text, item.updatedAt);
					}
				}
				this.savedSnapshot = snapshot;
				this._snapshot = next;
				this._hasSnapshot = true;
				this.published = true;
				return true;
			},
		};
	}

	/** Optional startup cache cannot replace any accepted formal result. */
	restoreCache(snapshot: OutlineSnapshot): boolean {
		if (this.disposed || this.published) return false;
		this.savedSnapshot = snapshot;
		this._snapshot = overlayDrafts(snapshot, this.ports.drafts());
		this._hasSnapshot = true;
		this._loading = false;
		return true;
	}

	updateText(item: OutlineItem, text: string, updatedAt: string): void {
		applyBranchWorkingCopyText(this._snapshot.items, item, text, updatedAt);
		this.readEdits?.add(branchKey(item));
	}

	async reload(options: {
		focusId?: string;
		canFocus?: () => boolean;
		current?: () => boolean;
		treeRequired?: boolean;
	} = {}): Promise<boolean> {
		const publication = this.begin(options.current);
		const { current } = publication;
		if (!current()) return false;
		const selectionCurrent = this.ports.selectionReceipt();
		this._loading = true;
		this.ports.clearError();
		let tree: ReturnType<OutlinePorts["prepareTree"]> | undefined;
		let bookmarks: ReturnType<OutlinePorts["prepareBookmarks"]> | undefined;
		try {
			tree = this.ports.prepareTree(current, options.treeRequired ?? true);
			bookmarks = this.ports.prepareBookmarks(current);
			this.cancelPending = () => {
				tree?.cancel();
				bookmarks?.cancel();
			};
			const [snapshot] = await Promise.all([
				this.ports.readOutline(),
				bookmarks.result,
				tree.result,
			]);
			if (!current()) {
				tree.cancel();
				bookmarks.cancel();
				return false;
			}
			// Deletion reconciliation can itself retire the selection receipt.
			const focusAllowed = selectionCurrent() && (options.canFocus?.() ?? true);
			publication.publish(snapshot);
			this.ports.reconcileSelection();
			tree.publish();
			bookmarks.publish();
			this.ports.persist(snapshot);
			if (options.focusId && focusAllowed) this.ports.focus(options.focusId, current);
			return true;
		} catch (cause) {
			tree?.cancel();
			bookmarks?.cancel();
			if (current()) this.ports.reportError(cause);
			return false;
		} finally {
			if (current()) {
				this._loading = false;
				this.cancelPending = null;
			}
		}
	}

	dispose(): void {
		this.disposed = true;
		this.invalidate();
	}
}
