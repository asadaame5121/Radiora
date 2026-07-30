import { assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const bindings = await Deno.readTextFile(new URL("../src/shared/bindings.ts", import.meta.url));
const registration = await Deno.readTextFile(
	new URL("../src/desktop/register_bindings.ts", import.meta.url),
);

Deno.test("complete JSON backup flushes edits and downloads a UTF-8 envelope", () => {
	assertMatch(
		app,
		/async function performJsonBackupExport\(\)[\s\S]*?await autosave\.flush\(\)[\s\S]*?api\.exportJsonBackup\(\)/,
	);
	assertMatch(app, /new Blob\(\[source\], \{ type: "application\/json;charset=utf-8" \}\)/);
	assertMatch(
		app,
		/anchor\.download = `radiora-backup-\$\{localDateValue\(new Date\(\)\)\}\.json`/,
	);
	assertMatch(app, /vocabulary\.jsonBackupExport/);
	assertMatch(app, /vocabulary\.jsonBackupExportSuccess/);
});

Deno.test("complete JSON backup is exposed through the desktop binding", () => {
	assertMatch(bindings, /exportJsonBackup\(\): Promise<string>/);
	assertMatch(registration, /exportJsonBackup: \(\) => service\(\)\.exportJsonBackup\(\)/);
});
