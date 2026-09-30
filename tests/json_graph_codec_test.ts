import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
	expectedJsonGraphFixture,
	jsonGraphCodecFixture,
} from "./support/json_graph_codec_fixture.ts";
import { decodeJsonGraph } from "../src/storage/json_graph_codec.ts";

for (let version = 1; version <= 8; version++) {
	Deno.test(`JSON codec validates V${version} without mutating its fixture`, async () => {
		const fixture = await jsonGraphCodecFixture(version);
		const before = structuredClone(fixture);
		const decoded = decodeJsonGraph(fixture);
		assertEquals(decoded.data, await expectedJsonGraphFixture(version));
		assertEquals(decoded.protectionVersion, version === 8 ? null : version);
		assertEquals(fixture, before);
		decoded.data.workingCopies[0].text = "changed after decode";
		assertEquals(fixture, before);
	});
}

Deno.test("JSON codec migrates the complete V0 fixture while preserving legacy graph semantics", async () => {
	const input = await jsonGraphCodecFixture(0);
	const before = structuredClone(input);
	const { data, protectionVersion } = decodeJsonGraph(input);
	assertEquals(protectionVersion, 0);
	assertEquals(data.works.length, 5);
	assertEquals(
		data.workingCopies.map((copy) => copy.text),
		input.items.map((item: { text: string }) => item.text),
	);
	assertEquals(
		data.occurrences.map((occurrence) => occurrence.parentOccurrenceId),
		input.items.map((item: { parentId: string | null }) => item.parentId),
	);
	assertEquals(data.links[0].status, "asserted");
	assertEquals(data.revisions, []);
	assertEquals(data.bookmarks, []);
	assertEquals(data.resumePosition, null);
	assertEquals(input, before);
});

for (const input of [null, true, 42, "backup"]) {
	Deno.test(`JSON codec retains native TypeError for ${JSON.stringify(input)}`, () => {
		assertThrows(() => decodeJsonGraph(input), TypeError, "schemaVersion");
	});
}

Deno.test("JSON codec checks format before version and version before data", () => {
	assertThrows(
		() => decodeJsonGraph({ format: "other", schemaVersion: 9 }),
		Error,
		"Unsupported backup format: other",
	);
	for (const version of [9, 0, -1, 1.5, "8", null]) {
		assertThrows(
			() => decodeJsonGraph({ format: "radiora-backup", schemaVersion: version }),
			Error,
			`Unsupported backup schema version: ${String(version)}`,
		);
	}
});

Deno.test("JSON codec preserves V7/V8 catalog checks and graph validation order", async () => {
	for (const version of [7, 8]) {
		for (const data of [null, [], {}, { works: [] }]) {
			assertThrows(
				() => decodeJsonGraph({ format: "radiora-backup", schemaVersion: version, data }),
				Error,
				"Invalid V7 backup data: missing relationTypeDefinitions",
			);
		}
	}
	for (let version = 1; version <= 8; version++) {
		const fixture = await jsonGraphCodecFixture(version);
		fixture.data.works = {};
		fixture.data.branches = {};
		assertThrows(() => decodeJsonGraph(fixture), Error, "Backup data.works must be an array");
	}
});

Deno.test("JSON codec preserves permissive legacy defaults and envelope metadata", async () => {
	const legacy = await jsonGraphCodecFixture(0);
	delete legacy.knots;
	delete legacy.aliases;
	delete legacy.emergenceFeedback;
	delete legacy.savedRuleQueries;
	const decoded = decodeJsonGraph(legacy);
	assertEquals(decoded.data.knots, []);
	assertEquals(decoded.data.aliases, []);
	assertEquals(decoded.data.emergenceFeedback, {});
	assertEquals(decoded.data.savedRuleQueries, []);
	const input = await jsonGraphCodecFixture(8);
	delete input.exportedAt;
	delete input.appVersion;
	delete input.source;
	assertEquals(decodeJsonGraph(input).data, await expectedJsonGraphFixture(8));
});
