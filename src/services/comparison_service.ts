import type { LinkEndpoint, LinkType, OutlineLink, Revision } from "../domain/models.ts";
import type { OutlineStorePort, RelationStorePort, WorkStorePort } from "../storage/graph_store.ts";
import { mergeImplicitFromLinks } from "./implicit_relation.ts";
import { titleFromText } from "./search_text.ts";

export const COMPARABLE_LINK_TYPES = ["FROM", "FIX", "VS"] as const satisfies readonly LinkType[];
export type ComparableLinkType = (typeof COMPARABLE_LINK_TYPES)[number];

type ComparisonStore = RelationStorePort & WorkStorePort & OutlineStorePort;

export interface ComparisonDocument {
	scope: "work" | "branch" | "revision";
	workId: string;
	branchId?: string;
	revisionId?: string;
	title: string;
	text: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface WorkComparisonDocuments {
	workId: string;
	documents: ComparisonDocument[];
}

export interface LinkComparisonProjection {
	kind: "semantic-link";
	linkId: string;
	type: ComparableLinkType;
	direction: "directed" | "symmetric";
	createdAt: string;
	reason?: string;
	left: ComparisonDocument;
	right: ComparisonDocument;
}

/**
 * Resolves an existing semantic link into immutable display data.
 *
 * This service is deliberately read-only. Work endpoints follow the active main
 * Branch Working Copy, while Revision endpoints stay pinned to their immutable text.
 * The stored from -> to endpoint order is retained even for symmetric VS links.
 */
export class ComparisonService {
	constructor(private readonly store: ComparisonStore) {}

	async resolveLink(linkId: string): Promise<LinkComparisonProjection> {
		const [works, branches, copies, revisions, links, items] = await Promise.all([
			this.store.listWorks(),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
			this.store.listRevisions(),
			this.store.listLinks(),
			this.store.listItems(),
		]);
		const activeWorkIds = new Set(works.map((work) => work.id));
		const mergedLinks = mergeImplicitFromLinks(items, links);
		const link = mergedLinks.find((candidate) =>
			candidate.id === linkId && candidate.status !== "retracted"
		);
		if (!link) throw new Error(`Active semantic Link not found: ${linkId}`);
		if (!isComparableLinkType(link.type)) {
			throw new Error(`Semantic Link type cannot be compared: ${link.type}`);
		}
		if (link.from.workId === link.to.workId) {
			throw new Error(`Semantic Link cannot compare the same Work on both endpoints: ${link.id}`);
		}

		return {
			kind: "semantic-link",
			linkId: link.id,
			type: link.type,
			direction: link.type === "VS" ? "symmetric" : "directed",
			createdAt: link.createdAt,
			...(link.reason ? { reason: link.reason } : {}),
			left: resolveEndpoint(link, link.from, activeWorkIds, branches, copies, revisions),
			right: resolveEndpoint(link, link.to, activeWorkIds, branches, copies, revisions),
		};
	}

	async listWorkDocuments(workId: string): Promise<WorkComparisonDocuments> {
		const [works, branches, copies, revisions] = await Promise.all([
			this.store.listWorks(),
			this.store.listBranches(workId),
			this.store.listWorkingCopies(workId),
			this.store.listRevisions(workId),
		]);
		if (!works.some((work) => work.id === workId)) {
			throw new Error(`Active Work not found: ${workId}`);
		}
		// A Branch is the live line of work, so it always compares its current
		// Working Copy. Its immutable head remains available separately below as
		// a Revision candidate, even when both currently have identical text.
		const documents: ComparisonDocument[] = branches.map((branch) => {
			const matchingCopies = copies.filter((copy) => copy.branchId === branch.id);
			if (matchingCopies.length !== 1) {
				throw new Error(`Expected one Working Copy for Branch: ${branch.id}`);
			}
			const copy = matchingCopies[0];
			return {
				scope: "branch",
				workId,
				branchId: branch.id,
				title: branch.name,
				text: copy.text,
				updatedAt: copy.updatedAt,
			};
		});
		for (const revision of revisions) {
			documents.push({
				scope: "revision",
				workId,
				revisionId: revision.id,
				title: revision.message || titleFromText(revision.text),
				text: revision.text,
				createdAt: revision.createdAt,
			});
		}
		return { workId, documents };
	}
}

export function isComparableLinkType(type: LinkType): type is ComparableLinkType {
	return (COMPARABLE_LINK_TYPES as readonly LinkType[]).includes(type);
}

export function comparisonDocumentKey(document: ComparisonDocument): string {
	if (document.scope === "branch") return `branch:${document.branchId}`;
	if (document.scope === "revision") return `revision:${document.revisionId}`;
	return `work:${document.workId}`;
}

function resolveEndpoint(
	link: OutlineLink,
	endpoint: LinkEndpoint,
	activeWorkIds: ReadonlySet<string>,
	branches: Awaited<ReturnType<WorkStorePort["listBranches"]>>,
	copies: Awaited<ReturnType<WorkStorePort["listWorkingCopies"]>>,
	revisions: readonly Revision[],
): ComparisonDocument {
	if (!activeWorkIds.has(endpoint.workId)) {
		throw new Error(`Semantic Link endpoint Work is not active: ${endpoint.workId}`);
	}
	if (endpoint.scope === "revision") {
		const revision = revisions.find((candidate) => candidate.id === endpoint.revisionId);
		if (!revision || revision.workId !== endpoint.workId) {
			throw new Error(`Semantic Link Revision endpoint is invalid: ${link.id}`);
		}
		return {
			scope: "revision",
			workId: revision.workId,
			revisionId: revision.id,
			title: titleFromText(revision.text),
			text: revision.text,
			createdAt: revision.createdAt,
		};
	}

	const mains = branches.filter((branch) =>
		branch.workId === endpoint.workId && branch.name === "main" && !branch.archivedAt
	);
	if (mains.length !== 1) {
		throw new Error(`Expected one active main Branch for Work: ${endpoint.workId}`);
	}
	const matchingCopies = copies.filter((copy) =>
		copy.workId === endpoint.workId && copy.branchId === mains[0].id
	);
	if (matchingCopies.length !== 1) {
		throw new Error(`Expected one Working Copy for active main Branch: ${mains[0].id}`);
	}
	const copy = matchingCopies[0];
	return {
		scope: "work",
		workId: copy.workId,
		title: titleFromText(copy.text),
		text: copy.text,
		updatedAt: copy.updatedAt,
	};
}
