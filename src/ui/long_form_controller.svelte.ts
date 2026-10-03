import type { OutlineItem } from "../domain/models.ts";

export class LongFormController {
	state = $state({ active: false, text: "", dirty: false, preview: false });
	private itemId: string | null = null;
	constructor(
		private readonly ports: {
			flush(): Promise<void>;
			save(id: string, text: string): Promise<void>;
			/** Refresh data without selecting an occurrence or changing screens. */
			reload(): Promise<boolean>;
			reportError(cause: unknown): void;
		},
	) {}
	async start(item: OutlineItem): Promise<void> {
		if (this.state.active) return;
		await this.ports.flush();
		this.itemId = item.id;
		this.state = { active: true, text: item.text, dirty: false, preview: false };
	}
	input(text: string): void {
		this.state.text = text;
		this.state.dirty = true;
	}
	reset(): void {
		this.state = { active: false, text: "", dirty: false, preview: false };
		this.itemId = null;
	}
	setMode(active: boolean, item: OutlineItem | null): void {
		if (!active || !item) {
			this.reset();
			return;
		}
		if (this.itemId === item.id && this.state.active) {
			if (!this.state.dirty) this.state.text = item.text;
			return;
		}
		this.itemId = item.id;
		this.state = { active: true, text: item.text, dirty: false, preview: false };
	}

	async save(close = true): Promise<boolean> {
		if (!this.state.active || !this.itemId) return true;
		const id = this.itemId;
		try {
			await this.ports.flush();
			if (this.state.dirty) await this.ports.save(id, this.state.text);
			if (this.state.dirty && !await this.ports.reload()) return false;
			if (close) this.reset();
			else this.state.dirty = false;
			return true;
		} catch (cause) {
			this.ports.reportError(cause);
			return false;
		}
	}
}
