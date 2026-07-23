import type { OutlineItem, OutlineLink, RuleQueryResult } from "../domain/models.ts";
import { normalizeSearchText, titleOf } from "./search_text.ts";

type Term = { kind: "variable" | "constant"; value: string };
type Atom = { name: string; terms: Term[] };
type Rule = { head: Atom; body: Atom[] };
type Binding = Map<string, string>;
type RelationMap = Map<string, Set<string>>;

const MAX_RULES = 20;
const MAX_TUPLES = 10_000;
const MAX_RESULTS = 500;
const MAX_MS = 500;

export function runRuleQuery(
	source: string,
	items: OutlineItem[],
	links: OutlineLink[],
	limit = MAX_RESULTS,
): RuleQueryResult {
	const started = performance.now();
	const statements = splitStatements(source);
	const queryStatement = statements.find((statement) => statement.startsWith("?-"));
	if (!queryStatement) throw new SyntaxError("Query must contain a '?-' statement.");
	const rules = statements.filter((statement) => !statement.startsWith("?-")).map(parseRule);
	if (rules.length > MAX_RULES) throw new RangeError(`At most ${MAX_RULES} rules are allowed.`);
	const query = parseAtoms(queryStatement.slice(2));
	const relations = buildBaseRelations(items, links);
	let tupleCount = [...relations.values()].reduce((sum, values) => sum + values.size, 0);

	for (let changed = true; changed;) {
		changed = false;
		assertWithinLimits(started, tupleCount);
		for (const rule of rules) {
			for (const binding of evaluateBody(rule.body, relations, items)) {
				const tuple = rule.head.terms.map((term) => resolveTerm(term, binding));
				if (tuple.some((value) => value == null)) continue;
				const relation = relations.get(relationKey(rule.head.name, tuple.length)) ??
					new Set<string>();
				const key = encodeTuple(tuple as string[]);
				if (!relation.has(key)) {
					relation.add(key);
					relations.set(relationKey(rule.head.name, tuple.length), relation);
					tupleCount++;
					changed = true;
					assertWithinLimits(started, tupleCount);
				}
			}
		}
	}

	const columns = [
		...new Set(
			query.flatMap((atom) =>
				atom.terms.filter((term) => term.kind === "variable" && term.value !== "_").map((term) =>
					term.value
				)
			),
		),
	];
	const rows = evaluateBody(query, relations, items)
		.slice(0, Math.min(Math.max(1, limit), MAX_RESULTS))
		.map((binding) => columns.map((column) => binding.get(column) ?? ""));
	return { columns, rows, elapsedMs: performance.now() - started };
}

function splitStatements(source: string): string[] {
	const statements: string[] = [];
	let quote = false;
	let start = 0;
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		if (char === '"' && source[index - 1] !== "\\") quote = !quote;
		if (char === "." && !quote) {
			const statement = source.slice(start, index).trim();
			if (statement) statements.push(statement);
			start = index + 1;
		}
	}
	if (quote) throw new SyntaxError("Unterminated string literal.");
	if (source.slice(start).trim()) throw new SyntaxError("Every statement must end with '.'.");
	return statements;
}

function parseRule(statement: string): Rule {
	const marker = statement.indexOf(":-");
	if (marker < 0) throw new SyntaxError(`Rule is missing ':-': ${statement}`);
	const head = parseAtom(statement.slice(0, marker).trim());
	if (head.terms.some((term) => term.kind === "constant")) {
		throw new SyntaxError("Rule heads may contain variables only.");
	}
	return { head, body: parseAtoms(statement.slice(marker + 2)) };
}

function parseAtoms(source: string): Atom[] {
	const parts: string[] = [];
	let depth = 0;
	let quote = false;
	let start = 0;
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		if (char === '"' && source[index - 1] !== "\\") quote = !quote;
		else if (!quote && char === "(") depth++;
		else if (!quote && char === ")") depth--;
		else if (!quote && char === "," && depth === 0) {
			parts.push(source.slice(start, index).trim());
			start = index + 1;
		}
		if (depth < 0) throw new SyntaxError("Unexpected ')'.");
	}
	if (depth !== 0 || quote) throw new SyntaxError("Unbalanced query expression.");
	parts.push(source.slice(start).trim());
	return parts.filter(Boolean).map(parseAtom);
}

function parseAtom(source: string): Atom {
	const match = /^([a-z][a-z0-9_]*)\s*\((.*)\)$/i.exec(source);
	if (!match) throw new SyntaxError(`Invalid predicate: ${source}`);
	const rawTerms = splitTerms(match[2]);
	return { name: match[1].toLocaleLowerCase(), terms: rawTerms.map(parseTerm) };
}

function splitTerms(source: string): string[] {
	const terms: string[] = [];
	let quote = false;
	let start = 0;
	for (let index = 0; index < source.length; index++) {
		if (source[index] === '"' && source[index - 1] !== "\\") quote = !quote;
		else if (source[index] === "," && !quote) {
			terms.push(source.slice(start, index).trim());
			start = index + 1;
		}
	}
	terms.push(source.slice(start).trim());
	return terms;
}

function parseTerm(source: string): Term {
	if (/^[A-Z_][A-Za-z0-9_]*$/.test(source)) return { kind: "variable", value: source };
	if (/^"(?:[^"\\]|\\.)*"$/.test(source)) {
		return { kind: "constant", value: JSON.parse(source) as string };
	}
	if (/^[a-z0-9][a-z0-9_-]*$/i.test(source)) return { kind: "constant", value: source };
	throw new SyntaxError(`Invalid term: ${source}`);
}

function buildBaseRelations(items: OutlineItem[], links: OutlineLink[]): RelationMap {
	const relations: RelationMap = new Map();
	const add = (name: string, tuple: string[]) => {
		const key = relationKey(name, tuple.length);
		const relation = relations.get(key) ?? new Set<string>();
		relation.add(encodeTuple(tuple));
		relations.set(key, relation);
	};
	for (const item of items) {
		add("item", [item.id]);
		if (item.parentId) add("parent", [item.parentId, item.id]);
	}
	for (const item of items) {
		const seen = new Set([item.id]);
		let parentId = item.parentId;
		while (parentId && !seen.has(parentId)) {
			seen.add(parentId);
			add("ancestor", [parentId, item.id]);
			parentId = items.find((candidate) => candidate.id === parentId)?.parentId ?? null;
		}
	}
	for (const link of links) add("link", [link.type, link.fromId, link.toId]);
	return relations;
}

function evaluateBody(
	atoms: Atom[],
	relations: RelationMap,
	items: OutlineItem[],
): Binding[] {
	let bindings: Binding[] = [new Map()];
	for (const atom of atoms) {
		const tuples = tuplesFor(atom, relations, items);
		const next: Binding[] = [];
		for (const binding of bindings) {
			for (const tuple of tuples) {
				const joined = matchTuple(atom.terms, tuple, binding);
				if (joined) next.push(joined);
				if (next.length > MAX_TUPLES) {
					throw new RangeError(`Query exceeded ${MAX_TUPLES} intermediate rows.`);
				}
			}
		}
		bindings = next;
		if (!bindings.length) break;
	}
	return bindings;
}

function tuplesFor(atom: Atom, relations: RelationMap, items: OutlineItem[]): string[][] {
	if (atom.name === "title_prefix" || atom.name === "text_match") {
		if (atom.terms.length !== 2) throw new SyntaxError(`${atom.name} expects two arguments.`);
		const pattern = atom.terms[1].kind === "constant"
			? normalizeSearchText(atom.terms[1].value)
			: "";
		if (!pattern) {
			throw new SyntaxError(`${atom.name}'s second argument must be a non-empty string.`);
		}
		return items.filter((item) => {
			const value = atom.name === "title_prefix" ? titleOf(item) : item.text;
			const normalized = normalizeSearchText(value);
			return atom.name === "title_prefix"
				? normalized.startsWith(pattern)
				: normalized.includes(pattern);
		}).map((item) => [item.id, atom.terms[1].value]);
	}
	const relation = relations.get(relationKey(atom.name, atom.terms.length));
	return relation ? [...relation].map(decodeTuple) : [];
}

function matchTuple(terms: Term[], tuple: string[], original: Binding): Binding | null {
	const binding = new Map(original);
	for (let index = 0; index < terms.length; index++) {
		const term = terms[index];
		const value = tuple[index];
		if (term.kind === "constant") {
			if (term.value !== value) return null;
		} else if (term.value !== "_") {
			const existing = binding.get(term.value);
			if (existing != null && existing !== value) return null;
			binding.set(term.value, value);
		}
	}
	return binding;
}

function resolveTerm(term: Term, binding: Binding): string | null {
	return term.kind === "constant" ? term.value : binding.get(term.value) ?? null;
}

function relationKey(name: string, arity: number): string {
	return `${name}/${arity}`;
}

function encodeTuple(tuple: string[]): string {
	return JSON.stringify(tuple);
}

function decodeTuple(tuple: string): string[] {
	return JSON.parse(tuple) as string[];
}

function assertWithinLimits(started: number, tupleCount: number): void {
	if (tupleCount > MAX_TUPLES) throw new RangeError(`Query exceeded ${MAX_TUPLES} derived tuples.`);
	if (performance.now() - started > MAX_MS) throw new RangeError(`Query exceeded ${MAX_MS}ms.`);
}
