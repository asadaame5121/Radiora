import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("FROM FIX VS Revision and Branch use one read-only comparison pane", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const controller = await readFile(
		new URL("../../../src/ui/comparison_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const linkEditor = await readFile(
		new URL("../../../src/ui/LinkEditor.svelte", import.meta.url),
		"utf8",
	);
	const pane = await readFile(
		new URL("../../../src/ui/ComparisonPane.svelte", import.meta.url),
		"utf8",
	);
	const revision = await readFile(
		new URL("../../../src/ui/RevisionComparison.svelte", import.meta.url),
		"utf8",
	);
	const lineage = await readFile(
		new URL("../../../src/ui/WorkLineage.svelte", import.meta.url),
		"utf8",
	);

	expect(controller).toMatch(/resolveLinkComparison\(target\.linkId\)/);
	expect(linkEditor).toMatch(/isComparableLinkType\(link\.type\)/);
	expect(controller).toMatch(/listWorkComparisonDocuments/);
	expect(app).toMatch(/<ComparisonPane/);
	expect(revision).toMatch(/<ComparisonPane/);
	expect(lineage).toMatch(/onCompare\("branch", branch\.id\)/);
	expect(lineage).toMatch(/onCompare\("revision", revision\.id\)/);
	expect(pane).toMatch(/context\.type === "FROM"/);
	expect(pane).toMatch(/context\.type === "FIX"/);
	expect(pane).toMatch(/↔ VS ↔/);
	expect(pane).toMatch(/showDiff.*scope === "revision"/);
});

test("comparison entry points invalidate stale async responses before opening", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const controller = await readFile(
		new URL("../../../src/ui/comparison_controller.svelte.ts", import.meta.url),
		"utf8",
	);

	expect(app).toMatch(/comparison\.openRevision\(/);
	expect(app).toMatch(/comparison\.openWork\(scope, id\)/);
	expect(app).toMatch(/comparison\.openLink\(link\.id\)/);
	expect(controller).toMatch(/openRevision\(revisionId: string\)/);
	expect(controller).toMatch(/this\.ports\.navigation\.navigate/);
	const navigation = await readFile(
		new URL("../../../src/ui/screen_navigation_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	expect(navigation).toMatch(/request === this\.request/);
});

test("comparison UI uses UiVocabulary and has no persistence calls", async () => {
	const pane = await readFile(
		new URL("../../../src/ui/ComparisonPane.svelte", import.meta.url),
		"utf8",
	);
	const vocabulary = await readFile(
		new URL("../../../src/shared/ui_vocabulary.ts", import.meta.url),
		"utf8",
	);

	expect(pane).toMatch(/useUiVocabulary\(\)/);
	expect(pane).toMatch(/vocabulary\.comparisonAdded/);
	expect(pane).toMatch(/vocabulary\.comparisonRemoved/);
	expect(pane).toMatch(/vocabulary\.comparisonUnchanged/);
	expect(pane).toMatch(/vocabulary\.unknownTime/);
	expect(vocabulary).toMatch(/comparisonPane: "比較"/);
	if (/api\.(create|update|delete|save|promote|restore)/.test(pane)) {
		throw new Error("ComparisonPane must remain read-only");
	}
});
