import { assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const controller = await Deno.readTextFile(
	new URL("../src/ui/json_backup_controller.svelte.ts", import.meta.url),
);
const view = await Deno.readTextFile(new URL("../src/ui/OptionsView.svelte", import.meta.url));
const bindings = await Deno.readTextFile(new URL("../src/shared/bindings.ts", import.meta.url));
const registration = await Deno.readTextFile(
	new URL("../src/desktop/register_bindings.ts", import.meta.url),
);

Deno.test("complete JSON backup flushes edits and downloads a UTF-8 envelope", () => {
	assertMatch(
		controller,
		/export =[\s\S]*?this\.operation\.run\(this\.ports\.flush,[\s\S]*?this\.ports\.api\.exportJsonBackup\(\)/,
	);
	assertMatch(
		controller,
		/downloadTextFile\(\s*source,\s*"application\/json;charset=utf-8",\s*`radiora-backup-\$\{localDateValue\(new Date\(\)\)\}\.json`,?\s*\)/,
	);
	assertMatch(controller, /vocabulary\.jsonBackupExport/);
	assertMatch(controller, /vocabulary\.jsonBackupExportSuccess/);
});

Deno.test("complete JSON backup is exposed through the desktop binding", () => {
	assertMatch(bindings, /exportJsonBackup\(\): Promise<string>/);
	assertMatch(registration, /exportJsonBackup: \(\) => service\(\)\.exportJsonBackup\(\)/);
});

Deno.test("JSON restore flushes pending edits and reloads only after the binding succeeds", () => {
	assertMatch(
		controller,
		/restore =[\s\S]*?this\.operation\.runFile\([\s\S]*?this\.ports\.api\.restoreJsonBackup\(source\)[\s\S]*?await this\.ports\.reload\(current\)/,
	);
	assertMatch(view, /accept="\.json,application\/json"/);
	assertMatch(`${controller}\n${view}`, /vocabulary\.jsonBackupRestore/);
	assertMatch(controller, /vocabulary\.jsonBackupRestoreSuccess/);
	assertMatch(controller, /errorMessage\(cause\).*vocabulary\.jsonBackupRestoreFailureRecovery/s);
	assertMatch(bindings, /restoreJsonBackup\(source: string\): Promise<JsonBackupRestoreResult>/);
	assertMatch(
		registration,
		/restoreJsonBackup: \(source\) => service\(\)\.restoreJsonBackup\(source\)/,
	);
});
