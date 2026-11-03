import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
const controller = await readFile(
	new URL("../../../src/ui/json_backup_controller.svelte.ts", import.meta.url),
	"utf8",
);
const view = await readFile(new URL("../../../src/ui/OptionsView.svelte", import.meta.url), "utf8");
const bindings = await readFile(
	new URL("../../../src/shared/bindings.ts", import.meta.url),
	"utf8",
);
const registration = await readFile(
	new URL("../../../src/desktop/register_bindings.ts", import.meta.url),
	"utf8",
);

test("complete JSON backup flushes edits and downloads a UTF-8 envelope", () => {
	expect(controller).toMatch(
		/export =[\s\S]*?this\.operation\.run\(\s*this\.ports\.flush,[\s\S]*?this\.ports\.api\.exportJsonBackup\(\)/,
	);
	expect(controller).toMatch(
		/downloadTextFile\(\s*source,\s*"application\/json;charset=utf-8",\s*`radiora-backup-\$\{localDateValue\(new Date\(\)\)\}\.json`,?\s*\)/,
	);
	expect(controller).toMatch(/vocabulary\.jsonBackupExport/);
	expect(controller).toMatch(/vocabulary\.jsonBackupExportSuccess/);
});

test("complete JSON backup is exposed through the desktop binding", () => {
	expect(bindings).toMatch(/exportJsonBackup\(\): Promise<string>/);
	expect(registration).toMatch(/exportJsonBackup: \(\) => service\(\)\.exportJsonBackup\(\)/);
});

test("JSON restore flushes pending edits and reloads only after the binding succeeds", () => {
	expect(controller).toMatch(
		/restore =[\s\S]*?this\.operation\.runFile\([\s\S]*?this\.ports\.api\.restoreJsonBackup\(source\)[\s\S]*?await this\.ports\.reload\(current\)/,
	);
	expect(view).toMatch(/accept="\.json,application\/json"/);
	expect(`${controller}\n${view}`).toMatch(/vocabulary\.jsonBackupRestore/);
	expect(controller).toMatch(/vocabulary\.jsonBackupRestoreSuccess/);
	expect(controller).toMatch(
		/errorMessage\(\s*cause,?\s*\).*vocabulary\.jsonBackupRestoreFailureRecovery/s,
	);
	expect(bindings).toMatch(/restoreJsonBackup\(source: string\): Promise<JsonBackupRestoreResult>/);
	expect(registration).toMatch(
		/restoreJsonBackup: \(source\) => service\(\)\.restoreJsonBackup\(source\)/,
	);
});
