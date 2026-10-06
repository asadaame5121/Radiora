import { assertMatch } from "jsr:@std/assert@1";

const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
const controller = await Deno.readTextFile(
	new URL("../src/ui/opml_controller.svelte.ts", import.meta.url),
);
const view = await Deno.readTextFile(new URL("../src/ui/OptionsView.svelte", import.meta.url));
const bindings = await Deno.readTextFile(new URL("../src/shared/bindings.ts", import.meta.url));
const registration = await Deno.readTextFile(
	new URL("../src/desktop/register_bindings.ts", import.meta.url),
);

Deno.test("OPML UI exports UTF-8 and imports an explicitly selected file", () => {
	assertMatch(
		controller,
		/export =[\s\S]*?this\.operation\.run\(this\.ports\.flush,[\s\S]*?this\.ports\.api\.exportOpml\(\)/,
	);
	assertMatch(
		controller,
		/downloadTextFile\(\s*source,\s*"text\/x-opml;charset=utf-8",\s*`radiora-\$\{localDateValue\(new Date\(\)\)\}\.opml`,?\s*\)/,
	);
	assertMatch(
		view,
		/accept="\.opml,\.xml,text\/x-opml,application\/xml,text\/xml"[\s\S]*?onchange=\{importOpmlFile\}/,
	);
	assertMatch(
		controller,
		/import =[\s\S]*?this\.operation\.runFile\([\s\S]*?this\.ports\.api\.importOpml\(source\)[\s\S]*?await this\.ports\.reload\(current\)/,
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
		assertMatch(`${controller}\n${view}`, new RegExp(`vocabulary\\.${code}`));
	}
});
