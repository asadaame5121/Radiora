import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";

/** A portable outline tree. `text` is the complete Radiora item body. */
export interface OpmlNode {
	readonly text: string;
	readonly children: readonly OpmlNode[];
}

interface IndexedItem {
	readonly item: OutlineItem;
	readonly index: number;
}

interface XmlElement {
	readonly name: string;
	readonly attributes: ReadonlyMap<string, string>;
	readonly children: readonly XmlElement[];
}

const RADIORA_TEXT_ATTRIBUTE = "data-radiora-text";
const MAX_OPML_SOURCE_LENGTH = 10 * 1024 * 1024;
const MAX_OPML_ELEMENTS = 10_000;
const MAX_OPML_DEPTH = 256;

/**
 * Exports the outline placements in a snapshot as an OPML 2.0 document.
 *
 * `text` and `_note` are useful to ordinary OPML readers. The UTF-8 base64
 * custom attribute is deliberately included so a Radiora round-trip retains
 * every character of a multi-line body, including leading blank lines.
 */
export function renderOutlineSnapshotOpml(snapshot: OutlineSnapshot): string {
	const roots = snapshotToNodes(snapshot);
	const body = roots.map((node) => renderNode(node, 1)).join("\n");
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<opml version="2.0">',
		"  <head>",
		"    <title>Radiora outline</title>",
		"  </head>",
		"  <body>",
		body,
		"  </body>",
		"</opml>",
	].filter((line) => line.length > 0).join("\n") + "\n";
}

/**
 * Parses an OPML 2.0 document after validating its complete XML structure.
 * External OPML uses `text` and optional `_note`; Radiora's custom attribute,
 * when present, takes precedence for lossless body restoration.
 */
export function parseOpml(source: string): OpmlNode[] {
	if (source.length > MAX_OPML_SOURCE_LENGTH) throw new Error("OPML document is too large");
	if (/<!\s*(?:doctype|entity)\b/i.test(source)) {
		throw new Error("OPML must not contain DOCTYPE or ENTITY declarations");
	}
	const root = parseXmlDocument(source);
	if (localName(root.name) !== "opml") {
		throw new Error("OPML root element is required");
	}
	const body = directChild(root, "body");
	if (!body) throw new Error("OPML body element is required");
	return directOutlineChildren(body).map(parseOutlineNode);
}

function snapshotToNodes(snapshot: OutlineSnapshot): OpmlNode[] {
	const indexed = snapshot.items.map((item, index) => ({ item, index }));
	const firstById = new Map<string, IndexedItem>();
	for (const node of indexed) {
		if (!firstById.has(node.item.id)) firstById.set(node.item.id, node);
	}

	const children = new Map<number, IndexedItem[]>();
	const roots: IndexedItem[] = [];
	for (const node of indexed) {
		const parent = node.item.parentId === null ? undefined : firstById.get(node.item.parentId);
		if (!parent || parent.index === node.index) {
			roots.push(node);
			continue;
		}
		const bucket = children.get(parent.index) ?? [];
		bucket.push(node);
		children.set(parent.index, bucket);
	}
	for (const bucket of children.values()) bucket.sort(compareItems);
	roots.sort(compareItems);

	const visited = new Set<number>();
	const toNode = (node: IndexedItem): OpmlNode => {
		visited.add(node.index);
		return {
			text: node.item.text,
			children: (children.get(node.index) ?? [])
				.filter((child) => !visited.has(child.index))
				.map(toNode),
		};
	};
	const result = roots.filter((node) => !visited.has(node.index)).map(toNode);
	// Preserve malformed snapshots rather than silently omitting placements.
	for (const node of [...indexed].sort(compareItems)) {
		if (!visited.has(node.index)) result.push(toNode(node));
	}
	return result;
}

function compareItems(left: IndexedItem, right: IndexedItem): number {
	const leftOrder = Number.isFinite(left.item.orderKey) ? left.item.orderKey : Infinity;
	const rightOrder = Number.isFinite(right.item.orderKey) ? right.item.orderKey : Infinity;
	return leftOrder - rightOrder || left.item.id.localeCompare(right.item.id) ||
		left.index - right.index;
}

function renderNode(node: OpmlNode, depth: number): string {
	const indent = "  ".repeat(depth + 1);
	const [title, note] = displayFields(node.text);
	const attributes = [
		`text="${escapeXmlAttribute(title)}"`,
		`_note="${escapeXmlAttribute(note)}"`,
		`${RADIORA_TEXT_ATTRIBUTE}="${encodeUtf8Base64(node.text)}"`,
	].join(" ");
	if (node.children.length === 0) return `${indent}<outline ${attributes}/>`;
	return [
		`${indent}<outline ${attributes}>`,
		...node.children.map((child) => renderNode(child, depth + 1)),
		`${indent}</outline>`,
	].join("\n");
}

function displayFields(text: string): [title: string, note: string] {
	const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
	const lines = normalized.split("\n");
	const first = lines.findIndex((line) => line.trim().length > 0);
	if (first < 0) return ["(空の項目)", normalized];
	return [lines[first], lines.slice(first + 1).join("\n")];
}

function parseOutlineNode(element: XmlElement): OpmlNode {
	const encodedText = element.attributes.get(RADIORA_TEXT_ATTRIBUTE);
	const text = encodedText === undefined ? externalText(element) : decodeUtf8Base64(encodedText);
	return { text, children: directOutlineChildren(element).map(parseOutlineNode) };
}

function externalText(element: XmlElement): string {
	const title = element.attributes.get("text");
	if (title === undefined) throw new Error("Every OPML outline requires a text attribute");
	const note = element.attributes.get("_note");
	return note === undefined || note.length === 0 ? title : `${title}\n${note}`;
}

function directChild(parent: XmlElement, name: string): XmlElement | undefined {
	return parent.children.find((child) => localName(child.name) === name);
}

function directOutlineChildren(parent: XmlElement): XmlElement[] {
	return parent.children.filter((child) => localName(child.name) === "outline");
}

function escapeXmlAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function encodeUtf8Base64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function decodeUtf8Base64(value: string): string {
	try {
		const binary = atob(value);
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error("OPML Radiora text attribute is not valid UTF-8 base64");
	}
}

/** A deliberately small, dependency-free XML parser for attribute-only OPML. */
function parseXmlDocument(source: string): XmlElement {
	let position = 0;
	let elementCount = 0;
	const skipWhitespace = (): void => {
		while (/\s/.test(source[position] ?? "")) position++;
	};
	const skipMarkup = (prefix: string, suffix: string): boolean => {
		if (!source.startsWith(prefix, position)) return false;
		const end = source.indexOf(suffix, position + prefix.length);
		if (end < 0) throw new Error("OPML is not well-formed XML");
		position = end + suffix.length;
		return true;
	};
	const parseName = (): string => {
		const matched = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(position));
		if (!matched) throw new Error("OPML is not well-formed XML");
		position += matched[0].length;
		return matched[0];
	};
	const parseElement = (depth: number): XmlElement => {
		if (depth > MAX_OPML_DEPTH) throw new Error("OPML nesting is too deep");
		elementCount++;
		if (elementCount > MAX_OPML_ELEMENTS) throw new Error("OPML contains too many elements");
		if (source[position] !== "<" || source.startsWith("</", position)) {
			throw new Error("OPML is not well-formed XML");
		}
		position++;
		const name = parseName();
		const attributes = new Map<string, string>();
		while (true) {
			skipWhitespace();
			if (source.startsWith("/>", position)) {
				position += 2;
				return { name, attributes, children: [] };
			}
			if (source[position] === ">") {
				position++;
				break;
			}
			const attributeName = parseName();
			if (attributes.has(attributeName)) throw new Error("OPML has duplicate XML attributes");
			skipWhitespace();
			if (source[position++] !== "=") throw new Error("OPML is not well-formed XML");
			skipWhitespace();
			const quote = source[position++];
			if (quote !== '"' && quote !== "'") throw new Error("OPML is not well-formed XML");
			const end = source.indexOf(quote, position);
			if (end < 0) throw new Error("OPML is not well-formed XML");
			attributes.set(attributeName, decodeXmlEntities(source.slice(position, end)));
			position = end + 1;
		}
		const children: XmlElement[] = [];
		while (true) {
			if (source.startsWith(`</${name}`, position)) {
				position += 2 + name.length;
				skipWhitespace();
				if (source[position++] !== ">") throw new Error("OPML is not well-formed XML");
				return { name, attributes, children };
			}
			if (skipMarkup("<!--", "-->")) continue;
			if (source[position] === "<") {
				if (source.startsWith("<?", position) || source.startsWith("<!", position)) {
					throw new Error("OPML is not well-formed XML");
				}
				children.push(parseElement(depth + 1));
				continue;
			}
			const next = source.indexOf("<", position);
			// OPML head metadata such as <title> has text content. It is not
			// outline data, but accepting it still validates the complete XML tree.
			position = next < 0 ? source.length : next;
			if (next < 0) throw new Error("OPML is not well-formed XML");
		}
	};

	skipWhitespace();
	if (skipMarkup("<?xml", "?>")) skipWhitespace();
	const root = parseElement(0);
	skipWhitespace();
	if (position !== source.length) throw new Error("OPML is not well-formed XML");
	return root;
}

function decodeXmlEntities(value: string): string {
	const pattern = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
	let cursor = 0;
	let decoded = "";
	for (const match of value.matchAll(pattern)) {
		const prefix = value.slice(cursor, match.index);
		if (prefix.includes("&")) throw new Error("OPML contains an unsupported XML entity");
		decoded += prefix + decodeXmlEntity(match[1]);
		cursor = match.index! + match[0].length;
	}
	const suffix = value.slice(cursor);
	if (suffix.includes("&")) throw new Error("OPML contains an unsupported XML entity");
	return decoded + suffix;
}

function decodeXmlEntity(entity: string): string {
	const normalized = entity.toLowerCase();
	if (normalized === "amp") return "&";
	if (normalized === "lt") return "<";
	if (normalized === "gt") return ">";
	if (normalized === "quot") return '"';
	if (normalized === "apos") return "'";
	const number = normalized.startsWith("#x")
		? Number.parseInt(normalized.slice(2), 16)
		: Number.parseInt(normalized.slice(1), 10);
	if (
		!Number.isInteger(number) || number < 0 || number > 0x10ffff ||
		number >= 0xd800 && number <= 0xdfff
	) {
		throw new Error("OPML contains an invalid numeric XML entity");
	}
	return String.fromCodePoint(number);
}

function localName(name: string): string {
	return name.slice(name.lastIndexOf(":") + 1).toLowerCase();
}
