// biome-ignore-all lint/style/noMagicNumbers: Seeds, byte sizes, and counts are the fixture contract.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { type AcceptanceFixtureOptions, createAcceptanceFixture } from "./acceptance.ts";
import { validatedGraphStateSnapshot } from "../../src/storage/graph_store.ts";

Deno.test("createAcceptanceFixture default options generates valid fixture v2", () => {
	const fixture = createAcceptanceFixture({
		seed: 42,
		nodeCount: 1_000,
		shape: "balanced",
	});

	assertEquals(fixture.manifest.fixtureVersion, 2);
	assertEquals(fixture.manifest.seed, 42);
	assertEquals(fixture.manifest.nodeCount, 1_000);
	assertEquals(fixture.manifest.shape, "balanced");
	assertEquals(fixture.manifest.bodyBytes, "short");
	assertEquals(fixture.manifest.revisionsPerWork, 0);
	assertEquals(fixture.manifest.linkMultiplier, 1);
	assertEquals(fixture.manifest.timeShape, "normal");
	assertEquals(fixture.manifest.hub, false);
	assertEquals(fixture.manifest.edgeCount, 1_000);
	assertEquals(fixture.manifest.revisionCount, 0);
	assertEquals(fixture.state.works.length, 1_000);
	assertEquals(fixture.state.occurrences.length, 1_000);
	assertEquals(fixture.state.links.length, 1_000);
	assertEquals(fixture.state.revisions.length, 0);

	// Validate snapshot domain invariants
	assertEquals(validatedGraphStateSnapshot(fixture.state), fixture.state);
});

Deno.test("createAcceptanceFixture is deterministic for identical options", () => {
	const opts: AcceptanceFixtureOptions = {
		seed: 12345,
		nodeCount: 1_000,
		shape: "wide",
		bodyBytes: 2048,
		revisionsPerWork: 4,
		linkMultiplier: 8,
		timeShape: "same-time",
		hub: true,
	};
	const f1 = createAcceptanceFixture(opts);
	const f2 = createAcceptanceFixture(opts);
	assertEquals(f1, f2);
});

Deno.test("createAcceptanceFixture validates options strictly", () => {
	assertThrows(() => createAcceptanceFixture({ seed: -1, nodeCount: 1_000, shape: "balanced" }));
	assertThrows(() =>
		createAcceptanceFixture({ seed: 42, nodeCount: 500 as unknown as 1_000, shape: "balanced" }),
	);
	assertThrows(() =>
		createAcceptanceFixture({
			seed: 42,
			nodeCount: 1_000,
			shape: "invalid-shape" as unknown as "balanced",
		}),
	);
	assertThrows(() =>
		createAcceptanceFixture({
			seed: 42,
			nodeCount: 1_000,
			shape: "balanced",
			bodyBytes: 1024 as unknown as 2048,
		}),
	);
});

Deno.test("bodyBytes axis: 2048 creates exact 2048-byte UTF-8 texts without altering tree structure", () => {
	const shortFixture = createAcceptanceFixture({
		seed: 42,
		nodeCount: 1_000,
		shape: "deep-chain",
		bodyBytes: "short",
	});
	const exactFixture = createAcceptanceFixture({
		seed: 42,
		nodeCount: 1_000,
		shape: "deep-chain",
		bodyBytes: 2048,
	});

	assertEquals(exactFixture.manifest.bodyBytes, 2048);
	const encoder = new TextEncoder();
	for (const wc of exactFixture.state.workingCopies) {
		assertEquals(encoder.encode(wc.text).length, 2048);
	}
	assertEquals(exactFixture.manifest.totalTextBytes, 1_000 * 2048);

	// Occurrences are identical across bodyBytes change
	assertEquals(exactFixture.state.occurrences, shortFixture.state.occurrences);
});

Deno.test("revisionsPerWork axis: 4 creates sequential DAG revisions and updates branch headRevisionId", () => {
	const fixture = createAcceptanceFixture({
		seed: 42,
		nodeCount: 1_000,
		shape: "all-roots",
		revisionsPerWork: 4,
	});

	assertEquals(fixture.manifest.revisionsPerWork, 4);
	assertEquals(fixture.manifest.revisionCount, 4_000);
	assertEquals(fixture.state.revisions.length, 4_000);

	for (let w = 0; w < 1_000; w++) {
		const workId = fixture.state.works[w].id;
		const workRevs = fixture.state.revisions.slice(w * 4, (w + 1) * 4);
		const branch = fixture.state.branches[w];

		assertEquals(branch.headRevisionId, workRevs[3].id);
		for (let r = 0; r < 4; r++) {
			assertEquals(workRevs[r].workId, workId);
			if (r === 0) {
				assertEquals(workRevs[r].parentRevisionIds, []);
			} else {
				assertEquals(workRevs[r].parentRevisionIds, [workRevs[r - 1].id]);
			}
		}
	}

	assertEquals(validatedGraphStateSnapshot(fixture.state), fixture.state);
});

Deno.test("linkMultiplier and hub axes create requested edge count and hub fanout", () => {
	const dense = createAcceptanceFixture({
		seed: 42,
		nodeCount: 1_000,
		shape: "balanced",
		linkMultiplier: 8,
		hub: false,
	});
	assertEquals(dense.manifest.edgeCount, 8_000);
	assertEquals(dense.state.links.length, 8_000);

	const hub = createAcceptanceFixture({
		seed: 42,
		nodeCount: 1_000,
		shape: "balanced",
		linkMultiplier: 8,
		hub: true,
	});
	assertEquals(hub.manifest.edgeCount, 8_000);
	assertEquals(hub.state.links.length, 8_000);

	// In hub mode, work 0 connects to all other 999 works
	const hubOutLinks = hub.state.links.filter((l) => l.fromId === hub.state.works[0].id);
	assertEquals(hubOutLinks.length, 999);
});

Deno.test("timeShape axis: same-time sets uniform timestamps across entities", () => {
	const fixture = createAcceptanceFixture({
		seed: 42,
		nodeCount: 1_000,
		shape: "balanced",
		revisionsPerWork: 4,
		timeShape: "same-time",
	});

	const targetTime = fixture.state.works[0].createdAt;
	for (const work of fixture.state.works) {
		assertEquals(work.createdAt, targetTime);
		assertEquals(work.updatedAt, targetTime);
	}
	for (const branch of fixture.state.branches) {
		assertEquals(branch.createdAt, targetTime);
	}
	for (const wc of fixture.state.workingCopies) {
		assertEquals(wc.updatedAt, targetTime);
	}
	for (const link of fixture.state.links) {
		assertEquals(link.createdAt, targetTime);
	}
	for (const rev of fixture.state.revisions) {
		assertEquals(rev.createdAt, targetTime);
	}
});

Deno.test("all 5 shapes roundtrip valid snapshots through validatedGraphStateSnapshot", () => {
	for (const shape of ["all-roots", "wide", "balanced", "deep-chain", "deep-cycle"] as const) {
		const fixture = createAcceptanceFixture({
			seed: 42,
			nodeCount: 1_000,
			shape,
		});
		assertEquals(validatedGraphStateSnapshot(fixture.state), fixture.state);
	}
});
