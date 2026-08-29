import { assert, assertMatch } from "jsr:@std/assert@1";

Deno.test("version comparison UI keeps arbitrary selectors and independent scroll panes", async () => {
	const component = await Deno.readTextFile(
		new URL("../src/ui/RevisionComparison.svelte", import.meta.url),
	);
	const pane = await Deno.readTextFile(
		new URL("../src/ui/ComparisonPane.svelte", import.meta.url),
	);
	const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));

	assertMatch(component, /<ComparisonPane/);
	assertMatch(component, /chooseInitialRevisionComparison/);
	assertMatch(pane, /selectLeft\(event\.currentTarget\.value\)/);
	assertMatch(pane, /selectRight\(event\.currentTarget\.value\)/);
	assert(pane.includes('data-comparison-pane="left"'));
	assert(pane.includes('data-comparison-pane="right"'));
	assertMatch(pane, /\.comparison-scroll\s*\{[^}]*overflow:\s*auto/s);
});
