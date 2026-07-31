import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
	COMMAND_DEFINITIONS,
	commandAvailability,
	type CommandContext,
	dispatchCommand,
	normalizeShortcut,
	validateShortcuts,
} from "../src/ui/command_service.ts";

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

Deno.test("command applicability returns one authoritative disabled reason", () => {
	const availability = commandAvailability(
		context({ selectedOccurrenceId: null, quickCaptureText: "" }),
	);
	assertEquals(availability.quickCapture, {
		enabled: false,
		reason: "クイック入力の本文を入力してください。",
	});
	assertEquals(availability.hoist, { enabled: false, reason: "項目を選択してください。" });
	assertEquals(availability.createLink, { enabled: false, reason: "項目を選択してください。" });
	assertEquals(commandAvailability(context({ isHoisted: false })).clearHoist, {
		enabled: false,
		reason: "絞り込み表示中ではありません。",
	});
	assertEquals(commandAvailability(context({ hasSelectedRecoverySnapshot: false })).saveRevision, {
		enabled: false,
		reason: "保存する復元用保存を選択してください。",
	});
	assertEquals(commandAvailability(context({ hasSelectedBranch: false })).createBranch, {
		enabled: false,
		reason: "別稿を作る元の作業中の本文を選択してください。",
	});
	assertEquals(commandAvailability(context()).createBranch, { enabled: true });
});

Deno.test("shortcut normalization rejects empty, malformed, and conflicting bindings", () => {
	assertEquals(normalizeShortcut(" shift + ctrl + q "), "Ctrl+Shift+Q");
	assertEquals(normalizeShortcut("Ctrl"), null);
	const result = validateShortcuts([
		{ commandId: "runQuery", shortcut: "ctrl+shift+q" },
		{ commandId: "saveQuery", shortcut: "Ctrl+Shift+Q" },
		{ commandId: "hoist", shortcut: "" },
	]);
	assertEquals(result.bindings, [{ commandId: "runQuery", shortcut: "Ctrl+Shift+Q" }]);
	assertEquals(result.errors.length, 2);
});

Deno.test("dispatching a disabled command has no side effects", async () => {
	let calls = 0;
	const result = await dispatchCommand("quickCapture", context({ quickCaptureText: "" }), () => {
		calls++;
	});
	assertFalse(result.executed);
	assertEquals(calls, 0);
});

Deno.test("command metadata covers the shared primary actions", () => {
	assertEquals(
		COMMAND_DEFINITIONS.map((command) => command.id),
		[
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
		],
	);
});

Deno.test("Markdown export is available only after startup is ready", () => {
	assertEquals(commandAvailability(context()).exportMarkdown, { enabled: true });
	assertEquals(commandAvailability(context({ startupReady: false })).exportMarkdown, {
		enabled: false,
		reason: "起動の完了後に実行できます。",
	});
});
