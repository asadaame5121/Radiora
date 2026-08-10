import { assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const view = await Deno.readTextFile(new URL("../src/ui/OptionsView.svelte", import.meta.url));
const bindings = await Deno.readTextFile(new URL("../src/shared/bindings.ts", import.meta.url));
const registration = await Deno.readTextFile(
	new URL("../src/desktop/register_bindings.ts", import.meta.url),
);

Deno.test("OPML UI exports UTF-8 and imports an explicitly selected file", () => {
	assertMatch(
		app,
		/async function performOpmlExport\(\)[\s\S]*?await editorController\.flushAutosave\(\)[\s\S]*?api\.exportOpml\(\)/,
	);
	assertMatch(app, /new Blob\(\[source\], \{ type: "text\/x-opml;charset=utf-8" \}\)/);
	assertMatch(app, /anchor\.download = `radiora-\$\{localDateValue\(new Date\(\)\)\}\.opml`/);
	assertMatch(
		view,
		/accept="\.opml,\.xml,text\/x-opml,application\/xml,text\/xml"[\s\S]*?onchange=\{importOpmlFile\}/,
	);
	assertMatch(
		app,
		/async function importOpmlFile\(file: File\)[\s\S]*?await editorController\.flushAutosave\(\)[\s\S]*?api\.importOpml\(await file\.text\(\)\)[\s\S]*?await load\(\)/,
	);
});

Deno.test("OPML operations use shared bindings and vocabulary", () => {
	assertMatch(bindings, /exportOpml\(\): Promise<string>/);
	assertMatch(bindings, /importOpml\(source: string\): Promise<OpmlImportResult>/);
	assertMatch(registration, /exportOpml: \(\) => service\(\)\.exportOpml\(\)/);
	assertMatch(registration, /importOpml: \(source\) => service\(\)\.importOpml\(source\)/);
	for (
		const code of [
			"opmlExport",
			"opmlImport",
			"opmlExportSuccess",
			"opmlImportSuccess",
		]
	) {
		assertMatch(`${app}\n${view}`, new RegExp(`vocabulary\\.${code}`));
	}
});
