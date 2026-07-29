import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
// commonmark 0.31.2 intentionally ships without TypeScript declarations.
// @ts-ignore exact dev dependency verified through package-lock.json
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

Deno.test("Overtype 2.4.0 differences stay explicit against a fixed CommonMark 0.31.2 subset", async () => {
	const fixture = JSON.parse(
		await Deno.readTextFile(
			new URL("./fixtures/commonmark-0.31.2-editor-subset.json", import.meta.url),
		),
	) as CommonMarkEditorFixture;

	assertEquals(fixture.specVersion, "0.31.2");
	const parser = new commonmark.Parser();
	const renderer = new commonmark.HtmlRenderer();
	for (const example of fixture.examples) {
		const canonical = renderer.render(parser.parse(example.markdown));
		const actual = OverType.MarkdownParser.parse(
			example.markdown,
			-1,
			false,
			null,
			true,
		) as string;
		assertEquals(canonical, example.commonmarkHtml, `${example.name}: CommonMark baseline`);
		assertEquals(actual, example.overtypeHtml, example.name);
		assertNotEquals(actual, canonical, example.name);
		if (!example.difference.trim()) throw new Error(`${example.name} needs a difference reason`);
	}
});
