import { assertMatch } from "jsr:@std/assert@1";

Deno.test("FROM FIX VS Revision and Branch use one read-only comparison pane", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const controller = await Deno.readTextFile(
		new URL("../src/ui/comparison_controller.svelte.ts", import.meta.url),
	);
	const linkEditor = await Deno.readTextFile(
		new URL("../src/ui/LinkEditor.svelte", import.meta.url),
	);
	const pane = await Deno.readTextFile(
		new URL("../src/ui/ComparisonPane.svelte", import.meta.url),
	);
	const revision = await Deno.readTextFile(
		new URL("../src/ui/RevisionComparison.svelte", import.meta.url),
	);
	const lineage = await Deno.readTextFile(
		new URL("../src/ui/WorkLineage.svelte", import.meta.url),
	);

	assertMatch(controller, /resolveLinkComparison\(linkId\)/);
	assertMatch(linkEditor, /isComparableLinkType\(link\.type\)/);
	assertMatch(controller, /listWorkComparisonDocuments/);
	assertMatch(app, /<ComparisonPane/);
	assertMatch(revision, /<ComparisonPane/);
	assertMatch(lineage, /onCompare\("branch", branch\.id\)/);
	assertMatch(lineage, /onCompare\("revision", revision\.id\)/);
	assertMatch(pane, /context\.type === "FROM"/);
	assertMatch(pane, /context\.type === "FIX"/);
	assertMatch(pane, /↔ VS ↔/);
	assertMatch(pane, /showDiff.*scope === "revision"/);
});

Deno.test("comparison entry points clear stale context and ignore stale async responses", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const controller = await Deno.readTextFile(
		new URL("../src/ui/comparison_controller.svelte.ts", import.meta.url),
	);

	assertMatch(app, /comparison\.openRevision\(revisionId\)/);
	assertMatch(app, /comparison\.openWork\(scope, id\)/);
	assertMatch(app, /comparison\.openLink\(link\.id\)/);
	assertMatch(controller, /openRevision\(revisionId: string\)/);
	assertMatch(controller, /const request = this\.clear\(\)/);
	assertMatch(controller, /request !== this\.request/);
});

Deno.test("comparison UI uses UiVocabulary and has no persistence calls", async () => {
	const pane = await Deno.readTextFile(
		new URL("../src/ui/ComparisonPane.svelte", import.meta.url),
	);
	const vocabulary = await Deno.readTextFile(
		new URL("../src/shared/ui_vocabulary.ts", import.meta.url),
	);

	assertMatch(pane, /useUiVocabulary\(\)/);
	assertMatch(pane, /vocabulary\.comparisonAdded/);
	assertMatch(pane, /vocabulary\.comparisonRemoved/);
	assertMatch(pane, /vocabulary\.comparisonUnchanged/);
	assertMatch(pane, /vocabulary\.unknownTime/);
	assertMatch(vocabulary, /comparisonPane: "比較"/);
	if (/api\.(create|update|delete|save|promote|restore)/.test(pane)) {
		throw new Error("ComparisonPane must remain read-only");
	}
});
