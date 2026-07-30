import type { LinkEndpoint, OutlineLink, SearchAlias, SystemRelation } from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";
import { ComparisonService, type WorkComparisonDocuments } from "./comparison_service.ts";
import { titleFromText } from "./search_text.ts";

export interface BranchRenamePreview {
	branchId: string;
	from: string;
	to: string;
}

export interface LinkMergePreview {
	id: string;
	type: OutlineLink["type"];
	from: LinkEndpoint;
	to: LinkEndpoint;
	afterFrom: LinkEndpoint;
	afterTo: LinkEndpoint;
	willRetract: boolean;
}

export interface WorkMergePreview {
	sourceWorkId: string;
	survivorWorkId: string;
	sourceTitle: string;
	survivorTitle: string;
	documents: {
		source: WorkComparisonDocuments;
		survivor: WorkComparisonDocuments;
	};
	occurrenceIds: string[];
	branchRenames: BranchRenamePreview[];
	revisionIds: string[];
	recoverySnapshotIds: string[];
	links: LinkMergePreview[];
	systemRelations: SystemRelation[];
	aliases: SearchAlias[];
	mergedAt: string;
	aliasAfterMerge?: SearchAlias;
}

interface WorkMergeServiceOptions {
	now?: () => string;
	createAliasId?: () => string;
}

export class WorkMergeService {
	private readonly now: () => string;
	private readonly createAliasId: () => string;

	constructor(private readonly store: GraphStore, options: WorkMergeServiceOptions = {}) {
		this.now = options.now ?? (() => new Date().toISOString());
		this.createAliasId = options.createAliasId ?? (() => crypto.randomUUID());
	}

	async preview(sourceWorkId: string, survivorWorkId: string): Promise<WorkMergePreview> {
		if (sourceWorkId === survivorWorkId) {
			throw new Error("Duplicate merge requires two different Works");
		}
		const [works, branches, copies, occurrences, revisions, snapshots, links, aliases, relations] =
			await Promise.all([
				this.store.listWorks(),
				this.store.listBranches(),
				this.store.listWorkingCopies(),
				this.store.listOccurrences(),
				this.store.listRevisions(),
				this.store.listRecoverySnapshots(),
				this.store.listLinks(),
				this.store.listAliases(),
				this.store.listSystemRelations(),
			]);
		if (!works.some((work) => work.id === sourceWorkId)) {
			throw new Error(`Active source Work not found: ${sourceWorkId}`);
		}
		if (!works.some((work) => work.id === survivorWorkId)) {
			throw new Error(`Active survivor Work not found: ${survivorWorkId}`);
		}
		const title = (workId: string) => {
			const main = branches.find((branch) =>
				branch.workId === workId && branch.name === "main" && !branch.archivedAt
			);
			const copy = copies.find((entry) => entry.workId === workId && entry.branchId === main?.id);
			return titleFromText(copy?.text ?? "");
		};
		const sourceTitle = title(sourceWorkId);
		const survivorTitle = title(survivorWorkId);
		const mergedAt = this.now();
		const relevantAliases = aliases.filter((alias) =>
			alias.canonical === sourceTitle || alias.canonical === survivorTitle ||
			alias.variants.includes(sourceTitle) || alias.variants.includes(survivorTitle)
		);
		const variants = [
			sourceTitle,
			...relevantAliases.flatMap((alias) => [alias.canonical, ...alias.variants]),
		].filter((value, index, all) =>
			value && value !== survivorTitle && all.indexOf(value) === index
		);
		const aliasAfterMerge: SearchAlias | undefined = survivorTitle && variants.length > 0
			? {
				id: this.createAliasId(),
				canonical: survivorTitle,
				variants,
				createdAt: mergedAt,
				updatedAt: mergedAt,
			}
			: undefined;
		const transformedLinks = links.map((link) => transformLink(link, sourceWorkId, survivorWorkId));
		const duplicateIds = duplicateActiveLinkIds(transformedLinks);
		const comparison = new ComparisonService(this.store);

		return {
			sourceWorkId,
			survivorWorkId,
			sourceTitle,
			survivorTitle,
			documents: {
				source: await comparison.listWorkDocuments(sourceWorkId),
				survivor: await comparison.listWorkDocuments(survivorWorkId),
			},
			occurrenceIds: occurrences.filter((entry) => entry.workId === sourceWorkId).map((entry) =>
				entry.id
			),
			branchRenames: branches.filter((entry) => entry.workId === sourceWorkId).map((branch) => ({
				branchId: branch.id,
				from: branch.name,
				to: `merged/${sourceWorkId}/${branch.name}`,
			})),
			revisionIds: revisions.filter((entry) => entry.workId === sourceWorkId).map((entry) =>
				entry.id
			),
			recoverySnapshotIds: snapshots.filter((entry) => entry.workId === sourceWorkId).map(
				(entry) => entry.id,
			),
			links: links.filter((link) =>
				link.from.workId === sourceWorkId || link.to.workId === sourceWorkId
			).map((link) => {
				const after = transformLink(link, sourceWorkId, survivorWorkId);
				return {
					id: link.id,
					type: link.type,
					from: link.from,
					to: link.to,
					afterFrom: after.from,
					afterTo: after.to,
					willRetract: duplicateIds.has(link.id),
				};
			}),
			systemRelations: relations.filter((relation) =>
				relation.fromWorkId === sourceWorkId || relation.toWorkId === sourceWorkId
			),
			aliases: relevantAliases,
			mergedAt,
			aliasAfterMerge,
		};
	}

	async merge(preview: WorkMergePreview): Promise<void> {
		await this.store.mergeWorks({
			sourceWorkId: preview.sourceWorkId,
			survivorWorkId: preview.survivorWorkId,
			mergedAt: preview.mergedAt,
			alias: preview.aliasAfterMerge,
		});
	}
}

function transformLink(
	link: OutlineLink,
	sourceWorkId: string,
	survivorWorkId: string,
): OutlineLink {
	const replace = (endpoint: LinkEndpoint): LinkEndpoint =>
		endpoint.workId === sourceWorkId ? { ...endpoint, workId: survivorWorkId } : endpoint;
	const from = replace(link.from);
	const to = replace(link.to);
	return { ...link, from, to, fromId: from.workId, toId: to.workId };
}

function duplicateActiveLinkIds(links: readonly OutlineLink[]): Set<string> {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const link of links) {
		if (link.status === "retracted") continue;
		let left = JSON.stringify(link.from);
		let right = JSON.stringify(link.to);
		if (["RELATED", "LIKE", "VS"].includes(link.type) && left > right) {
			[left, right] = [right, left];
		}
		const key = `${link.type}|${left}|${right}`;
		if (left === right || seen.has(key)) duplicates.add(link.id);
		else seen.add(key);
	}
	return duplicates;
}
