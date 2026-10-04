import { LINK_TYPES, type LinkType } from "../domain/models.ts";
import {
	type InlineSemanticLinkBodyResult,
	parseInlineSemanticLinkBody,
} from "./inline_semantic_link_grammar.ts";
import { isEscaped, MarkdownExclusionScanner } from "./markdown_source_scanner.ts";

/** A half-open UTF-16 range in the original outline body. */
export interface InlineSemanticLinkRange {
	start: number;
	end: number;
}

export type InlineSemanticLinkDiagnosticCode =
	| "SYNTAX_ERROR"
	| "UNKNOWN_TYPE"
	| "UNTERMINATED_LINK";

export type InlineSemanticLinkDiagnosticField =
	| "source"
	| "type"
	| "reason"
	| "target"
	| "link";

/** A syntactically valid inline semantic-link candidate. */
export interface InlineSemanticLinkCandidate {
	start: number;
	end: number;
	range: InlineSemanticLinkRange;
	/** The complete source spelling, including `[[` and `]]`. */
	raw: string;
	source: string;
	type: LinkType;
	target: string;
	reason?: string;
}

/** A machine-readable diagnostic for an inline semantic-link spelling. */
export interface InlineSemanticLinkDiagnostic {
	code: InlineSemanticLinkDiagnosticCode;
	field: InlineSemanticLinkDiagnosticField;
	message: string;
	start: number;
	end: number;
	range: InlineSemanticLinkRange;
}

export interface InlineSemanticLinkParseResult {
	candidates: InlineSemanticLinkCandidate[];
	diagnostics: InlineSemanticLinkDiagnostic[];
}

/**
 * Parses inline semantic-link candidates from an outline body.
 *
 * The parser is deliberately read-only: it only recognizes syntax and reports
 * diagnostics. Endpoint resolution and any creation of Works, Stubs, or Links
 * belong to later layers.
 */
export function parseInlineSemanticLinks(
	source: string,
	allowedTypes: readonly string[] = LINK_TYPES,
): InlineSemanticLinkParseResult {
	const candidates: InlineSemanticLinkCandidate[] = [];
	const diagnostics: InlineSemanticLinkDiagnostic[] = [];
	let index = 0;
	const scanner = new MarkdownExclusionScanner(source);

	while (index < source.length) {
		const fencedEnd = scanner.skipFencedRegion(index);
		if (fencedEnd !== null) {
			index = fencedEnd;
			continue;
		}

		if (source.startsWith("[[", index) && !isEscaped(source, index)) {
			const closings = findPossibleClosings(source, index);
			if (!closings.length) {
				diagnostics.push({
					code: "UNTERMINATED_LINK",
					field: "link",
					message: "Inline semantic link is missing its closing `]]`",
					start: index,
					end: source.length,
					range: { start: index, end: source.length },
				});
				break;
			}

			let parsed: InlineSemanticLinkBodyResult | null = null;
			let closing = closings[0];
			for (const possibleClosing of closings) {
				const attempt = parseInlineSemanticLinkBody(
					source.slice(index + 2, possibleClosing),
					index + 2,
					allowedTypes,
				);
				if (attempt.kind === "success") {
					parsed = attempt;
					closing = possibleClosing;
					break;
				}
				if (parsed === null) parsed = attempt;
			}

			if (parsed?.kind === "success") {
				const end = closing + 2;
				const candidate: InlineSemanticLinkCandidate = {
					start: index,
					end,
					range: { start: index, end },
					raw: source.slice(index, end),
					source: parsed.source,
					type: parsed.type,
					target: parsed.target,
				};
				if (parsed.reason !== undefined) candidate.reason = parsed.reason;
				candidates.push(candidate);
				index = end;
				continue;
			}

			const failure = parsed?.kind === "failure" ? parsed.failure : {
				code: "SYNTAX_ERROR" as const,
				field: "link" as const,
				start: index,
				end: closing + 2,
				message: "Invalid inline semantic link syntax",
			};
			diagnostics.push({
				code: failure.code,
				field: failure.field,
				message: failure.message,
				start: failure.start,
				end: failure.end,
				range: { start: failure.start, end: failure.end },
			});
			index = closing + 2;
			continue;
		}

		const excludedEnd = scanner.skipInlineRegion(index);
		if (excludedEnd !== null) {
			index = excludedEnd;
			continue;
		}
		index++;
	}

	return { candidates, diagnostics };
}

/** Short alias for callers that prefer the candidate-oriented name. */
export const parseInlineSemanticLinkCandidates = parseInlineSemanticLinks;

function findPossibleClosings(source: string, opening: number): number[] {
	const closings: number[] = [];
	for (let index = opening + 2; index < source.length - 1; index++) {
		if (!source.startsWith("]]", index) || isEscaped(source, index)) continue;
		closings.push(index);
	}
	return closings;
}
