import { assertEquals } from "jsr:@std/assert@1";
import type { OutlineSnapshot } from "../src/domain/models.ts";
import {
	createStartupSnapshotCache,
	parseStartupSnapshotCache,
} from "../src/services/startup_snapshot_cache.ts";
import { StartupSnapshotCacheFile } from "../src/desktop/startup_snapshot_cache_file.ts";

const snapshot: OutlineSnapshot = {
	items: [{
		id: "occurrence-1",
		workId: "work-1",
		text: "cached outline",
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "branch-1" },
		createdAt: "2026-08-07T00:00:00.000Z",
		updatedAt: "2026-08-07T00:00:00.000Z",
	}],
	links: [],
	knots: [],
	stashItemIds: [],
};

Deno.test("startup snapshot cache round-trips the last known outline and location", () => {
	const cache = createStartupSnapshotCache(
		snapshot,
		{ selectedOccurrenceId: "occurrence-1", hoistOccurrenceId: null },
		{ now: () => "2026-08-07T01:00:00.000Z" },
	);

	assertEquals(cache, {
		version: 1,
		savedAt: "2026-08-07T01:00:00.000Z",
		snapshot,
		location: { selectedOccurrenceId: "occurrence-1", hoistOccurrenceId: null },
	});
	assertEquals(parseStartupSnapshotCache(JSON.stringify(cache)), cache);
});

Deno.test("startup snapshot cache ignores malformed and incompatible values", () => {
	assertEquals(parseStartupSnapshotCache("not-json"), null);

	assertEquals(
		parseStartupSnapshotCache(JSON.stringify({
			version: 2,
			savedAt: "2026-08-07T01:00:00.000Z",
			snapshot,
			location: { selectedOccurrenceId: null, hoistOccurrenceId: null },
		})),
		null,
	);
});

Deno.test("startup snapshot cache rejects values over its size limit", () => {
	const cache = createStartupSnapshotCache(
		snapshot,
		{ selectedOccurrenceId: null, hoistOccurrenceId: null },
		{ maxBytes: 1 },
	);

	assertEquals(cache, null);
});

Deno.test("startup snapshot cache persists independently of a browser profile", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/startup-snapshot.json`;
	try {
		const cache = new StartupSnapshotCacheFile(path);
		assertEquals(
			await cache.save(snapshot, { selectedOccurrenceId: "occurrence-1", hoistOccurrenceId: null }),
			true,
		);
		assertEquals((await cache.load())?.snapshot, snapshot);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
