import type {
	RuleQueryResult,
	SavedRuleQuery,
	SearchResult,
	TransientProjectionNode,
} from "../domain/models.ts";
import type {
	DiscoveryStorePort,
	OutlineStorePort,
	RelationStorePort,
} from "../storage/graph_store.ts";
import { ancestorsOf } from "./discovery_helpers.ts";
import { fetchActiveMergedLinks } from "./implicit_relation.ts";
import { runRuleQuery } from "./rule_query.ts";
import { buildSparseOutline } from "./sparse_outline.ts";

type RuleQueryStore =
	& Pick<OutlineStorePort, "listItems">
	& Pick<RelationStorePort, "listLinks">
	& Pick<
		DiscoveryStorePort,
		"listSavedRuleQueries" | "upsertSavedRuleQuery" | "deleteSavedRuleQuery"
	>;

export class DiscoveryRuleQueryOperations {
	constructor(private readonly store: RuleQueryStore) {}

	async runRuleQuery(source: string, limit = 500): Promise<RuleQueryResult> {
		const [items, links] = await Promise.all([
			this.store.listItems(),
			fetchActiveMergedLinks(this.store),
		]);
		const representativeByWork = new Map<string, string>();
		for (const item of items) {
			if (!representativeByWork.has(item.workId)) representativeByWork.set(item.workId, item.id);
		}
		const occurrenceLinks = links.flatMap((link) => {
			const fromId = representativeByWork.get(link.from.workId);
			const toId = representativeByWork.get(link.to.workId);
			return fromId && toId ? [{ ...link, fromId, toId }] : [];
		});
		return runRuleQuery(source, items, occurrenceLinks, limit);
	}

	listSavedRuleQueries(): Promise<SavedRuleQuery[]> {
		return this.store.listSavedRuleQueries();
	}

	async saveRuleQuery(
		input: { id?: string; name: string; source: string },
	): Promise<SavedRuleQuery> {
		const now = new Date().toISOString();
		const existing = input.id
			? (await this.store.listSavedRuleQueries()).find((query) => query.id === input.id)
			: undefined;
		await this.runRuleQuery(input.source, 1);
		const saved: SavedRuleQuery = {
			id: input.id ?? crypto.randomUUID(),
			name: input.name.trim() || "名称未設定",
			source: input.source,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		await this.store.upsertSavedRuleQuery(saved);
		return saved;
	}

	deleteRuleQuery(id: string): Promise<void> {
		return this.store.deleteSavedRuleQuery(id);
	}

	async buildQueryProjectionNodes(
		queryId: string,
		limit = 500,
	): Promise<{ nodes: TransientProjectionNode[]; result: RuleQueryResult }> {
		const query = (await this.store.listSavedRuleQueries()).find((entry) => entry.id === queryId);
		if (!query) throw new Error("Saved Rule Query not found");
		const [result, items, links] = await Promise.all([
			this.runRuleQuery(query.source, limit),
			this.store.listItems(),
			fetchActiveMergedLinks(this.store),
		]);
		const itemsById = new Map(items.map((item) => [item.id, item]));
		const seenIds = new Set<string>();
		const pseudoResults: SearchResult[] = [];
		for (const row of result.rows) {
			for (const cell of row) {
				if (seenIds.has(cell)) continue;
				const item = itemsById.get(cell);
				if (!item) continue;
				seenIds.add(cell);
				pseudoResults.push({
					item,
					ancestorIds: ancestorsOf(item, itemsById),
					score: 1,
					reasons: [{ kind: "title", label: "Query一致", score: 1 }],
				});
			}
		}
		return { nodes: buildSparseOutline(pseudoResults, items, links, "query"), result };
	}
}
