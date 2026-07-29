import type {
	Revision,
	ScopedTagSet,
	SearchAlias,
	TagAlias,
	TagSearchRequest,
	TagSummary,
} from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";
import { parseMarkdownCandidates } from "./markdown_parser.ts";
import { normalizeSearchText } from "./search_text.ts";

const TAG_ALIAS_PREFIX = "#";
const MAX_TAG_RESULTS = 100;

/**
 * Projects inline tags from their owning Working Copy or immutable Revision.
 *
 * No Work-level canonical tag set is created: every returned entry retains the
 * Branch or Revision scope whose text actually contains the tag.
 */
export class TagService {
	constructor(
		private readonly store: GraphStore,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly createId: () => string = () => crypto.randomUUID(),
	) {}

	async listScopedTags(historyRevisionIds: string[] = []): Promise<ScopedTagSet[]> {
		const [works, branches, copies, revisions, occurrences, aliases] = await Promise.all([
			this.store.listWorks(),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
			this.store.listRevisions(),
			this.store.listOccurrences(),
			this.store.listAliases(),
		]);
		const visibleWorkIds = new Set(works.map((work) => work.id));
		const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));
		const result: ScopedTagSet[] = [];

		for (
			const branch of branches
				.filter((candidate) => visibleWorkIds.has(candidate.workId) && !candidate.archivedAt)
				.sort(compareBranch)
		) {
			const copy = copies.find((candidate) => candidate.branchId === branch.id);
			const fallback = branch.headRevisionId ? revisionsById.get(branch.headRevisionId) : undefined;
			const text = copy?.text ?? fallback?.text;
			if (text === undefined) continue;
			result.push({
				scope: { kind: "working-copy", workId: branch.workId, branchId: branch.id },
				tags: canonicalTags(text, aliases),
			});
		}

		const selectedRevisionIds = new Set(historyRevisionIds);
		for (const occurrence of occurrences) {
			if (occurrence.revisionSelector.mode === "pinned") {
				selectedRevisionIds.add(occurrence.revisionSelector.revisionId);
			}
		}
		for (
			const revision of revisions
				.filter((candidate) =>
					visibleWorkIds.has(candidate.workId) && selectedRevisionIds.has(candidate.id)
				)
				.sort(compareRevision)
		) {
			result.push({
				scope: {
					kind: "revision",
					workId: revision.workId,
					revisionId: revision.id,
				},
				tags: canonicalTags(revision.text, aliases),
			});
		}
		return result;
	}

	async listTags(historyRevisionIds: string[] = []): Promise<TagSummary[]> {
		return summarize(await this.listScopedTags(historyRevisionIds));
	}

	async suggest(prefix: string, limit = 8): Promise<TagSummary[]> {
		const normalized = normalizeTagName(prefix, true);
		const bounded = Math.min(Math.max(limit, 1), 20);
		return (await this.listTags())
			.filter((tag) => tag.name.startsWith(normalized))
			.sort((left, right) =>
				Number(right.name === normalized) - Number(left.name === normalized) ||
				right.count - left.count ||
				left.name.localeCompare(right.name)
			)
			.slice(0, bounded);
	}

	async search(request: TagSearchRequest): Promise<ScopedTagSet[]> {
		const aliases = await this.store.listAliases();
		const all = uniqueNames(request.all).map((name) => resolveCanonical(name, aliases));
		const none = uniqueNames(request.none ?? []).map((name) => resolveCanonical(name, aliases));
		if (!all.length) throw new Error("タグ検索には1件以上のAND条件が必要です。");
		const limit = Math.min(Math.max(request.limit ?? 20, 1), MAX_TAG_RESULTS);
		return (await this.listScopedTags(request.historyRevisionIds))
			.filter(({ tags }) =>
				all.every((name) => tags.includes(name)) &&
				none.every((name) => !tags.includes(name))
			)
			.slice(0, limit);
	}

	listAliases(): Promise<TagAlias[]> {
		return this.store.listAliases().then((aliases) =>
			aliases
				.filter(isTagAlias)
				.filter((alias) =>
					resolveCanonical(normalizeTagName(alias.canonical), aliases) ===
						normalizeTagName(alias.canonical)
				)
				.map(toTagAlias)
				.sort((left, right) =>
					left.canonicalName.localeCompare(right.canonicalName) ||
					left.id.localeCompare(right.id)
				)
		);
	}

	rename(from: string, to: string): Promise<TagAlias> {
		return this.canonicalize([from], to);
	}

	merge(sources: string[], target: string): Promise<TagAlias> {
		return this.canonicalize(sources, target);
	}

	private async canonicalize(sources: string[], target: string): Promise<TagAlias> {
		const canonicalName = normalizeTagName(target);
		const sourceNames = uniqueNames(sources).filter((name) => name !== canonicalName);
		if (!sourceNames.length) {
			throw new Error("改名・統合元には正準名と異なるタグが必要です。");
		}
		const aliases = await this.store.listAliases();
		const existingTags = new Set((await this.listTags()).map((tag) => tag.name));
		for (const source of sourceNames) {
			if (!existingTags.has(resolveCanonical(source, aliases))) {
				throw new Error(`タグが見つかりません: #${source}`);
			}
		}
		const variants = new Set(sourceNames);
		for (const name of [canonicalName, ...sourceNames]) {
			for (const alias of matchingAliases(name, aliases)) {
				variants.add(normalizeTagName(alias.canonical));
				for (const variant of alias.variants) variants.add(normalizeTagName(variant));
			}
		}
		variants.delete(canonicalName);
		const now = this.now();
		const stored: SearchAlias = {
			id: this.createId(),
			canonical: storedName(canonicalName),
			variants: [...variants].sort().map(storedName),
			createdAt: now,
			updatedAt: now,
		};
		await this.store.upsertAlias(stored);
		return toTagAlias(stored);
	}
}

function canonicalTags(text: string, aliases: SearchAlias[]): string[] {
	return [
		...new Set(
			parseMarkdownCandidates(text).tags.map((tag) =>
				resolveCanonical(normalizeTagName(tag.name), aliases)
			),
		),
	].sort();
}

function summarize(scopes: ScopedTagSet[]): TagSummary[] {
	const counts = new Map<string, number>();
	for (const scope of scopes) {
		for (const tag of scope.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	}
	return [...counts].map(([name, count]) => ({ name, count }))
		.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function resolveCanonical(name: string, aliases: SearchAlias[]): string {
	const match = matchingAliases(name, aliases)
		.sort((left, right) =>
			right.variants.length - left.variants.length ||
			right.updatedAt.localeCompare(left.updatedAt) ||
			right.id.localeCompare(left.id)
		)[0];
	return match ? normalizeTagName(match.canonical) : name;
}

function matchingAliases(name: string, aliases: SearchAlias[]): SearchAlias[] {
	const stored = storedName(name);
	return aliases.filter((alias) =>
		isTagAlias(alias) && (alias.canonical === stored || alias.variants.includes(stored))
	);
}

function isTagAlias(alias: SearchAlias): boolean {
	return alias.canonical.startsWith(TAG_ALIAS_PREFIX) &&
		alias.variants.every((variant) => variant.startsWith(TAG_ALIAS_PREFIX));
}

function toTagAlias(alias: SearchAlias): TagAlias {
	return {
		id: alias.id,
		canonicalName: normalizeTagName(alias.canonical),
		variants: alias.variants.map((variant) => normalizeTagName(variant)),
		createdAt: alias.createdAt,
		updatedAt: alias.updatedAt,
	};
}

function storedName(name: string): string {
	return `${TAG_ALIAS_PREFIX}${normalizeTagName(name)}`;
}

function uniqueNames(names: string[]): string[] {
	return [...new Set(names.map((name) => normalizeTagName(name)))];
}

function normalizeTagName(value: string, allowEmpty = false): string {
	const normalized = normalizeSearchText(normalizeSearchText(value).replace(/^#/, ""));
	if (!normalized && allowEmpty) return "";
	const parsed = parseMarkdownCandidates(`#${normalized}`).tags[0];
	if (!parsed || parsed.range.end !== normalized.length + 1) {
		throw new Error(`不正なタグ名です: ${value}`);
	}
	return normalized;
}

function compareBranch(
	left: { workId: string; id: string },
	right: { workId: string; id: string },
): number {
	return left.workId.localeCompare(right.workId) || left.id.localeCompare(right.id);
}

function compareRevision(left: Revision, right: Revision): number {
	return left.workId.localeCompare(right.workId) ||
		left.createdAt.localeCompare(right.createdAt) ||
		left.id.localeCompare(right.id);
}
