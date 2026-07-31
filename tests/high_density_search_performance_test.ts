import { assertEquals, assertLess } from "jsr:@std/assert@1";
import {
	createHighDensityGraphFixture,
	HIGH_DENSITY_LINK_COUNT,
	HIGH_DENSITY_MATCH_COUNT,
	HIGH_DENSITY_SEARCH_QUERY,
	HIGH_DENSITY_WORK_COUNT,
} from "./support/high_density_graph_fixture.ts";

Deno.test("searchItems preserves dense graph context within its performance budget", async () => {
	const fixture = await createHighDensityGraphFixture();
	assertEquals(fixture.items.length, HIGH_DENSITY_WORK_COUNT);
	assertEquals(fixture.links.length, HIGH_DENSITY_LINK_COUNT);
	const itemsBefore = structuredClone(await fixture.store.listItems());
	const linksBefore = structuredClone(await fixture.store.listLinks());

	const started = performance.now();
	const results = await fixture.service.searchItems({
		query: HIGH_DENSITY_SEARCH_QUERY,
		contextItemId: fixture.searchContext.id,
		limit: HIGH_DENSITY_MATCH_COUNT,
	});
	const elapsedMs = performance.now() - started;

	assertLess(elapsedMs, 1_500, `searchItems took ${elapsedMs.toFixed(1)}ms`);
	assertEquals(results.length, 50, "searchItems applies its public maximum result limit");
	for (const [index, result] of results.entries()) {
		const expected = fixture.matches[index];
		assertEquals(result.item.id, expected.id);
		assertEquals(result.ancestorIds, [
			fixture.roots[0].id,
			fixture.groups[Math.floor(index / 10)].id,
		]);
		assertEquals(result.score, 0.8500000000000001);
		assertEquals(result.reasons, [
			{ kind: "title", label: "タイトル一致", score: 2 },
			{ kind: "body", label: "本文一致", score: 4 },
			{ kind: "direct-link", label: "選択中の思索と直接接続", score: 1 },
		]);
	}
	assertEquals(await fixture.store.listItems(), itemsBefore);
	assertEquals(await fixture.store.listLinks(), linksBefore);
});
