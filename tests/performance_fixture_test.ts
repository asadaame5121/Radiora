import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
	createPerformanceFixture,
	PERFORMANCE_FIXTURE_PROFILES,
	validatePerformanceFixture,
	writePerformanceDatabase,
} from "../scripts/performance_fixture.ts";
import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";

for (const profile of PERFORMANCE_FIXTURE_PROFILES) {
	Deno.test(`1,000-topic ${profile} fixture is deterministic and valid`, () => {
		const options = { profile, topicCount: 1_000, seed: 42 } as const;
		const fixture = createPerformanceFixture(options);
		assertEquals(fixture.manifest.topicCount, 1_000);
		assertEquals(validatePerformanceFixture(fixture).manifest, fixture.manifest);
		assertEquals(createPerformanceFixture(options), fixture);
		if (profile === "deep-tree" || profile === "combined") {
			assert(fixture.manifest.maximumDepth >= 50);
		}
		if (profile === "wide-tree" || profile === "combined") {
			assert(fixture.manifest.childCountDistribution.maximum >= 100);
		}
		if (profile === "dense-links" || profile === "combined") {
			assert(fixture.manifest.maximumDegree >= 100);
		}
	});
}

Deno.test("performance fixture rejects parent cycles", () => {
	const fixture = structuredClone(
		createPerformanceFixture({ profile: "baseline", topicCount: 1_000, seed: 42 }),
	);
	fixture.state.occurrences[0].parentOccurrenceId = fixture.state.occurrences[1].id;
	fixture.state.occurrences[1].parentOccurrenceId = fixture.state.occurrences[0].id;
	assertThrows(() => validatePerformanceFixture(fixture), Error, "Parent cycle");
});

Deno.test("performance fixture round-trips through an isolated SQLite database", async () => {
	const { state } = createPerformanceFixture({ profile: "baseline", topicCount: 1_000, seed: 42 });
	const directory = await Deno.makeTempDir({ prefix: "radiora-performance-" });
	const path = `${directory}/fixture.db`;
	try {
		assert(await writePerformanceDatabase(path, state) > 0);
		const store = new SqliteGraphStore(path);
		try {
			await store.initialize();
			assertEquals(await store.exportGraphState(), state);
		} finally {
			await store.close();
		}
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
