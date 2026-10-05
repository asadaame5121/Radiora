// biome-ignore-all lint/plugin/noSwallowedRejection: Only superseded, cancelled or disposed bookmark failures are discarded; active failures are rethrown or reported.
import type { Bookmark } from "../domain/models.ts";

interface BookmarkPorts {
	read(): Promise<Bookmark[]>;
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

	dispose(): void {
		this.disposed = true;
		this.generation++;
	}
}
