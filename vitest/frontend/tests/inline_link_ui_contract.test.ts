import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("@ semantic relation search finds Works before selecting type and direction", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const controller = await readFile(
		new URL("../../../src/ui/editor_completion_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const service = await readFile(
		new URL("../../../src/services/inline_link.ts", import.meta.url),
		"utf8",
	);
	const helpers = await readFile(
		new URL("../../../src/ui/inline_link_completion.ts", import.meta.url),
		"utf8",
	);
	const completionView = await readFile(
		new URL("../../../src/ui/InlineLinkCompletion.svelte", import.meta.url),
		"utf8",
	);

	const outlineRowItem = await readFile(
		new URL("../../../src/ui/OutlineRowItem.svelte", import.meta.url),
		"utf8",
	);

	expect(controller).toMatch(/findInlineLinkTrigger/);
	expect(controller).toMatch(/ports\.api\.listInternalReferenceCompletions\(query, LINK_LIMIT\)/);
	expect(controller).toMatch(/filterInlineLinkCandidates/);
	expect(controller).toMatch(/isSameInlineLinkTrigger/);
	expect(controller).toMatch(/phase: "candidate"/);
	expect(controller).toMatch(/phase: "type"/);
	expect(controller).toMatch(/phase: "direction"/);
	expect(outlineRowItem).toMatch(/<InlineLinkCompletion/);
	expect(completionView).toMatch(/inline-link-omniwindow/);
	expect(app).toMatch(/updateInlineLinkSearch/);
	expect(completionView).toMatch(/Shift\+Enterで新規作成できます/);
	expect(controller).toMatch(/event\.key === "Enter" &&\s*event\.shiftKey/);
	expect(completionView).toMatch(/activeIndex === completion\.candidates\.length/);
	expect(controller).toMatch(/ports\.api\.quickCapture\(query\)/);
	expect(controller).toMatch(/isSymmetricType\(state\.selectedType/);
	expect(completionView).toMatch(/previewDirection\(/);
	expect(controller).toMatch(/ports\.api\.createLink\(\{ fromId, toId, type/);
	const commit = controller.slice(
		controller.indexOf("async function commitInlineLink"),
		controller.indexOf("function applyInternalReferenceCompletion"),
	);
	expect(commit).toMatch(/ports\.requestFocus\(item\.id, state\.range\.start\)/);
	expect(commit).toMatch(
		/textarea\.setRangeText\("", state\.range\.start, state\.range\.end, current \? "end" : "preserve"\)/,
	);
	if (commit.includes("canonicalInternalReferenceMarkdown")) {
		throw new Error("Semantic Relation completion must not create a Markdown Internal Reference");
	}
	expect(service).toMatch(/fenced blocks/);
	expect(helpers).toMatch(/inlineLinkCandidateFromCreated/);
	expect(completionView).toMatch(/\.inline-link-completions/);
	expect(completionView).toMatch(/\.inline-link-direction/);
});

test("@ semantic relation search offers OmniWindow creation for unresolved targets", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const controller = await readFile(
		new URL("../../../src/ui/editor_completion_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const helpers = await readFile(
		new URL("../../../src/ui/inline_link_completion.ts", import.meta.url),
		"utf8",
	);
	expect(controller).toMatch(/filterInlineLinkCandidates/);
	expect(controller).toMatch(/function createInlineLinkTarget/);
	expect(controller).toMatch(/ports\.api\.quickCapture\(query\)/);
	expect(helpers).toMatch(/scopeLabel: "未配置"/);
	expect(
		!/ports\.api\.(createItem|createOccurrence|createStub)\(query/.test(controller),
	).toBeTruthy();
	expect(app).toMatch(/editorController\.createInlineLinkTarget/);
});
