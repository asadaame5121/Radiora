import { assert, assertMatch } from "jsr:@std/assert@1";

Deno.test("@ semantic relation search finds Works before selecting type and direction", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const service = await Deno.readTextFile(
		new URL("../src/services/inline_link.ts", import.meta.url),
	);
	const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));

	assertMatch(app, /findInlineLinkTrigger/);
	assertMatch(app, /api\.listInternalReferenceCompletions\(trigger\.query, 16\)/);
	assertMatch(app, /\.filter\(\(candidate\) => candidate\.scope === "work"\)/);
	assertMatch(app, /phase: "candidate"/);
	assertMatch(app, /phase: "type"/);
	assertMatch(app, /phase: "direction"/);
	assertMatch(app, /isSymmetricLinkType\(state\.selectedType\)/);
	assertMatch(app, /previewDirection\(/);
	assertMatch(app, /api\.createLink\(\{ fromId, toId, type/);
	const commit = app.slice(
		app.indexOf("async function commitInlineLink"),
		app.indexOf("async function applyInternalReferenceCompletion"),
	);
	assertMatch(commit, /replaceInlineLinkTrigger\(textarea\.value, state\.range, ""\)/);
	assertMatch(
		commit,
		/textarea\.setRangeText\("", state\.range\.start, state\.range\.end, "end"\)/,
	);
	if (commit.includes("canonicalInternalReferenceMarkdown")) {
		throw new Error("Semantic Relation completion must not create a Markdown Internal Reference");
	}
	assertMatch(service, /fenced blocks/);
	assertMatch(styles, /\.inline-link-completions/);
	assertMatch(styles, /\.inline-link-direction/);
});

Deno.test("@ semantic relation search excludes revisions and unresolved auto-creation", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	assertMatch(app, /\.filter\(\(candidate\) => candidate\.scope === "work"\)/);
	assert(
		!/api\.(createItem|createOccurrence|quickCapture|createStub)\(/.test(
			app.slice(
				app.indexOf("async function updateInlineLinkCompletion"),
				app.indexOf("function selectInlineLinkCandidate"),
			),
		),
	);
});
