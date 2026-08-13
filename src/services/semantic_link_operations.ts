import type {
	CreateLinkInput,
	LinkEndpoint,
	OutlineLink,
	RelationTypeDefinition,
	RelationTypeName,
} from "../domain/models.ts";
import { DEFAULT_RELATION_TYPE_DEFINITIONS, normalizeRelationTypeName } from "../domain/models.ts";
import type { OutlineStorePort, RelationStorePort, WorkStorePort } from "../storage/graph_store.ts";

type SemanticLinkStore = OutlineStorePort & RelationStorePort & WorkStorePort;

/** Small catalog port kept separate from the graph store's persistence responsibilities. */
export interface RelationTypeCatalogPort {
	listRelationTypeDefinitions(): Promise<readonly RelationTypeDefinition[]>;
}

const builtInRelationTypeCatalog: RelationTypeCatalogPort = {
	listRelationTypeDefinitions: () => Promise.resolve(DEFAULT_RELATION_TYPE_DEFINITIONS),
};

function sameEndpoint(left: LinkEndpoint, right: LinkEndpoint): boolean {
	if (left.scope !== right.scope || left.workId !== right.workId) return false;
	return left.scope === "work" ||
		(right.scope === "revision" && left.revisionId === right.revisionId);
}

/**
 * Owns semantic-link validation and endpoint normalization while keeping storage
 * persistence behind the injected store-port boundary.
 */
export class SemanticLinkOperations {
	constructor(
		private readonly store: SemanticLinkStore,
		private readonly relationTypes: RelationTypeCatalogPort = builtInRelationTypeCatalog,
	) {}

	private async requireDefinition(type: RelationTypeName): Promise<RelationTypeDefinition> {
		let normalized: RelationTypeName;
		try {
			normalized = normalizeRelationTypeName(type);
		} catch (cause) {
			throw new Error(`Unsupported link type: ${type}`, { cause });
		}
		const definition = (await this.relationTypes.listRelationTypeDefinitions()).find(
			(candidate) => candidate.name === normalized,
		);
		if (!definition) throw new Error(`Unsupported link type: ${type}`);
		return definition;
	}

	async createLink(input: CreateLinkInput): Promise<void> {
		const definition = await this.requireDefinition(input.type);
		const type = definition.name;
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
		const validateEndpoint = (
			endpoint: LinkEndpoint,
			resolvedWorkId: string,
			label: string,
		): void => {
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
		};
		validateEndpoint(from, resolvedFromWorkId, "From");
		validateEndpoint(to, resolvedToWorkId, "To");
		if (from.workId === to.workId) throw new Error("A related link cannot target the same work");
		let fromId = from.workId;
		let toId = to.workId;
		let fromEndpoint = from;
		let toEndpoint = to;
		if (definition.direction === "symmetric" && fromId.localeCompare(toId) > 0) {
			[fromId, toId] = [toId, fromId];
			[fromEndpoint, toEndpoint] = [toEndpoint, fromEndpoint];
		}
		if (definition.direction === "symmetric") {
			const duplicate = (await this.listActiveLinks()).some((link) =>
				link.type === type && sameEndpoint(link.from, fromEndpoint) &&
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
			type,
			status: input.status ?? "asserted",
			origin: input.origin ?? "human",
			createdAt: new Date().toISOString(),
			reason: input.reason?.trim() || undefined,
		});
	}

	async deleteLink(fromId: string, toId: string, type: RelationTypeName): Promise<void> {
		const definition = await this.requireDefinition(type);
		const items = await this.store.listItems();
		let fromWorkId = items.find((item) => item.id === fromId)?.workId ?? fromId;
		let toWorkId = items.find((item) => item.id === toId)?.workId ?? toId;
		if (definition.direction === "symmetric" && fromWorkId.localeCompare(toWorkId) > 0) {
			[fromWorkId, toWorkId] = [toWorkId, fromWorkId];
		}
		return this.store.deleteLink(fromWorkId, toWorkId, definition.name);
	}

	private async listActiveLinks(): Promise<OutlineLink[]> {
		return (await this.store.listLinks()).filter((link) => link.status !== "retracted");
	}
}
