import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("version comparison UI keeps arbitrary selectors and independent scroll panes", async () => {
	const component = await readFile(
		new URL("../../../src/ui/RevisionComparison.svelte", import.meta.url),
		"utf8",
	);
	const pane = await readFile(
		new URL("../../../src/ui/ComparisonPane.svelte", import.meta.url),
		"utf8",
	);
	const styles = await readFile(new URL("../../../src/ui/styles.css", import.meta.url), "utf8");

	expect(component).toMatch(/<ComparisonPane/);
	expect(component).toMatch(/chooseInitialRevisionComparison/);
	expect(pane).toMatch(/selectLeft\(event\.currentTarget\.value\)/);
	expect(pane).toMatch(/selectRight\(event\.currentTarget\.value\)/);
	expect(pane.includes('data-comparison-pane="left"')).toBeTruthy();
	expect(pane.includes('data-comparison-pane="right"')).toBeTruthy();
	expect(pane).toMatch(/\.comparison-scroll\s*\{[^}]*overflow:\s*auto/s);
});
