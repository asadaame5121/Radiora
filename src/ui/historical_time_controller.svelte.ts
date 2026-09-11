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
 readonly dirty = $derived(JSON.stringify(this.draft) !== this.baseline);
 constructor(private readonly ports: {
  save(workId: string, value: HistoricalTime | null): Promise<void>;
  reload(): Promise<unknown>;
  select(id: string | null): void;
 }) {}
	reset(next: OutlineItem | null = this.item): void {
		this.item = next;
		this.draft = historicalTimeDraft(next?.historicalTime);
		this.baseline = JSON.stringify(this.draft);
		this.error = "";
	}

	select(next: OutlineItem | null): boolean {
		if (next?.workId === this.item?.workId) {
			if (!this.dirty && !this.submitting) this.reset(next);
			else if (this.item && next) this.item = { ...item, id: next.id };
			return true;
		}
		if (this.dirty || this.submitting) {
			this.pending = { item: next };
			return false;
		}
		reset(next);
		return true;
	}

	async save(remove = false): Promise<boolean> {
		if (!this.item || this.submitting) return false;
		this.submitting = true;
		this.error = "";
		try {
			const value = remove ? null : parseHistoricalTimeDraft(this.draft);
			await this.ports.save(this.item.workId, value);
			this.item = { ...item, historicalTime: value ?? undefined };
			reset(this.item);
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
			this.pending = null;
			return;
		}
		const next = this.pending.item;
		if (choice === "save" && !(await this.save())) return;
		this.pending = null;
		reset(next);
		this.ports.select(next?.id ?? null);
	}

}
