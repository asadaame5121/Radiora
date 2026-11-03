// commonmark 0.31.2 ships no type declarations and @types/commonmark is not a dependency.
// Only the API this fixture test uses is declared here; the fixture pins the exact version.
declare module "commonmark" {
	export class Parser {
		parse(input: string): unknown;
	}

	export class HtmlRenderer {
		render(ast: unknown): string;
	}
}
