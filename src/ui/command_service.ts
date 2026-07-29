import type { UiVocabulary } from "../shared/ui_vocabulary.ts";

/** A command's state is deliberately UI-neutral so buttons and shortcuts agree. */
export interface CommandContext {
	startupReady: boolean;
	selectedOccurrenceId: string | null;
	hasSelectedBranch: boolean;
	hasSelectedRecoverySnapshot: boolean;
	canOpenLinkEditor: boolean;
	quickCaptureText: string;
	quickCaptureSubmitting: boolean;
	ruleSource: string;
	ruleName: string;
	isHoisted: boolean;
}

export type CommandId =
	| "quickCapture"
	| "hoist"
	| "clearHoist"
	| "exportMarkdown"
	| "addBookmark"
	| "saveRevision"
	| "createBranch"
	| "createLink"
	| "runQuery"
	| "saveQuery";

export interface CommandAvailability {
	enabled: boolean;
	reason?: string;
}

export interface CommandDefinition {
	id: CommandId;
	label: (vocabulary: UiVocabulary) => string;
	shortcut?: string;
	availability: (context: CommandContext) => CommandAvailability;
}

const ready = (context: CommandContext): CommandAvailability =>
	context.startupReady
		? { enabled: true }
		: { enabled: false, reason: "起動の完了後に実行できます。" };

const selection = (context: CommandContext): CommandAvailability =>
	!context.selectedOccurrenceId
		? { enabled: false, reason: "項目を選択してください。" }
		: ready(context);

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
	{
		id: "quickCapture",
		label: (vocabulary) => vocabulary.quickCapture,
		shortcut: "Ctrl+Shift+Enter",
		availability: (context) =>
			!ready(context).enabled
				? ready(context)
				: context.quickCaptureSubmitting
				? { enabled: false, reason: "クイック入力を保存しています。" }
				: context.quickCaptureText.trim()
				? { enabled: true }
				: { enabled: false, reason: "クイック入力の本文を入力してください。" },
	},
	{
		id: "hoist",
		label: (vocabulary) => vocabulary.hoist,
		shortcut: "Ctrl+Shift+H",
		availability: selection,
	},
	{
		id: "clearHoist",
		label: (vocabulary) => `${vocabulary.hoist}を解除`,
		availability: (context) =>
			!context.isHoisted
				? { enabled: false, reason: "絞り込み表示中ではありません。" }
				: ready(context),
	},
	{
		id: "exportMarkdown",
		label: () => "Markdownでエクスポート",
		availability: ready,
	},
	{
		id: "addBookmark",
		label: (vocabulary) => vocabulary.bookmark,
		shortcut: "Ctrl+Shift+B",
		availability: selection,
	},
	{
		id: "saveRevision",
		label: (vocabulary) => `${vocabulary.revision}として残す`,
		availability: (context) =>
			!selection(context).enabled
				? selection(context)
				: !context.hasSelectedBranch
				? { enabled: false, reason: "保存対象の別稿を選択してください。" }
				: !context.hasSelectedRecoverySnapshot
				? { enabled: false, reason: "保存する復元用保存を選択してください。" }
				: { enabled: true },
	},
	{
		id: "createBranch",
		label: (vocabulary) => `新しい${vocabulary.branch}`,
		availability: (context) =>
			!selection(context).enabled
				? selection(context)
				: !context.hasSelectedBranch
				? { enabled: false, reason: "別稿を作る元の作業中の本文を選択してください。" }
				: { enabled: true },
	},
	{
		id: "createLink",
		label: (vocabulary) => `${vocabulary.semanticLink}を追加`,
		shortcut: "Ctrl+Shift+L",
		availability: (context) =>
			!selection(context).enabled
				? selection(context)
				: !context.canOpenLinkEditor
				? { enabled: false, reason: "リンクを追加する項目を選択してください。" }
				: { enabled: true },
	},
	{
		id: "runQuery",
		label: (vocabulary) => `${vocabulary.query}を実行`,
		shortcut: "Ctrl+Shift+Q",
		availability: (context) =>
			!ready(context).enabled
				? ready(context)
				: context.ruleSource.trim()
				? { enabled: true }
				: { enabled: false, reason: "Query を入力してください。" },
	},
	{
		id: "saveQuery",
		label: (vocabulary) => `${vocabulary.query}を保存`,
		availability: (context) =>
			!ready(context).enabled
				? ready(context)
				: !context.ruleSource.trim()
				? { enabled: false, reason: "Query を入力してください。" }
				: !context.ruleName.trim()
				? { enabled: false, reason: "保存名を入力してください。" }
				: { enabled: true },
	},
] as const;

export function commandAvailability(
	context: CommandContext,
	definitions = COMMAND_DEFINITIONS,
): Readonly<Record<CommandId, CommandAvailability>> {
	return Object.fromEntries(
		definitions.map((command) => [command.id, command.availability(context)]),
	) as Record<
		CommandId,
		CommandAvailability
	>;
}

export async function dispatchCommand(
	id: CommandId,
	context: CommandContext,
	execute: (id: CommandId) => Promise<void> | void,
	definitions = COMMAND_DEFINITIONS,
): Promise<{ executed: boolean; reason?: string }> {
	const command = definitions.find((candidate) => candidate.id === id);
	if (!command) return { executed: false, reason: "未定義のコマンドです。" };
	const availability = command.availability(context);
	if (!availability.enabled) return { executed: false, reason: availability.reason };
	await execute(id);
	return { executed: true };
}

export interface ShortcutBinding {
	commandId: CommandId;
	shortcut: string;
}

export interface ShortcutValidation {
	bindings: readonly ShortcutBinding[];
	errors: readonly string[];
}

const MODIFIERS: Record<string, string> = {
	ctrl: "Ctrl",
	control: "Ctrl",
	alt: "Alt",
	shift: "Shift",
	meta: "Meta",
	cmd: "Meta",
	command: "Meta",
};

export function normalizeShortcut(value: string): string | null {
	const parts = value.trim().split("+").map((part) => part.trim()).filter(Boolean);
	if (parts.length < 2) return null;
	const key = parts.pop()!;
	const modifiers = new Set<string>();
	for (const part of parts) {
		const modifier = MODIFIERS[part.toLowerCase()];
		if (!modifier) return null;
		modifiers.add(modifier);
	}
	if (modifiers.size === 0 || !key) return null;
	const normalizedKey = key.length === 1
		? key.toUpperCase()
		: key[0].toUpperCase() + key.slice(1).toLowerCase();
	return [
		...["Ctrl", "Alt", "Shift", "Meta"].filter((modifier) => modifiers.has(modifier)),
		normalizedKey,
	].join("+");
}

export function validateShortcuts(bindings: readonly ShortcutBinding[]): ShortcutValidation {
	const seen = new Map<string, CommandId>();
	const valid: ShortcutBinding[] = [];
	const errors: string[] = [];
	for (const binding of bindings) {
		const shortcut = normalizeShortcut(binding.shortcut);
		if (!shortcut) {
			errors.push(`${binding.commandId}: ショートカットが空または不正です。`);
			continue;
		}
		const conflict = seen.get(shortcut);
		if (conflict) {
			errors.push(`${binding.commandId}: ${shortcut} は ${conflict} と重複しています。`);
			continue;
		}
		seen.set(shortcut, binding.commandId);
		valid.push({ commandId: binding.commandId, shortcut });
	}
	return { bindings: valid, errors };
}

export function shortcutForKeyboardEvent(event: KeyboardEvent): string | null {
	if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) return null;
	return normalizeShortcut(
		[
			event.ctrlKey ? "Ctrl" : "",
			event.altKey ? "Alt" : "",
			event.shiftKey ? "Shift" : "",
			event.metaKey ? "Meta" : "",
			event.key,
		].filter(Boolean).join("+"),
	);
}

export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return target.matches("input, textarea, select, [contenteditable], [contenteditable='true']") ||
		Boolean(target.closest("input, textarea, select, [contenteditable], [contenteditable='true']"));
}
