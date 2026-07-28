import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import { DEFAULT_UI_VOCABULARY } from "../src/shared/ui_vocabulary.ts";
import {
	COMMAND_DEFINITIONS,
	type CommandContext,
	dispatchCommand,
} from "../src/ui/command_service.ts";
import { commandPaletteItems, nextCommandPaletteIndex } from "../src/ui/command_palette.ts";

const context = (overrides: Partial<CommandContext> = {}): CommandContext => ({
	startupReady: true,
	selectedOccurrenceId: "occurrence-1",
	hasSelectedBranch: true,
	hasSelectedRecoverySnapshot: true,
	hasLinkTarget: true,
	quickCaptureText: "本文",
	quickCaptureSubmitting: false,
	ruleSource: '?- link("LIKE", From, To).',
	ruleName: "検索",
	isHoisted: false,
	...overrides,
});

Deno.test("command palette searches command labels while retaining every command for an empty query", () => {
	assertEquals(
		commandPaletteItems("", context(), DEFAULT_UI_VOCABULARY).map((command) => command.id),
		COMMAND_DEFINITIONS.map((command) => command.id),
	);
	assertEquals(
		commandPaletteItems("クイック", context(), DEFAULT_UI_VOCABULARY).map((command) => command.id),
		["quickCapture"],
	);
});

Deno.test("command palette selection wraps with arrow-key offsets", () => {
	assertEquals(nextCommandPaletteIndex(0, -1, 3), 2);
	assertEquals(nextCommandPaletteIndex(2, 1, 3), 0);
	assertEquals(nextCommandPaletteIndex(0, 1, 0), -1);
});

Deno.test("command palette exposes command-service disabled reasons", () => {
	const [quickCapture] = commandPaletteItems(
		"クイック",
		context({ quickCaptureText: "" }),
		DEFAULT_UI_VOCABULARY,
	);
	assertEquals(quickCapture.availability, {
		enabled: false,
		reason: "クイック入力の本文を入力してください。",
	});
});

Deno.test("command palette cannot dispatch a revision save without a selected recovery snapshot", async () => {
	const [saveRevision] = commandPaletteItems(
		"版として残す",
		context({
			hasSelectedRecoverySnapshot: false,
		}),
		DEFAULT_UI_VOCABULARY,
	);
	assertEquals(saveRevision.availability, {
		enabled: false,
		reason: "保存する復元用保存を選択してください。",
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
	assertFalse(result.executed);
	assertEquals(calls, 0);
});
