/** One instance per file feature; shares only request lifetime and notice publication. */
export class FileOperationState {
	private _notice = $state("");
	private generation = 0;
	private disposed = false;

	get notice() {
		return this._notice;
	}

	async run(
		flush: () => Promise<void>,
		action: (current: () => boolean) => Promise<string | undefined>,
		reportError: (cause: unknown) => void,
	): Promise<void> {
		if (this.disposed) return;
		const generation = ++this.generation;
		const current = () => !this.disposed && generation === this.generation;
		this._notice = "";
		try {
			await flush();
			if (!current()) return;
			const notice = await action(current);
			if (current() && notice !== undefined) this._notice = notice;
		} catch (cause) {
			if (current()) reportError(cause);
		}
	}

	async runFile(
		flush: () => Promise<void>,
		file: Pick<File, "text">,
		action: (source: string, current: () => boolean) => Promise<string | undefined>,
		reportError: (cause: unknown) => void,
	): Promise<void> {
		await this.run(flush, async (current) => {
			const source = await file.text();
			return current() ? action(source, current) : undefined;
		}, reportError);
	}

	dispose(): void {
		this.disposed = true;
		this.generation++;
	}
}
