import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
// commonmark 0.31.2 is an exact dev dependency verified through package-lock.json.
import * as commonmark from "commonmark";
import OverType from "overtype";

interface CommonMarkEditorFixture {
	specVersion: string;
	examples: Array<{
		name: string;
		markdown: string;
		commonmarkHtml: string;
		overtypeHtml: string;
		difference: string;
	}>;
}

test("Overtype 2.4.0 differences stay explicit against a fixed CommonMark 0.31.2 subset", async () => {
	const fixture = JSON.parse(
		await readFile(
			new URL("../../../tests/fixtures/commonmark-0.31.2-editor-subset.json", import.meta.url),
			"utf8",
		),
	) as CommonMarkEditorFixture;

	expect(fixture.specVersion).toEqual("0.31.2");
	const parser = new commonmark.Parser();
	const renderer = new commonmark.HtmlRenderer();
	for (const example of fixture.examples) {
		const canonical = renderer.render(parser.parse(example.markdown));
		const actual = OverType.MarkdownParser.parse(example.markdown, -1, false, null, true) as string;
		expect(canonical, `${example.name}: CommonMark baseline`).toEqual(example.commonmarkHtml);
		expect(actual, example.name).toEqual(example.overtypeHtml);
		expect(actual, example.name).not.toEqual(canonical);
		if (!example.difference.trim()) throw new Error(`${example.name} needs a difference reason`);
	}
});
