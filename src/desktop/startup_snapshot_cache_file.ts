import type { OutlineSnapshot } from "../domain/models.ts";
import {
	createStartupSnapshotCache,
	parseStartupSnapshotCache,
	type StartupSnapshotCache,
	type StartupSnapshotLocation,
} from "../services/startup_snapshot_cache.ts";

/** Persists the startup snapshot outside CEF's per-launch temporary profile. */
export class StartupSnapshotCacheFile {
	readonly #path: string;

	constructor(path: string) {
		this.#path = path;
	}

	async load(): Promise<StartupSnapshotCache | null> {
		try {
			return parseStartupSnapshotCache(await Deno.readTextFile(this.#path));
		} catch {
			return null;
		}
	}

	async save(snapshot: OutlineSnapshot, location: StartupSnapshotLocation): Promise<boolean> {
		const cache = createStartupSnapshotCache(snapshot, location);
		if (!cache) return false;
		try {
			await Deno.writeTextFile(this.#path, JSON.stringify(cache));
			return true;
		} catch {
			return false;
		}
	}
}
