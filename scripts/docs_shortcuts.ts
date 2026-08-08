/**
 * キーバインディング一覧をMarkdownテーブルとして生成する。
 *
 * - コマンド系: src/ui/command_service.ts の COMMAND_DEFINITIONS が唯一の情報源。
 * - アウトライン編集系: src/shared/editor_bindings.ts の EDITOR_BINDINGS が唯一の情報源。
 *   アプリ内ヘルプ（F1）とこの生成が同じ一覧を共有する。
 *
 * 使い方:
 *   deno task docs:shortcuts                     # stdout へ出力
 *   deno task docs:shortcuts -- --splice <path>  # マーカー間をファイルへ書き戻す
 */

import {
	COMMAND_DEFINITIONS,
	normalizeShortcut,
	validateShortcuts,
} from "../src/ui/command_service.ts";
import { DEFAULT_UI_VOCABULARY } from "../src/shared/ui_vocabulary.ts";
import { EDITOR_BINDINGS } from "../src/shared/editor_bindings.ts";

const SPLICE_START = "<!-- shortcuts:start -->";
const SPLICE_END = "<!-- shortcuts:end -->";

function commandTable(): string {
	const bindings = validateShortcuts(
		COMMAND_DEFINITIONS.flatMap((command) =>
			command.shortcut ? [{ commandId: command.id, shortcut: command.shortcut }] : []
		),
	);
	if (bindings.errors.length > 0) {
		throw new Error(`ショートカット定義に重複・不正があります:\n${bindings.errors.join("\n")}`);
	}
	const rows = bindings.bindings
		.map(({ commandId, shortcut }) => {
			const command = COMMAND_DEFINITIONS.find((candidate) => candidate.id === commandId);
			if (!command) return null;
			const normalized = normalizeShortcut(shortcut) ?? shortcut;
			return `| ${command.label(DEFAULT_UI_VOCABULARY)} | \`${normalized}\` |`;
		})
		.filter((row): row is string => row !== null);
	return [
		"## コマンドパレットのショートカット",
		"",
		"| 操作 | ショートカット |",
		"| --- | --- |",
		...rows,
	].join("\n");
}

function editorTable(): string {
	const rows = EDITOR_BINDINGS.map(({ label, keys }) => `| ${label} | \`${keys}\` |`);
	return [
		"## アウトラインの編集",
		"",
		"| 操作 | キー |",
		"| --- | --- |",
		...rows,
	].join("\n");
}

function render(): string {
	return [
		commandTable(),
		"",
		editorTable(),
		"",
		"> この表は `deno task docs:shortcuts` で生成されます。編集は各定義側（コマンド系は `src/ui/command_service.ts`、編集系は `src/shared/editor_bindings.ts`）で行ってください。",
		"",
	].join("\n");
}

function spliceInto(targetPath: string, content: string): void {
	const path = targetPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(targetPath)
		? targetPath
		: `${Deno.cwd()}/${targetPath}`;
	const original = Deno.readTextFileSync(path);
	const start = original.indexOf(SPLICE_START);
	const end = original.indexOf(SPLICE_END);
	if (start < 0 || end < 0 || end <= start) {
		throw new Error(
			`${path} に ${SPLICE_START} と ${SPLICE_END} のマーカーが見つかりません。`,
		);
	}
	const next = original.slice(0, start + SPLICE_START.length) +
		"\n\n" + content.trim() + "\n\n" +
		original.slice(end);
	Deno.writeTextFileSync(path, next);
}

if (import.meta.main) {
	const spliceIndex = Deno.args.indexOf("--splice");
	const content = render();
	if (spliceIndex >= 0) {
		const target = Deno.args[spliceIndex + 1];
		if (!target) throw new Error("--splice には対象ファイルのパスが必要です");
		spliceInto(target, content);
		console.error(`書き込みました: ${target}`);
	} else {
		console.log(content);
	}
}
