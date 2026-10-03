import type { OutlineItem } from "../domain/models.ts";

export class LongFormController {
	state = $state({ active: false, text: "", dirty: false, preview: false });
	private itemId: string | null = null;
	constructor(
		private readonly ports: {
			flush(): Promise<void>;
			save(id: string, text: string): Promise<void>;
			/** Resolve only after selection accepts the saved occurrence; false means cancelled or failed. */
			reload(id: string): Promise<boolean>;
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
	async save(): Promise<boolean> {
		if (!this.state.active || !this.itemId) return true;
		const id = this.itemId;
		try {
			await this.ports.flush();
			if (this.state.dirty) await this.ports.save(id, this.state.text);
			if (!await this.ports.reload(id)) return false;
			this.reset();
			return true;
		} catch (cause) {
			this.ports.reportError(cause);
			return false;
		}
	}
}
