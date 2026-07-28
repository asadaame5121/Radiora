import { assert, assertMatch } from "jsr:@std/assert@1";

Deno.test("version comparison UI keeps arbitrary selectors and independent scroll panes", async () => {
	const component = await Deno.readTextFile(
		new URL("../src/ui/RevisionComparison.svelte", import.meta.url),
	);
	const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));

	assertMatch(component, /bind:value=\{leftRevisionId\}/);
	assertMatch(component, /bind:value=\{rightRevisionId\}/);
	assert(component.includes('data-comparison-pane="left"'));
	assert(component.includes('data-comparison-pane="right"'));
	assertMatch(styles, /\.comparison-scroll\s*\{[^}]*overflow:\s*auto/s);
});
