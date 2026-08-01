import { assert, assertMatch } from "jsr:@std/assert@1";

Deno.test("@ inline links search Works before selecting type and direction", async () => {
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
	assertMatch(app, /canonicalInternalReferenceMarkdown\(`@\$\{candidate\.displayName\}`/);
	assertMatch(app, /replaceInlineLinkTrigger\(/);
	assertMatch(service, /fenced blocks/);
	assertMatch(styles, /\.inline-link-completions/);
	assertMatch(styles, /\.inline-link-direction/);
});

Deno.test("@ inline links do not reuse revision candidates or auto-create unresolved nodes", async () => {
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
