import type {
	Branch,
	LinkType,
	OutlineLink,
	ScopedTagSet,
	SearchAlias,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { isSymmetricLinkType } from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";
import { normalizeSearchText, titleFromText } from "./search_text.ts";
import { TagService } from "./tag_service.ts";

export interface DuplicateWorkRef {
	workId: string;
	title: string;
}

export interface DuplicateReason {
	kind: "title" | "alias" | "tag" | "link";
	label: string;
	score: number;
}

export interface DuplicateCandidate {
	workA: DuplicateWorkRef;
	workB: DuplicateWorkRef;
	score: number;
	reasons: DuplicateReason[];
}

interface WorkContext {
	work: Work;
	branch: Branch;
	copy: WorkingCopy;
	title: string;
	normalizedTitle: string;
	tags: string[];
	linkKeys: Set<string>;
}

/**
 * 重複候補を計算のみで求める読み取り専用サービス。
 * 永続化・書き込みは一切行わない。
 */
export class DuplicateCandidateService {
	constructor(private readonly store: GraphStore) {}

	async listCandidates(limit = 50): Promise<DuplicateCandidate[]> {
		const [works, branches, copies, links, aliases, scopedTags] = await Promise.all([
			this.store.listWorks(true),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
			this.store.listLinks(),
			this.store.listAliases(),
			new TagService(this.store).listScopedTags(),
		]);

		const activeWorks = works.filter((work) => !work.deletedAt && !work.mergedIntoWorkId);
		const contexts = this.buildContexts(activeWorks, branches, copies, scopedTags);
		const titleByWorkId = new Map(
			activeWorks.map((work) => [work.id, this.resolveTitle(work, branches, copies)]),
		);
		const candidates = this.computeCandidates(contexts, links, aliases, titleByWorkId);

		return candidates.slice(0, limit);
	}

	private buildContexts(
		works: Work[],
		branches: Branch[],
		copies: WorkingCopy[],
		scopedTags: ScopedTagSet[],
	): WorkContext[] {
		const contexts: WorkContext[] = [];

		for (const work of works) {
			if (work.deletedAt) continue;

			const main = branches.find((branch) =>
				branch.workId === work.id && branch.name === "main" && !branch.archivedAt
			);
			if (!main) continue;

			const copy = copies.find((candidate) => candidate.branchId === main.id);
			if (!copy) continue;

			const title = titleFromText(copy.text);
			const normalizedTitle = normalizeSearchText(title);

			const tags = scopedTags
				.filter((scope) => scope.scope.kind === "working-copy" && scope.scope.branchId === main.id)
				.flatMap((scope) => scope.tags);

			contexts.push({
				work,
				branch: main,
				copy,
				title,
				normalizedTitle,
				tags: [...new Set(tags)].sort(),
				linkKeys: new Set(),
			});
		}

		return contexts;
	}

	private resolveTitle(work: Work, branches: Branch[], copies: WorkingCopy[]): string {
		const main = branches.find((branch) =>
			branch.workId === work.id && branch.name === "main" && !branch.archivedAt
		);
		if (!main) return "";
		const copy = copies.find((candidate) => candidate.branchId === main.id);
		if (!copy) return "";
		return titleFromText(copy.text);
	}

	private computeCandidates(
		contexts: WorkContext[],
		links: OutlineLink[],
		aliases: SearchAlias[],
		titleByWorkId: Map<string, string>,
	): DuplicateCandidate[] {
		this.populateLinkKeys(contexts, links);

		const sorted = [...contexts].sort((left, right) =>
			left.title.localeCompare(right.title) || left.work.id.localeCompare(right.work.id)
		);

		const candidates: DuplicateCandidate[] = [];

		for (let i = 0; i < sorted.length; i++) {
			for (let j = i + 1; j < sorted.length; j++) {
				const contextA = sorted[i];
				const contextB = sorted[j];
				const reasons = this.computeReasons(contextA, contextB, aliases, titleByWorkId);
				const score = reasons.reduce((sum, reason) => sum + reason.score, 0);

				if (score >= 2) {
					candidates.push({
						workA: { workId: contextA.work.id, title: contextA.title },
						workB: { workId: contextB.work.id, title: contextB.title },
						score,
						reasons,
					});
				}
			}
		}

		return candidates.sort((left, right) =>
			right.score - left.score ||
			left.workA.title.localeCompare(right.workA.title) ||
			left.workB.title.localeCompare(right.workB.title) ||
			left.workA.workId.localeCompare(right.workA.workId) ||
			left.workB.workId.localeCompare(right.workB.workId)
		);
	}

	private populateLinkKeys(contexts: WorkContext[], links: OutlineLink[]): void {
		const contextByWorkId = new Map(contexts.map((context) => [context.work.id, context]));

		for (const link of links) {
			if (link.status === "retracted") continue;

			const fromContext = contextByWorkId.get(link.fromId);
			const toContext = contextByWorkId.get(link.toId);

			if (isSymmetricLinkType(link.type)) {
				if (fromContext) {
					fromContext.linkKeys.add(`${link.type}:${link.toId}`);
				}
				if (toContext) {
					toContext.linkKeys.add(`${link.type}:${link.fromId}`);
				}
			} else {
				if (fromContext) {
					fromContext.linkKeys.add(`${link.type}:${link.toId}`);
				}
			}
		}
	}

	private computeReasons(
		contextA: WorkContext,
		contextB: WorkContext,
		aliases: SearchAlias[],
		titleByWorkId: Map<string, string>,
	): DuplicateReason[] {
		const reasons: DuplicateReason[] = [];

		if (
			contextA.normalizedTitle && contextB.normalizedTitle &&
			contextA.normalizedTitle === contextB.normalizedTitle
		) {
			reasons.push({
				kind: "title",
				label: `タイトルが一致: 「${contextA.title}」`,
				score: 3,
			});
		}

		const aliasReason = this.findAliasReason(contextA, contextB, aliases);
		if (aliasReason) reasons.push(aliasReason);

		const tagReasons = this.findTagReasons(contextA, contextB);
		reasons.push(...tagReasons);

		const linkReasons = this.findLinkReasons(contextA, contextB, titleByWorkId);
		reasons.push(...linkReasons);

		return reasons;
	}

	private findAliasReason(
		contextA: WorkContext,
		contextB: WorkContext,
		aliases: SearchAlias[],
	): DuplicateReason | null {
		if (!contextA.normalizedTitle || !contextB.normalizedTitle) return null;

		// タグ用 alias (canonical が # で始まり variants も全て # 始まり) は対象外
		// tag_service.ts の isTagAlias 参照
		const searchAliases = aliases
			.filter((alias) =>
				!(alias.canonical.startsWith("#") &&
					alias.variants.every((variant) => variant.startsWith("#")))
			)
			.sort((left, right) =>
				left.canonical.localeCompare(right.canonical) || left.id.localeCompare(right.id)
			);

		for (const alias of searchAliases) {
			const termSet = new Set(
				[alias.canonical, ...alias.variants].map((term) => normalizeSearchText(term)),
			);
			if (termSet.has(contextA.normalizedTitle) && termSet.has(contextB.normalizedTitle)) {
				return {
					kind: "alias",
					label: `検索別名「${alias.canonical}」で同一の名前`,
					score: 2,
				};
			}
		}

		return null;
	}

	private findTagReasons(contextA: WorkContext, contextB: WorkContext): DuplicateReason[] {
		const commonTags = contextA.tags.filter((tag) => contextB.tags.includes(tag));
		return commonTags.map((tag) => ({
			kind: "tag",
			label: `共通タグ: #${tag}`,
			score: 1,
		}));
	}

	private findLinkReasons(
		contextA: WorkContext,
		contextB: WorkContext,
		titleByWorkId: Map<string, string>,
	): DuplicateReason[] {
		const commonKeys = [...contextA.linkKeys].filter((key) => contextB.linkKeys.has(key));

		return commonKeys
			.map((key) => {
				const [type, thirdWorkId] = key.split(":", 2) as [LinkType, string];
				return { type, thirdWorkId };
			})
			.filter(({ thirdWorkId }) =>
				thirdWorkId !== contextA.work.id && thirdWorkId !== contextB.work.id
			)
			.sort((left, right) =>
				left.type.localeCompare(right.type) || left.thirdWorkId.localeCompare(right.thirdWorkId)
			)
			.map(({ type, thirdWorkId }) => {
				const thirdTitle = titleByWorkId.get(thirdWorkId) || thirdWorkId;
				return {
					kind: "link" as const,
					label: `共通リンク: 両方が「${thirdTitle}」へ${type}`,
					score: 1,
				};
			});
	}
}
