import { assert, assertMatch } from "jsr:@std/assert@1";

Deno.test("@ semantic relation search finds Works before selecting type and direction", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const controller = await Deno.readTextFile(
		new URL("../src/ui/editor_controller.svelte.ts", import.meta.url),
	);
	const service = await Deno.readTextFile(
		new URL("../src/services/inline_link.ts", import.meta.url),
	);
	const completionView = await Deno.readTextFile(
		new URL("../src/ui/InlineLinkCompletion.svelte", import.meta.url),
	);

	assertMatch(controller, /findInlineLinkTrigger/);
	assertMatch(controller, /ports\.api\.listInternalReferenceCompletions\(trigger\.query, 16\)/);
	assertMatch(controller, /filterInlineLinkCandidates/);
	assertMatch(controller, /isSameInlineLinkTrigger/);
	assertMatch(controller, /phase: "candidate"/);
	assertMatch(controller, /phase: "type"/);
	assertMatch(controller, /phase: "direction"/);
	assertMatch(app, /<InlineLinkCompletion/);
	assertMatch(completionView, /inline-link-omniwindow/);
	assertMatch(app, /updateInlineLinkSearch/);
	assertMatch(completionView, /Shift\+Enterで新規作成できます/);
	assertMatch(controller, /event\.key === "Enter" && event\.shiftKey/);
	assertMatch(completionView, /activeIndex === completion\.candidates\.length/);
	assertMatch(controller, /ports\.api\.quickCapture\(query\)/);
	assertMatch(controller, /isSymmetricLinkType\(state\.selectedType\)/);
	assertMatch(completionView, /previewDirection\(/);
	assertMatch(controller, /ports\.api\.createLink\(\{ fromId, toId, type/);
	const commit = controller.slice(
		controller.indexOf("async function commitInlineLink"),
		controller.indexOf("function applyInternalReferenceCompletion"),
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
	assertMatch(completionView, /\.inline-link-completions/);
	assertMatch(completionView, /\.inline-link-direction/);
});

Deno.test("@ semantic relation search offers OmniWindow creation for unresolved targets", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const controller = await Deno.readTextFile(
		new URL("../src/ui/editor_controller.svelte.ts", import.meta.url),
	);
	assertMatch(controller, /filterInlineLinkCandidates/);
	assertMatch(controller, /function createInlineLinkTarget/);
	assertMatch(controller, /ports\.api\.quickCapture\(query\)/);
	assertMatch(controller, /scopeLabel: "未配置"/);
	assert(!/ports\.api\.(createItem|createOccurrence|createStub)\(query/.test(controller));
	assertMatch(app, /editorController\.createInlineLinkTarget/);
});
