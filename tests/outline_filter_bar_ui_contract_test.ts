import { assertMatch, assertNotMatch } from "jsr:@std/assert@1";

Deno.test("OutlineFilterBar extracts duplicate filter markup from TodayView and UnplacedInboxView", async () => {
	const read = (path: string) => Deno.readTextFile(new URL(`../${path}`, import.meta.url));
	const [todayView, unplacedView, filterBar, styles] = await Promise.all([
		read("src/ui/TodayView.svelte"),
		read("src/ui/UnplacedInboxView.svelte"),
		read("src/ui/OutlineFilterBar.svelte"),
		read("src/ui/styles.css"),
	]);

	assertMatch(todayView, /<OutlineFilterBar bind:outlineFilter onClear=\{onClearFilter\}\s*\/>/);
	assertMatch(unplacedView, /<OutlineFilterBar bind:outlineFilter onClear=\{onClearFilter\}\s*\/>/);
	assertNotMatch(todayView, /class="filter-bar"/);
	assertNotMatch(unplacedView, /class="filter-bar"/);
	assertMatch(
		todayView,
		/matchesOutlineFilter\(entry\.representative\?\.text \?\? "", outlineFilter\)/,
	);
	assertMatch(unplacedView, /matchesOutlineFilter\(work\.text, outlineFilter\)/);
	assertMatch(todayView, /filteredCreated = \$derived/);
	assertMatch(todayView, /filteredUpdated = \$derived/);
	assertMatch(unplacedView, /filteredWorks = \$derived/);

	assertMatch(
		filterBar,
		/自由語は部分一致 · タグはすべて含む（AND） · NOTタグは除外 · この表示だけに適用/,
	);
	assertMatch(filterBar, /aria-label="テキストで絞り込み"/);
	assertMatch(filterBar, /placeholder="テキストで絞り込み…"/);
	assertMatch(filterBar, /aria-label="タグ AND"/);
	assertMatch(filterBar, /placeholder="#タグ AND"/);
	assertMatch(filterBar, /aria-label="タグ NOT"/);
	assertMatch(filterBar, /placeholder="#除外 NOT"/);
	assertMatch(filterBar, /<button\b[^>]*type="button"[^>]*>解除<\/button>/);
	assertMatch(filterBar, /disabled=\{!filterActive\}/);
	assertMatch(filterBar, /<style>[\s\S]*\.filter-bar[\s\S]*<\/style>/);
	assertNotMatch(styles, /\.filter-bar\s*\{/);
	assertNotMatch(styles, /\.filter-hint\s*\{/);
	assertNotMatch(styles, /\.filter-input\s*\{/);
});
