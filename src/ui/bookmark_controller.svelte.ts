import type { Bookmark, ResolvedBookmark } from "../domain/models.ts";

export interface BookmarkPorts {
	read(): Promise<Bookmark[]>;
	createBookmark?(id: string): Promise<unknown>;
	deleteBookmark?(id: string): Promise<unknown>;
	resolveBookmark?(id: string): Promise<ResolvedBookmark>;
	reportError(cause: unknown): void;
}

/** Owns bookmark reads independently of Outline/Tree, including staged reload publication. */
export class BookmarkController {
	private _bookmarks = $state<Bookmark[]>([]);
	private generation = 0;
	private disposed = false;
	constructor(private readonly ports: BookmarkPorts) {}
	get bookmarks() {
		return this._bookmarks;
	}

	prepareRefresh(canPublish = () => true) {
		const generation = ++this.generation;
		let cancelled = false;
		let next: Bookmark[] | undefined;
		const current = () =>
			!this.disposed && !cancelled && generation === this.generation && canPublish();
		const result = Promise.resolve().then(() => this.ports.read()).then(
			(value) => {
				next = value;
			},
			// Retired reads must not publish errors into the latest request.
			(cause) => {
				if (current()) throw cause;
			},
		);
		return {
			result,
			current,
			publish: () => {
				if (current() && next) this._bookmarks = next;
			},
			cancel: () => {
				cancelled = true;
			},
		};
	}

	async reload(): Promise<void> {
		if (this.disposed) return;
		const request = this.prepareRefresh();
		try {
			await request.result;
			request.publish();
		} catch (cause) {
			if (request.current()) this.ports.reportError(cause);
		}
	}

	async addBookmark(selectedId: string | null): Promise<void> {
		if (this.disposed || !selectedId || !this.ports.createBookmark) return;
		await this.ports.createBookmark(selectedId);
		await this.reload();
	}

	async removeBookmark(id: string): Promise<void> {
		if (this.disposed || !this.ports.deleteBookmark) return;
		await this.ports.deleteBookmark(id);
		await this.reload();
	}

	async resolveBookmark(id: string): Promise<ResolvedBookmark | undefined> {
		if (this.disposed || !this.ports.resolveBookmark) return undefined;
		return await this.ports.resolveBookmark(id);
	}

	dispose(): void {
		this.disposed = true;
		this.generation++;
	}
}
