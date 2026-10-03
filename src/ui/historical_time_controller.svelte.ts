import type { HistoricalTime } from "../domain/historical_time.ts";
import type { OutlineItem } from "../domain/models.ts";
import { historicalTimeDraft, parseHistoricalTimeDraft } from "./historical_time_form.ts";

export class HistoricalTimeController {
	item = $state<OutlineItem | null>(null);
	draft = $state(historicalTimeDraft());
	private baseline = $state(JSON.stringify(this.draft));
	error = $state("");
	submitting = $state(false);
	pending = $state<{ item: OutlineItem | null } | null>(null);
	private pendingSelectionAction: (() => void) | null = null;
	private pendingGuard = false;
	private pendingSelectionCancelled: (() => void) | null = null;
	readonly dirty = $derived(JSON.stringify(this.draft) !== this.baseline);
	constructor(
		private readonly ports: {
			save(workId: string, value: HistoricalTime | null): Promise<void>;
			reload(): Promise<unknown>;
			select(id: string | null): void;
		},
	) {}
	reset(next: OutlineItem | null = this.item): void {
		this.item = next;
		this.draft = historicalTimeDraft(next?.historicalTime);
		this.baseline = JSON.stringify(this.draft);
		this.error = "";
	}

	setKind(kind: "point" | "period"): void {
		if (this.draft.kind === kind) return;
		if (this.draft.kind === "point" && kind === "period") {
			this.draft.start.unknown = false;
		}
		this.draft.kind = kind;
	}

	select(
		next: OutlineItem | null,
		pendingAction: (() => void) | null = null,
		onCancelled: (() => void) | null = null,
	): boolean {
		if (next?.workId === this.item?.workId) {
			if (!this.dirty && !this.submitting) this.reset(next);
			else if (this.item && next) this.item = { ...this.item, id: next.id };
			return true;
		}
		if (this.dirty || this.submitting) {
			this.pendingGuard = false;
			this.pendingSelectionCancelled?.();
			this.pending = { item: next };
			this.pendingSelectionAction = pendingAction;
			this.pendingSelectionCancelled = onCancelled;
			return false;
		}
		this.reset(next);
		return true;
	}

	/** Ask permission without changing the destination form or selection. */
	canSelect(next: OutlineItem | null, current: () => boolean): Promise<boolean> {
		if (!current()) return Promise.resolve(false);
		if (next?.workId === this.item?.workId || (!this.dirty && !this.submitting)) {
			return Promise.resolve(true);
		}
		this.cancelPending();
		this.pendingGuard = true;
		this.pending = { item: next };
		return new Promise((resolve) => {
			this.pendingSelectionAction = () => resolve(current());
			this.pendingSelectionCancelled = () => resolve(false);
		});
	}

	cancelPending(): void {
		this.pendingSelectionCancelled?.();
		this.pending = null;
		this.pendingSelectionAction = null;
		this.pendingSelectionCancelled = null;
		this.pendingGuard = false;
	}

	/** Synchronous accepted selection; a dirty same-Work draft remains owned by its form. */
	commitSelection(next: OutlineItem | null): void {
		if (next?.workId === this.item?.workId && (this.dirty || this.submitting)) {
			if (this.item && next) this.item = { ...this.item, id: next.id };
		} else this.reset(next);
	}

	/** Keep navigation pending until the user accepts or cancels the selection guard. */
	async selectWhenReady(next: OutlineItem | null, commit: () => void): Promise<boolean> {
		const accepted = await new Promise<boolean>((resolve) => {
			if (this.select(next, () => resolve(true), () => resolve(false))) resolve(true);
		});
		if (accepted) commit();
		return accepted;
	}

	async save(remove = false): Promise<boolean> {
		if (!this.item || this.submitting) return false;
		this.submitting = true;
		this.error = "";
		try {
			const value = remove ? null : parseHistoricalTimeDraft(this.draft);
			await this.ports.save(this.item.workId, value);
			this.item = { ...this.item, historicalTime: value ?? undefined };
			this.reset(this.item);
			await this.ports.reload();
			return true;
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : String(cause);
			return false;
		} finally {
			this.submitting = false;
		}
	}

	async resolvePending(choice: "save" | "discard" | "cancel"): Promise<void> {
		if (!this.pending || this.submitting) return;
		if (choice === "cancel") {
			this.pendingSelectionCancelled?.();
			this.pending = null;
			this.pendingSelectionAction = null;
			this.pendingSelectionCancelled = null;
			return;
		}
		const pending = this.pending;
		const next = pending.item;
		if (choice === "save" && !(await this.save())) return;
		if (this.pending !== pending) return;
		const guarded = this.pendingGuard;
		const pendingSelectionAction = this.pendingSelectionAction;
		this.pending = null;
		this.pendingSelectionAction = null;
		this.pendingSelectionCancelled = null;
		this.pendingGuard = false;
		if (!guarded) this.reset(next);
		else if (choice === "discard") this.reset(this.item);
		if (pendingSelectionAction) pendingSelectionAction();
		else this.ports.select(next?.id ?? null);
	}
}
