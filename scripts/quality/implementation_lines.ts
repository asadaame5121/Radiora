export type SourceKind = "typescript" | "svelte" | "css";

type Region = "markup" | "script" | "style";
type Quote = "single" | "double" | "template" | null;

type LexerState = {
	region: Region;
	quote: Quote;
	blockComment: boolean;
	htmlComment: boolean;
	escaped: boolean;
};

type Baseline = Record<string, number>;

const DEFAULT_LIMIT = 400;
const BASELINE_URL = new URL("./implementation_line_baseline.json", import.meta.url);

export function countImplementationLines(source: string, kind: SourceKind): number {
	const state: LexerState = {
		region: kind === "svelte" ? "markup" : kind === "css" ? "style" : "script",
		quote: null,
		blockComment: false,
		htmlComment: false,
		escaped: false,
	};

	let count = 0;
	for (const line of source.split(/\r?\n/)) {
		if (lineHasImplementation(line, kind, state)) count++;
	}
	return count;
}

function lineHasImplementation(line: string, kind: SourceKind, state: LexerState): boolean {
	const cursor = { line, kind, state, index: 0, hasCode: false };
	while (cursor.index < line.length) {
		if (consumeOpenComment(cursor)) continue;
		if (consumeQuotedCharacter(cursor)) continue;
		if (consumeSvelteBoundary(cursor)) continue;
		consumeNormalCharacter(cursor);
	}
	state.escaped = false;
	return cursor.hasCode;
}

type Cursor = {
	line: string;
	kind: SourceKind;
	state: LexerState;
	index: number;
	hasCode: boolean;
};

function consumeOpenComment(cursor: Cursor): boolean {
	const { state, line } = cursor;
	const marker = state.htmlComment ? "-->" : state.blockComment ? "*/" : null;
	if (marker === null) return false;
	const end = line.indexOf(marker, cursor.index);
	if (end === -1) {
		cursor.index = line.length;
		return true;
	}
	if (state.htmlComment) state.htmlComment = false;
	else state.blockComment = false;
	cursor.index = end + marker.length;
	return true;
}

function consumeQuotedCharacter(cursor: Cursor): boolean {
	const { state } = cursor;
	if (state.quote === null) return false;
	const character = cursor.line[cursor.index] ?? "";
	if (!/\s/.test(character)) cursor.hasCode = true;
	if (state.escaped) state.escaped = false;
	else if (character === "\\") state.escaped = true;
	else if (isClosingQuote(character, state.quote)) state.quote = null;
	cursor.index++;
	return true;
}

function isClosingQuote(character: string, quote: Exclude<Quote, null>): boolean {
	return (quote === "single" && character === "'") ||
		(quote === "double" && character === '"') ||
		(quote === "template" && character === "`");
}

function consumeSvelteBoundary(cursor: Cursor): boolean {
	const { state } = cursor;
	if (cursor.kind !== "svelte") return false;
	const rest = cursor.line.slice(cursor.index);
	if (state.region === "markup" && rest.startsWith("<!--")) {
		state.htmlComment = true;
		cursor.index += 4;
		return true;
	}
	const closing = state.region === "markup" ? null : rest.match(/^<\/(?:script|style)\s*>/i);
	if (closing) {
		cursor.hasCode = true;
		cursor.index += closing[0].length;
		state.region = "markup";
		return true;
	}
	const opening = state.region === "markup" ? rest.match(/^<(script|style)(?:\s[^>]*)?>/i) : null;
	if (!opening) return false;
	cursor.hasCode = true;
	cursor.index += opening[0].length;
	state.region = opening[1]?.toLowerCase() === "style" ? "style" : "script";
	return true;
}

function consumeNormalCharacter(cursor: Cursor): void {
	const { state, line } = cursor;
	const character = line[cursor.index] ?? "";
	const next = line[cursor.index + 1] ?? "";
	if (state.region === "script" && character === "/" && next === "/") {
		cursor.index = line.length;
		return;
	}
	if (state.region !== "markup" && character === "/" && next === "*") {
		state.blockComment = true;
		cursor.index += 2;
		return;
	}
	if (character === "'" || character === '"' || (state.region === "script" && character === "`")) {
		cursor.hasCode = true;
		state.quote = character === "'" ? "single" : character === '"' ? "double" : "template";
		state.escaped = false;
		cursor.index++;
		return;
	}
	if (!/\s/.test(character)) cursor.hasCode = true;
	cursor.index++;
}

export function sourceKind(path: string): SourceKind | null {
	if (path.endsWith(".svelte")) return "svelte";
	if (path.endsWith(".css")) return "css";
	if (/\.(?:ts|tsx)$/.test(path)) return "typescript";
	return null;
}

export function isProductionSource(path: string): boolean {
	const normalized = path.replaceAll("\\", "/");
	if (!/^(?:src|scripts)\//.test(normalized) || sourceKind(normalized) === null) return false;
	return !(
		/(?:^|\/)(?:tests?|fixtures?|generated|vendor)(?:\/|$)/i.test(normalized) ||
		/(?:_test|\.test|\.spec)\.(?:ts|tsx)$/.test(normalized) ||
		/\.d\.ts$/.test(normalized)
	);
}

export function allowedImplementationLines(path: string, baseline: Baseline): number {
	return Math.max(DEFAULT_LIMIT, baseline[path] ?? DEFAULT_LIMIT);
}

async function collectProductionSources(root: string): Promise<string[]> {
	const results: string[] = [];
	for (const directory of ["src", "scripts"]) await walk(`${root}/${directory}`, root, results);
	return results.sort();
}

async function walk(directory: string, root: string, results: string[]): Promise<void> {
	try {
		for await (const entry of Deno.readDir(directory)) {
			const absolute = `${directory}/${entry.name}`;
			if (entry.isDirectory) {
				await walk(absolute, root, results);
			} else if (entry.isFile) {
				const relative = absolute.slice(root.length + 1).replaceAll("\\", "/");
				if (isProductionSource(relative)) results.push(relative);
			}
		}
	} catch (error) {
		if (!(error instanceof Deno.errors.NotFound)) throw error;
	}
}

async function readBaseline(): Promise<Baseline> {
	try {
		return JSON.parse(await Deno.readTextFile(BASELINE_URL)) as Baseline;
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return {};
		throw error;
	}
}

async function inspect(root: string): Promise<Array<{ path: string; lines: number }>> {
	const files = await collectProductionSources(root);
	return await Promise.all(files.map(async (path) => {
		const kind = sourceKind(path);
		if (kind === null) throw new Error(`Unsupported production source: ${path}`);
		const source = await Deno.readTextFile(`${root}/${path}`);
		return { path, lines: countImplementationLines(source, kind) };
	}));
}

async function main(): Promise<void> {
	const root = new URL("../../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1");
	const entries = await inspect(root);
	const baseline = await readBaseline();
	const failures = entries.filter(({ path, lines }) =>
		lines > allowedImplementationLines(path, baseline)
	);
	if (failures.length === 0) {
		console.log(`Implementation-line quality gate passed for ${entries.length} production files.`);
		return;
	}

	for (const failure of failures) {
		console.error(
			`${failure.path}: ${failure.lines} implementation lines (maximum ${
				allowedImplementationLines(failure.path, baseline)
			})`,
		);
	}
	Deno.exit(1);
}

if (import.meta.main) await main();
