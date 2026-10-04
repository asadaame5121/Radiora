interface PaletteFocusPorts {
	open(): boolean;
	afterRender(): Promise<void>;
}
/** DOM references are short lived and late close cannot restore into a reopened palette. */
export class PaletteFocusAdapter {
	private target: HTMLElement | null = null;
	private generation = 0;
	private disposed = false;
	constructor(private readonly ports: PaletteFocusPorts) {}
	remember(): void {
		this.generation++;
		this.target = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	}
	async restore(): Promise<void> {
		const generation = ++this.generation;
		const target = this.target;
		await this.ports.afterRender();
		if (this.disposed || generation !== this.generation || this.ports.open()) return;
		this.target = null;
		if (target?.isConnected) target.focus();
	}
	dispose(): void {
		this.disposed = true;
		this.generation++;
		this.target = null;
	}
}
