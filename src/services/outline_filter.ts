export interface OutlineFilter {
	freeText: string;
	tagsAll: string;
	tagsNone: string;
}

export const EMPTY_OUTLINE_FILTER: OutlineFilter = {
	freeText: "",
	tagsAll: "",
	tagsNone: "",
};

export function parseFilterTags(raw: string): string[] {
	return raw
		.split(/[\s,、]+/u)
		.map((tag) => tag.replace(/^#/, "").trim().toLocaleLowerCase())
		.filter(Boolean);
}

export function matchesOutlineFilter(text: string, filter: OutlineFilter): boolean {
	const freeText = filter.freeText.trim().toLocaleLowerCase();
	if (freeText && !text.toLocaleLowerCase().includes(freeText)) return false;

	const tags = new Set(
		[...text.matchAll(/#[\p{L}\p{N}_-]+/gu)].map((match) => match[0].slice(1).toLocaleLowerCase()),
	);
	const required = parseFilterTags(filter.tagsAll);
	const excluded = parseFilterTags(filter.tagsNone);
	return required.every((tag) => tags.has(tag)) && excluded.every((tag) => !tags.has(tag));
}
