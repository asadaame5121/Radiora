import type {
	OutlineItem,
	SearchResult,
	TransientProjectionNode,
	TransientProjectionSource,
} from "../domain/models.ts";
import type { DateProjection } from "./date_projection.ts";

export class TransientProjectionService {
	buildSearchProjection(results: SearchResult[]): TransientProjectionNode[] {
		return results.map((result) => ({
			workId: result.item.workId,
			occurrenceId: result.item.id,
			text: result.item.text,
			sourceType: "search" as const,
			breadcrumb: result.ancestorIds,
			reasons: result.reasons,
			score: result.score,
		}));
	}

	buildTodayProjection(projection: DateProjection): TransientProjectionNode[] {
		return buildDateProjectionNodes(projection, "today");
	}

	buildQueryProjection(
		rows: string[][],
		itemsById: Map<string, OutlineItem>,
	): TransientProjectionNode[] {
		const seen = new Set<string>();
		const result: TransientProjectionNode[] = [];
		for (const row of rows) {
			for (const cell of row) {
				if (seen.has(cell)) continue;
				const item = itemsById.get(cell);
				if (!item) continue;
				seen.add(cell);
				result.push({
					workId: item.workId,
					occurrenceId: item.id,
					text: item.text,
					sourceType: "query" as const,
				});
			}
		}
		return result;
	}
}

export function buildDateProjectionNodes(
	projection: DateProjection,
	sourceType: TransientProjectionSource,
): TransientProjectionNode[] {
	const nodes: TransientProjectionNode[] = [];
	for (const entries of [projection.created, projection.updated]) {
		for (const entry of entries) {
			for (const placement of entry.placements) {
				const occurrenceId = placement.occurrence.id;
				nodes.push({
					workId: placement.occurrence.workId,
					occurrenceId,
					text: placement.occurrence.text,
					sourceType,
					breadcrumb: placement.breadcrumb.map((item) => item.id),
				});
			}
			if (!entry.placements.length && entry.representative) {
				nodes.push({
					workId: entry.representative.workId,
					occurrenceId: entry.representative.id,
					text: entry.representative.text,
					sourceType,
				});
			}
		}
	}
	return nodes;
}
