import type {
	Knot,
	LexicalHit,
	LinkType,
	OutlineItem,
	OutlineLink,
	SavedRuleQuery,
	SearchAlias,
} from "../domain/models.ts";
import type { GraphStore } from "./graph_store.ts";
import {
	countOccurrences,
	normalizeSearchText,
	searchTerms,
	titleOf,
} from "../services/search_text.ts";

export class MemoryGraphStore implements GraphStore {
	items: OutlineItem[] = [];
	links: OutlineLink[] = [];
	knots: Knot[] = [];
	aliases: SearchAlias[] = [];
	emergenceFeedback: Record<string, "accept" | "dismiss" | "pin"> = {};
	savedRuleQueries: SavedRuleQuery[] = [];
	initialize(): Promise<void> {
		return Promise.resolve();
	}
	close(): Promise<void> {
		return Promise.resolve();
	}
	listItems(): Promise<OutlineItem[]> {
		return Promise.resolve(structuredClone(this.items));
	}
	createItem(item: OutlineItem): Promise<void> {
		this.items.push(structuredClone(item));
		return Promise.resolve();
	}
	updateItem(item: OutlineItem): Promise<void> {
		this.items = this.items.map((candidate) =>
			candidate.id === item.id ? structuredClone(item) : candidate
		);
		return Promise.resolve();
	}
	deleteItem(id: string): Promise<void> {
		this.items = this.items.filter((item) => item.id !== id);
		this.links = this.links.filter((link) => link.fromId !== id && link.toId !== id);
		return Promise.resolve();
	}
	setParent(childId: string, parentId: string | null): Promise<void> {
		const item = this.items.find((candidate) => candidate.id === childId);
		if (item) item.parentId = parentId;
		return Promise.resolve();
	}
	listLinks(): Promise<OutlineLink[]> {
		return Promise.resolve(structuredClone(this.links));
	}
	createLink(link: OutlineLink): Promise<void> {
		this.links.push(structuredClone(link));
		return Promise.resolve();
	}
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		this.links = this.links.filter((link) =>
			!(link.fromId === fromId && link.toId === toId && link.type === type)
		);
		return Promise.resolve();
	}
	listKnots(): Promise<Knot[]> {
		return Promise.resolve(structuredClone(this.knots));
	}
	replaceKnots(knots: Knot[]): Promise<void> {
		this.knots = structuredClone(knots);
		return Promise.resolve();
	}
	suggestItems(prefix: string, limit: number): Promise<OutlineItem[]> {
		const normalized = normalizeSearchText(prefix);
		if (!normalized) return Promise.resolve([]);
		return Promise.resolve(structuredClone(
			this.items
				.filter((item) => normalizeSearchText(titleOf(item)).startsWith(normalized))
				.sort((a, b) =>
					titleOf(a).length - titleOf(b).length || b.updatedAt.localeCompare(a.updatedAt)
				)
				.slice(0, limit),
		));
	}
	searchLexical(query: string, limit: number): Promise<LexicalHit[]> {
		const normalized = normalizeSearchText(query);
		const tokenized = searchTerms(query).split(" ").filter(Boolean);
		if (!normalized) return Promise.resolve([]);
		const hits = this.items.map((item) => {
			const title = normalizeSearchText(titleOf(item));
			const body = normalizeSearchText(item.text);
			const titleCount = countOccurrences(title, normalized) +
				tokenized.reduce((score, token) => score + countOccurrences(title, token), 0);
			const bodyCount = countOccurrences(body, normalized) +
				tokenized.reduce((score, token) => score + countOccurrences(body, token), 0);
			return {
				item,
				titleScore: title === normalized ? 3 : title.startsWith(normalized) ? 2 : titleCount,
				bodyScore: bodyCount,
			};
		}).filter((hit) => hit.titleScore > 0 || hit.bodyScore > 0)
			.sort((a, b) => (b.titleScore * 2 + b.bodyScore) - (a.titleScore * 2 + a.bodyScore))
			.slice(0, limit);
		return Promise.resolve(structuredClone(hits));
	}
	listAliases(): Promise<SearchAlias[]> {
		return Promise.resolve(structuredClone(this.aliases));
	}
	upsertAlias(alias: SearchAlias): Promise<void> {
		this.aliases = [
			...this.aliases.filter((candidate) => candidate.id !== alias.id),
			structuredClone(alias),
		];
		return Promise.resolve();
	}
	deleteAlias(id: string): Promise<void> {
		this.aliases = this.aliases.filter((alias) => alias.id !== id);
		return Promise.resolve();
	}
	getEmergenceFeedback(id: string): Promise<"accept" | "dismiss" | "pin" | null> {
		return Promise.resolve(this.emergenceFeedback[id] ?? null);
	}
	setEmergenceFeedback(id: string, action: "accept" | "dismiss" | "pin"): Promise<void> {
		this.emergenceFeedback[id] = action;
		return Promise.resolve();
	}
	listSavedRuleQueries(): Promise<SavedRuleQuery[]> {
		return Promise.resolve(structuredClone(this.savedRuleQueries));
	}
	upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		this.savedRuleQueries = [
			...this.savedRuleQueries.filter((candidate) => candidate.id !== query.id),
			structuredClone(query),
		];
		return Promise.resolve();
	}
	deleteSavedRuleQuery(id: string): Promise<void> {
		this.savedRuleQueries = this.savedRuleQueries.filter((query) => query.id !== id);
		return Promise.resolve();
	}
}
