import type {
	CreateLinkInput,
	LinkEndpoint,
	LinkOrigin,
	LinkType,
	OutlineLink,
} from "../domain/models.ts";
import { BUILT_IN_RELATION_TYPES } from "../domain/relation_type.ts";
import type {
	OutlineStorePort,
	RelationStorePort,
	RelationTypeDefinitionStorePort,
	WorkStorePort,
} from "../storage/graph_store.ts";
import { fetchActiveMergedLinks } from "./implicit_relation.ts";

type SemanticLinkStore =
	& OutlineStorePort
	& RelationStorePort
	& WorkStorePort
	& Partial<RelationTypeDefinitionStorePort>;

function sameEndpoint(left: LinkEndpoint, right: LinkEndpoint): boolean {
	if (left.scope !== right.scope || left.workId !== right.workId) return false;
	return left.scope === "work" ||
		(right.scope === "revision" && left.revisionId === right.revisionId);
}

function validateLinkOrigin(origin: unknown): asserts origin is LinkOrigin | undefined {
	if (
		origin !== undefined && origin !== "human" && origin !== "suggestion" && origin !== "import"
	) {
		throw new Error(`Unsupported link origin: ${String(origin)}`);
	}
}

function validateLinkEndpoint(
	endpoint: LinkEndpoint,
	resolvedWorkId: string,
	label: string,
	workIds: ReadonlySet<string>,
	revisions: readonly { id: string; workId: string }[],
): void {
	if (endpoint.scope !== "work" && endpoint.scope !== "revision") {
		throw new Error(`${label} endpoint scope is invalid`);
	}
	if (endpoint.workId !== resolvedWorkId || !workIds.has(endpoint.workId)) {
		throw new Error(`${label} endpoint does not match the resolved active Work`);
	}
	if (endpoint.scope === "revision") {
		const revision = revisions.find((candidate) => candidate.id === endpoint.revisionId);
		if (!revision || revision.workId !== endpoint.workId) {
			throw new Error(`${label} Revision endpoint does not belong to its Work`);
		}
	}
}

/**
 * Owns semantic-link validation and endpoint normalization while keeping storage
 * persistence behind the injected store-port boundary.
 */
export class SemanticLinkOperations {
	constructor(private readonly store: SemanticLinkStore) {}

	async createLink(input: CreateLinkInput): Promise<void> {
		const definitions = this.store.listRelationTypeDefinitions
			? await this.store.listRelationTypeDefinitions()
			: BUILT_IN_RELATION_TYPES;
		const definition = typeof input.type === "string"
			? definitions.find((d) => d.name === input.type)
			: undefined;
		if (!definition) {
			throw new Error(`Unsupported link type: ${String(input.type)}`);
		}
		validateLinkOrigin(input.origin);
		const [works, occurrences, revisions] = await Promise.all([
			this.store.listWorks(),
			this.store.listOccurrences(),
			this.store.listRevisions(),
		]);
		const workIds = new Set(works.map((work) => work.id));
		const resolveWorkId = (id: string): string => {
			const occurrence = occurrences.find((candidate) => candidate.id === id);
			const workId = workIds.has(id) ? id : occurrence?.workId;
			if (!workId || !workIds.has(workId)) throw new Error(`Active link endpoint not found: ${id}`);
			return workId;
		};
		const resolvedFromWorkId = resolveWorkId(input.fromId);
		const resolvedToWorkId = resolveWorkId(input.toId);
		const from = input.fromEndpoint ?? { scope: "work" as const, workId: resolvedFromWorkId };
		const to = input.toEndpoint ?? { scope: "work" as const, workId: resolvedToWorkId };
		validateLinkEndpoint(from, resolvedFromWorkId, "From", workIds, revisions);
		validateLinkEndpoint(to, resolvedToWorkId, "To", workIds, revisions);
		if (from.workId === to.workId) throw new Error("A related link cannot target the same work");
		let fromId = from.workId;
		let toId = to.workId;
		let fromEndpoint = from;
		let toEndpoint = to;
		const isSymmetric = definition.direction === "symmetric";
		if (isSymmetric && fromId.localeCompare(toId) > 0) {
			[fromId, toId] = [toId, fromId];
			[fromEndpoint, toEndpoint] = [toEndpoint, fromEndpoint];
		}
		if (isSymmetric) {
			const duplicate = (await this.listActiveLinks()).some((link) =>
				link.type === input.type && sameEndpoint(link.from, fromEndpoint) &&
				sameEndpoint(link.to, toEndpoint)
			);
			if (duplicate) return;
		}
		await this.store.createLink({
			id: crypto.randomUUID(),
			fromId,
			toId,
			from: fromEndpoint,
			to: toEndpoint,
			type: input.type,
			status: input.status ?? "asserted",
			origin: input.origin ?? "human",
			createdAt: new Date().toISOString(),
			reason: input.reason?.trim() || undefined,
		});
	}

	async deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		const definitions = this.store.listRelationTypeDefinitions
			? await this.store.listRelationTypeDefinitions()
			: BUILT_IN_RELATION_TYPES;
		const definition = typeof type === "string"
			? definitions.find((d) => d.name === type)
			: undefined;
		if (!definition) {
			throw new Error(`Unsupported link type: ${String(type)}`);
		}
		const items = await this.store.listItems();
		let fromWorkId = items.find((item) => item.id === fromId)?.workId ?? fromId;
		let toWorkId = items.find((item) => item.id === toId)?.workId ?? toId;
		if (definition.direction === "symmetric" && fromWorkId.localeCompare(toWorkId) > 0) {
			[fromWorkId, toWorkId] = [toWorkId, fromWorkId];
		}
		return this.store.deleteLink(fromWorkId, toWorkId, type);
	}

	private listActiveLinks(): Promise<OutlineLink[]> {
		return fetchActiveMergedLinks(this.store);
	}
}
