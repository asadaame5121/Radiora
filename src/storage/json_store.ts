import type {
	Knot,
	LinkType,
	OutlineItem,
	OutlineLink,
	SavedRuleQuery,
	SearchAlias,
} from "../domain/models.ts";
import { MemoryGraphStore } from "./memory_store.ts";

interface StoredGraph {
	items: OutlineItem[];
	links: OutlineLink[];
	knots: Knot[];
	aliases?: SearchAlias[];
	emergenceFeedback?: Record<string, "accept" | "dismiss" | "pin">;
	savedRuleQueries?: SavedRuleQuery[];
}

export class JsonGraphStore extends MemoryGraphStore {
	constructor(private readonly path: string | URL) {
		super();
	}

	override async initialize(): Promise<void> {
		try {
			const data = JSON.parse(await Deno.readTextFile(this.path)) as StoredGraph;
			this.items = data.items ?? [];
			this.links = data.links ?? [];
			this.knots = data.knots ?? [];
			this.aliases = data.aliases ?? [];
			this.emergenceFeedback = data.emergenceFeedback ?? {};
			this.savedRuleQueries = data.savedRuleQueries ?? [];
		} catch (cause) {
			if (!(cause instanceof Deno.errors.NotFound)) throw cause;
		}
	}

	override async createItem(item: OutlineItem): Promise<void> {
		await super.createItem(item);
		await this.persist();
	}
	override async updateItem(item: OutlineItem): Promise<void> {
		await super.updateItem(item);
		await this.persist();
	}
	override async deleteItem(id: string): Promise<void> {
		await super.deleteItem(id);
		await this.persist();
	}
	override async setParent(childId: string, parentId: string | null): Promise<void> {
		await super.setParent(childId, parentId);
		await this.persist();
	}
	override async createLink(link: OutlineLink): Promise<void> {
		await super.createLink(link);
		await this.persist();
	}
	override async deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		await super.deleteLink(fromId, toId, type);
		await this.persist();
	}
	override async replaceKnots(knots: Knot[]): Promise<void> {
		await super.replaceKnots(knots);
		await this.persist();
	}
	override async upsertAlias(alias: SearchAlias): Promise<void> {
		await super.upsertAlias(alias);
		await this.persist();
	}
	override async deleteAlias(id: string): Promise<void> {
		await super.deleteAlias(id);
		await this.persist();
	}
	override async setEmergenceFeedback(
		id: string,
		action: "accept" | "dismiss" | "pin",
	): Promise<void> {
		await super.setEmergenceFeedback(id, action);
		await this.persist();
	}
	override async upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		await super.upsertSavedRuleQuery(query);
		await this.persist();
	}
	override async deleteSavedRuleQuery(id: string): Promise<void> {
		await super.deleteSavedRuleQuery(id);
		await this.persist();
	}

	private async persist(): Promise<void> {
		const data: StoredGraph = {
			items: this.items,
			links: this.links,
			knots: this.knots,
			aliases: this.aliases,
			emergenceFeedback: this.emergenceFeedback,
			savedRuleQueries: this.savedRuleQueries,
		};
		await Deno.writeTextFile(this.path, JSON.stringify(data, null, 2));
	}
}
