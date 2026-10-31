import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("OutlineFilterBar extracts duplicate filter markup from TodayView and UnplacedInboxView", async () => {
	const read = (path: string) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
	const [todayView, unplacedView, filterBar, styles] = await Promise.all([
		read("src/ui/TodayView.svelte"),
		read("src/ui/UnplacedInboxView.svelte"),
		read("src/ui/OutlineFilterBar.svelte"),
		read("src/ui/styles.css"),
	]);

	expect(todayView).toMatch(/<OutlineFilterBar bind:outlineFilter onClear=\{onClearFilter\}\s*\/>/);
	expect(unplacedView).toMatch(
		/<OutlineFilterBar bind:outlineFilter onClear=\{onClearFilter\}\s*\/>/,
	);
	expect(todayView).not.toMatch(/class="filter-bar"/);
	expect(unplacedView).not.toMatch(/class="filter-bar"/);
	expect(todayView).toMatch(
		/matchesOutlineFilter\(entry\.representative\?\.text \?\? "", outlineFilter\)/,
	);
	expect(unplacedView).toMatch(/matchesOutlineFilter\(work\.text, outlineFilter\)/);
	expect(todayView).toMatch(/filteredCreated = \$derived/);
	expect(todayView).toMatch(/filteredUpdated = \$derived/);
	expect(unplacedView).toMatch(/filteredWorks = \$derived/);

	expect(filterBar).toMatch(
		/自由語は部分一致 · タグはすべて含む（AND） · NOTタグは除外 · この表示だけに適用/,
	);
	expect(filterBar).toMatch(/aria-label="テキストで絞り込み"/);
	expect(filterBar).toMatch(/placeholder="テキストで絞り込み…"/);
	expect(filterBar).toMatch(/aria-label="タグ AND"/);
	expect(filterBar).toMatch(/placeholder="#タグ AND"/);
	expect(filterBar).toMatch(/aria-label="タグ NOT"/);
	expect(filterBar).toMatch(/placeholder="#除外 NOT"/);
	expect(filterBar).toMatch(/<button\b[^>]*type="button"[^>]*>解除<\/button>/);
	expect(filterBar).toMatch(/disabled=\{!filterActive\}/);
	expect(filterBar).toMatch(/<style>[\s\S]*\.filter-bar[\s\S]*<\/style>/);
	expect(styles).not.toMatch(/\.filter-bar\s*\{/);
	expect(styles).not.toMatch(/\.filter-hint\s*\{/);
	expect(styles).not.toMatch(/\.filter-input\s*\{/);
});
