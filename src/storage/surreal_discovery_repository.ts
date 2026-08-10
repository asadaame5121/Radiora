import { RecordId } from "surrealdb";
import type {
	EmergenceAction,
	EmergenceSuggestion,
	LexicalHit,
	OutlineItem,
	OutlineLink,
	SavedRuleQuery,
	SearchAlias,
} from "../domain/models.ts";
import { isSymmetricLinkType } from "../domain/models.ts";
import {
	countOccurrences,
	normalizeSearchText,
	searchTerms,
	titleOf,
} from "../services/search_text.ts";
import type { DiscoveryStorePort } from "./graph_store.ts";
import {
	emergenceAcceptanceTransactionQuery,
	emergenceSuggestionUpsertQuery,
} from "./surreal_queries.ts";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import {
	emergenceFeedbackActionFromRow,
	emergenceSuggestionFromRow,
	savedRuleQueryFromRow,
	searchAliasFromRow,
	type SurrealRow as Row,
} from "./surreal_row_mapper.ts";

export type OutlineItemLoader = () => Promise<OutlineItem[]>;

/** SurrealDB-backed repository for search, discovery, and saved-query data. */
export class SurrealDiscoveryRepository implements DiscoveryStorePort {
	constructor(
		private readonly queryClient: SurrealQueryClient,
		private readonly loadItems: OutlineItemLoader,
	) {}

	async suggestItems(prefix: string, limit: number): Promise<OutlineItem[]> {
		const normalized = normalizeSearchText(prefix);
		if (!normalized) return [];
		return this.representativeItems(await this.loadItems())
			.filter((item) => normalizeSearchText(titleOf(item)).startsWith(normalized))
			.sort((a, b) =>
				titleOf(a).length - titleOf(b).length || b.updatedAt.localeCompare(a.updatedAt)
			)
			.slice(0, limit);
	}

	async searchLexical(query: string, limit: number): Promise<LexicalHit[]> {
		const normalized = normalizeSearchText(query);
		if (!normalized) return [];
		const terms = searchTerms(query);
		return this.representativeItems(await this.loadItems()).map((item) => {
			const title = normalizeSearchText(titleOf(item));
			const body = normalizeSearchText(item.text);
			const tokens = terms.split(" ").filter(Boolean);
			const titleScore = (title === normalized ? 3 : title.startsWith(normalized) ? 2 : 0) +
				countOccurrences(title, normalized) +
				tokens.reduce((score, token) => score + countOccurrences(title, token), 0);
			const bodyScore = countOccurrences(body, normalized) +
				tokens.reduce((score, token) => score + countOccurrences(body, token), 0);
			return { item, titleScore, bodyScore };
		}).filter((hit) => hit.titleScore > 0 || hit.bodyScore > 0)
			.sort((a, b) => (b.titleScore * 2 + b.bodyScore) - (a.titleScore * 2 + a.bodyScore))
			.slice(0, limit);
	}

	async listAliases(): Promise<SearchAlias[]> {
		const [rows] = await this.queryClient.query<[Row[]]>(
			`SELECT record::id(id) AS id, canonical, variants, created_at, updated_at
				FROM search_alias ORDER BY canonical;`,
		);
		return rows.map(searchAliasFromRow);
	}

	async upsertAlias(alias: SearchAlias): Promise<void> {
		await this.queryClient.query(
			`UPSERT $record CONTENT {
				canonical: $canonical, variants: $variants,
				created_at: $createdAt, updated_at: $updatedAt
			};`,
			{ ...alias, record: new RecordId("search_alias", alias.id) },
		);
	}

	async deleteAlias(id: string): Promise<void> {
		await this.queryClient.query(`DELETE $record;`, {
			record: new RecordId("search_alias", id),
		});
	}

	async getEmergenceFeedback(id: string): Promise<"accept" | "dismiss" | "pin" | null> {
		const [rows] = await this.queryClient.query<[Row[]]>(
			`SELECT action FROM $record;`,
			{ record: new RecordId("emergence_feedback", id) },
		);
		return rows[0] ? emergenceFeedbackActionFromRow(rows[0]) : null;
	}

	async setEmergenceFeedback(
		id: string,
		action: "accept" | "dismiss" | "pin",
	): Promise<void> {
		await this.queryClient.query(
			`UPSERT $record CONTENT { action: $action, updated_at: $updatedAt };`,
			{
				action,
				updatedAt: new Date().toISOString(),
				record: new RecordId("emergence_feedback", id),
			},
		);
	}

	async listEmergenceSuggestions(): Promise<EmergenceSuggestion[]> {
		const [rows] = await this.queryClient.query<[Row[]]>(
			`SELECT record::id(id) AS id, kind, record::id(context_work) AS context_work_id,
				record::id(target_work) AS target_work_id, context_occurrence_id,
				target_occurrence_id, proposed_link_type, title, explanation, evidence,
				score, status, created_at, updated_at, resolved_at, resolution_reason
				FROM emergence_suggestion ORDER BY updated_at DESC;`,
		);
		return rows.map(emergenceSuggestionFromRow);
	}

	async upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void> {
		await this.queryClient.query(
			emergenceSuggestionUpsertQuery(suggestion.proposedLinkType !== undefined),
			{
				...suggestion,
				record: new RecordId("emergence_suggestion", suggestion.id),
				contextWork: new RecordId("work", suggestion.contextWorkId),
				targetWork: new RecordId("work", suggestion.targetWorkId),
				...(suggestion.proposedLinkType ? { proposedLinkType: suggestion.proposedLinkType } : {}),
				pending: "pending",
			},
		);
	}

	async resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		link?: OutlineLink,
		reason?: string,
	): Promise<void> {
		const status = action === "accept" ? "accepted" : action === "dismiss" ? "dismissed" : "held";
		const now = new Date().toISOString();
		const normalizedReason = reason?.trim();
		if (action === "dismiss" && !normalizedReason) {
			throw new Error("Dismissed emergence suggestion requires a reason");
		}
		if (action !== "accept") {
			await this.queryClient.query(
				`UPDATE $suggestion SET status = $status, updated_at = $updatedAt,
					resolved_at = ${status === "held" ? "NONE" : "$updatedAt"},
					resolution_reason = ${status === "held" ? "NONE" : "$reason"}
					WHERE status IN ["pending", "held", $status];`,
				{
					suggestion: new RecordId("emergence_suggestion", id),
					status,
					updatedAt: now,
					...(normalizedReason ? { reason: normalizedReason } : {}),
				},
			);
			return;
		}
		if (!link || link.origin !== "suggestion" || link.status !== "asserted") {
			throw new Error("Accepted emergence suggestion requires an asserted suggestion link");
		}
		await this.queryClient.query(
			emergenceAcceptanceTransactionQuery(
				link.reason !== undefined,
				isSymmetricLinkType(link.type),
				normalizedReason !== undefined,
			),
			{
				suggestion: new RecordId("emergence_suggestion", id),
				link: new RecordId("semantic_link", link.id),
				fromWork: new RecordId("work", link.from.workId),
				toWork: new RecordId("work", link.to.workId),
				type: link.type,
				...(link.reason === undefined ? {} : { reason: link.reason }),
				...(normalizedReason === undefined ? {} : { resolutionReason: normalizedReason }),
				createdAt: link.createdAt,
				updatedAt: now,
			},
		);
	}

	async listSavedRuleQueries(): Promise<SavedRuleQuery[]> {
		const [rows] = await this.queryClient.query<[Row[]]>(
			`SELECT record::id(id) AS id, name, source, created_at, updated_at
				FROM saved_rule_query ORDER BY updated_at DESC;`,
		);
		return rows.map(savedRuleQueryFromRow);
	}

	async upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		await this.queryClient.query(
			`UPSERT $record CONTENT {
				name: $name, source: $source, created_at: $createdAt, updated_at: $updatedAt
			};`,
			{ ...query, record: new RecordId("saved_rule_query", query.id) },
		);
	}

	async deleteSavedRuleQuery(id: string): Promise<void> {
		await this.queryClient.query(`DELETE $record;`, {
			record: new RecordId("saved_rule_query", id),
		});
	}

	private representativeItems(items: OutlineItem[]): OutlineItem[] {
		const byWork = new Map<string, OutlineItem>();
		for (const item of items) {
			if (!byWork.has(item.workId)) byWork.set(item.workId, item);
		}
		return [...byWork.values()];
	}
}
