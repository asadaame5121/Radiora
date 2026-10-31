import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
const controller = await readFile(
	new URL("../../../src/ui/opml_controller.svelte.ts", import.meta.url),
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

test("OPML UI exports UTF-8 and imports an explicitly selected file", () => {
	expect(controller).toMatch(
		/export =[\s\S]*?this\.operation\.run\(\s*this\.ports\.flush,[\s\S]*?this\.ports\.api\.exportOpml\(\)/,
	);
	expect(controller).toMatch(
		/downloadTextFile\(\s*source,\s*"text\/x-opml;charset=utf-8",\s*`radiora-\$\{localDateValue\(new Date\(\)\)\}\.opml`,?\s*\)/,
	);
	expect(view).toMatch(
		/accept="\.opml,\.xml,text\/x-opml,application\/xml,text\/xml"[\s\S]*?onchange=\{importOpmlFile\}/,
	);
	expect(controller).toMatch(
		/import =[\s\S]*?this\.operation\.runFile\([\s\S]*?this\.ports\.api\.importOpml\(source\)[\s\S]*?await this\.ports\.reload\(current\)/,
	);
});

test("OPML operations use shared bindings and vocabulary", () => {
	expect(bindings).toMatch(/exportOpml\(\): Promise<string>/);
	expect(bindings).toMatch(/importOpml\(source: string\): Promise<OpmlImportResult>/);
	expect(registration).toMatch(/exportOpml: \(\) => service\(\)\.exportOpml\(\)/);
	expect(registration).toMatch(/importOpml: \(source\) => service\(\)\.importOpml\(source\)/);
	for (const code of ["opmlExport", "opmlImport", "opmlExportSuccess", "opmlImportSuccess"]) {
		expect(`${controller}\n${view}`).toMatch(new RegExp(`vocabulary\\.${code}`));
	}
});
