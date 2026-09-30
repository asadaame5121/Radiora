import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { jsonGraphCodecFixture } from "./support/json_graph_codec_fixture.ts";
import { JsonGraphStore } from "../src/storage/json_store.ts";

for (let version = 0; version <= 8; version++) {
	Deno.test(`JSON initialize V${version} protects exact input and preserves existing protection`, async () => {
		const directory = await Deno.makeTempDir();
		const path = `${directory}/graph.json`;
		const input = JSON.stringify(await jsonGraphCodecFixture(version), null, 1);
		try {
			await Deno.writeTextFile(path, input);
			const store = new JsonGraphStore(new URL(`file://${path}`));
			await store.initialize();
			const state = await store.exportGraphState();
			if (version === 8) {
				assertEquals(await Deno.readTextFile(path), input);
				assertEquals(Array.from(Deno.readDirSync(directory)).map((entry) => entry.name), [
					"graph.json",
				]);
			} else {
				assertEquals(await Deno.readTextFile(`${path}.v${version}.bak`), input);
				assertEquals(JSON.parse(await Deno.readTextFile(path)).schemaVersion, 8);
				await Deno.writeTextFile(`${path}.v${version}.bak`, "existing protected input");
				await Deno.writeTextFile(path, input);
				await new JsonGraphStore(path).initialize();
				assertEquals(
					await Deno.readTextFile(`${path}.v${version}.bak`),
					"existing protected input",
				);
			}
			const reopened = new JsonGraphStore(path);
			await reopened.initialize();
			assertEquals(await reopened.exportGraphState(), state);
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});
}

Deno.test("JSON initialize rejects broken input before altering memory, disk or protection files", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new JsonGraphStore(path);
		await Deno.writeTextFile(path, JSON.stringify(await jsonGraphCodecFixture(8)));
		await store.initialize();
		const before = await store.exportGraphState();
		const brokenInputs = [
			"{",
			"null",
			"42",
			"[]",
			"{}",
			JSON.stringify({ format: "radiora-backup", schemaVersion: 9 }),
		];
		for (let version = 0; version <= 8; version++) {
			const fixture = await jsonGraphCodecFixture(version);
			if (version === 0) fixture.items = {};
			else fixture.data.works = {};
			brokenInputs.push(JSON.stringify(fixture));
		}
		for (const input of brokenInputs) {
			await Deno.writeTextFile(path, input);
			await assertRejects(() => store.initialize(), Error);
			assertEquals(await store.exportGraphState(), before);
			assertEquals(await Deno.readTextFile(path), input);
			assertEquals(Array.from(Deno.readDirSync(directory)).map((entry) => entry.name), [
				"graph.json",
			]);
		}
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
