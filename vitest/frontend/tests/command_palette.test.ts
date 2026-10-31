import { expect, test } from "vitest";
import { DEFAULT_UI_VOCABULARY } from "../../../src/shared/ui_vocabulary.ts";
import {
	COMMAND_DEFINITIONS,
	type CommandContext,
	dispatchCommand,
} from "../../../src/ui/command_service.ts";
import { commandPaletteItems } from "../../../src/ui/command_palette.ts";

const context = (overrides: Partial<CommandContext> = {}): CommandContext => ({
	startupReady: true,
	selectedOccurrenceId: "occurrence-1",
	hasSelectedBranch: true,
	hasSelectedRecoverySnapshot: true,
	canOpenLinkEditor: true,
	quickCaptureText: "本文",
	quickCaptureSubmitting: false,
	ruleSource: '?- link("LIKE", From, To).',
	ruleName: "検索",
	isHoisted: false,
	...overrides,
});

test("command palette searches command labels while retaining active commands for an empty query", () => {
	expect(
		commandPaletteItems("", context(), DEFAULT_UI_VOCABULARY).map((command) => command.id),
	).toEqual(
		COMMAND_DEFINITIONS.filter((command) => !command.deprecated).map((command) => command.id),
	);
	expect(
		commandPaletteItems("クイック", context(), DEFAULT_UI_VOCABULARY).map((command) => command.id),
	).toEqual(["quickCapture", "focusQuickCapture"]);
});

test("command palette exposes command-service disabled reasons", () => {
	const [quickCapture] = commandPaletteItems(
		"クイック",
		context({ quickCaptureText: "" }),
		DEFAULT_UI_VOCABULARY,
	);
	expect(quickCapture.availability).toEqual({
		enabled: false,
		reason: "クイック入力の本文を入力してください。",
	});
});

test("command palette omits deprecated Query execution and saving", () => {
	const items = commandPaletteItems("", context(), DEFAULT_UI_VOCABULARY);
	expect(items.some((command) => command.id === "runQuery" || command.id === "saveQuery")).toBe(
		false,
	);
});

test("command palette includes Markdown export", () => {
	const [exportMarkdown] = commandPaletteItems("Markdown", context(), DEFAULT_UI_VOCABULARY);
	expect(exportMarkdown.id).toEqual("exportMarkdown");
	expect(exportMarkdown.label).toEqual("Markdownでエクスポート");
	expect(exportMarkdown.availability).toEqual({ enabled: true });
});

test("command palette cannot dispatch a revision save without a selected recovery snapshot", async () => {
	const [saveRevision] = commandPaletteItems(
		"バージョンとして保存",
		context({
			hasSelectedRecoverySnapshot: false,
		}),
		DEFAULT_UI_VOCABULARY,
	);
	expect(saveRevision.availability).toEqual({
		enabled: false,
		reason: "保存する復元ポイントを選択してください。",
	});
	let calls = 0;
	const result = await dispatchCommand(
		"saveRevision",
		context({
			hasSelectedRecoverySnapshot: false,
		}),
		() => {
			calls++;
		},
	);
	expect(result.executed).toBe(false);
	expect(calls).toEqual(0);
});
