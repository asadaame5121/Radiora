import { expect, test } from "vitest";
import {
	COMMAND_DEFINITIONS,
	commandAvailability,
	type CommandContext,
	dispatchCommand,
	normalizeShortcut,
	validateShortcuts,
} from "../../../src/ui/command_service.ts";

const context = (overrides: Partial<CommandContext> = {}): CommandContext => ({
	startupReady: true,
	selectedOccurrenceId: "occurrence-1",
	hasSelectedBranch: true,
	hasSelectedRecoverySnapshot: true,
	canOpenLinkEditor: true,
	quickCaptureText: "capture",
	quickCaptureSubmitting: false,
	ruleSource: "?- item(X).",
	ruleName: "all items",
	isHoisted: true,
	...overrides,
});

test("command applicability returns one authoritative disabled reason", () => {
	const availability = commandAvailability(
		context({ selectedOccurrenceId: null, quickCaptureText: "" }),
	);
	expect(availability.quickCapture).toEqual({
		enabled: false,
		reason: "クイック入力の本文を入力してください。",
	});
	expect(availability.hoist).toEqual({ enabled: false, reason: "メモを選択してください。" });
	expect(availability.createLink).toEqual({ enabled: false, reason: "メモを選択してください。" });
	expect(commandAvailability(context({ isHoisted: false })).clearHoist).toEqual({
		enabled: false,
		reason: "フォーカス中ではありません。",
	});
	expect(commandAvailability(context({ hasSelectedRecoverySnapshot: false })).saveRevision).toEqual(
		{
			enabled: false,
			reason: "保存する復元ポイントを選択してください。",
		},
	);
	expect(commandAvailability(context({ hasSelectedBranch: false })).createBranch).toEqual({
		enabled: false,
		reason: "別稿を作る元の作業中の本文を選択してください。",
	});
	expect(commandAvailability(context()).createBranch).toEqual({ enabled: true });
});

test("shortcut normalization rejects empty, malformed, and conflicting bindings", () => {
	expect(normalizeShortcut(" shift + ctrl + q ")).toEqual("Ctrl+Shift+Q");
	expect(normalizeShortcut("Ctrl")).toEqual(null);
	const result = validateShortcuts([
		{ commandId: "runQuery", shortcut: "ctrl+shift+q" },
		{ commandId: "saveQuery", shortcut: "Ctrl+Shift+Q" },
		{ commandId: "hoist", shortcut: "" },
	]);
	expect(result.bindings).toEqual([{ commandId: "runQuery", shortcut: "Ctrl+Shift+Q" }]);
	expect(result.errors.length).toEqual(2);
});

test("dispatching a disabled command has no side effects", async () => {
	let calls = 0;
	const result = await dispatchCommand("quickCapture", context({ quickCaptureText: "" }), () => {
		calls++;
	});
	expect(result.executed).toBe(false);
	expect(calls).toEqual(0);
});

for (const id of ["runQuery", "saveQuery"] as const) {
	test(`deprecated Query command cannot execute: ${id}`, async () => {
		let calls = 0;
		const result = await dispatchCommand(id, context(), () => {
			calls++;
		});
		expect(result.executed).toBe(false);
		expect(result.reason).toEqual("Queryは再評価のため利用を停止しています。");
		expect(calls).toEqual(0);
		expect(COMMAND_DEFINITIONS.find((command) => command.id === id)?.shortcut).toEqual(undefined);
	});
}

test("command metadata covers the shared primary actions", () => {
	expect(COMMAND_DEFINITIONS.map((command) => command.id)).toEqual([
		"quickCapture",
		"hoist",
		"startLongFormEditing",
		"clearHoist",
		"exportMarkdown",
		"addBookmark",
		"saveRevision",
		"createBranch",
		"createLink",
		"runQuery",
		"saveQuery",
		"goBack",
		"showOutline",
		"showTree",
		"returnToEditor",
		"focusSearch",
		"focusQuickCapture",
		"toggleSidebar",
		"collapseAll",
		"expandAll",
		"toggleCollapsed",
		"zoomOut",
		"removeOccurrence",
	]);
});

test("Markdown export is available only after startup is ready", () => {
	expect(commandAvailability(context()).exportMarkdown).toEqual({ enabled: true });
	expect(commandAvailability(context({ startupReady: false })).exportMarkdown).toEqual({
		enabled: false,
		reason: "起動の完了後に実行できます。",
	});
});
