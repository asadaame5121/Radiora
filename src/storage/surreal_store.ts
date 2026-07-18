import { RecordId, Surreal } from "surrealdb";
import type { Knot, LinkType, OutlineItem, OutlineLink } from "../domain/models.ts";
import type { GraphStore } from "./graph_store.ts";

type Row = Record<string, unknown>;

export type SurrealDiagnosticLogger = (event: string, detail?: unknown) => void;

const RELATION_TABLE: Record<LinkType, string> = {
	LIKE: "liked",
	FIX: "fixed",
	VS: "conflicted",
	IN: "in_knot",
};

function itemFromRow(row: Row): OutlineItem {
	return {
		id: String(row.id ?? ""),
		text: String(row.text ?? ""),
		parentId: row.parent_id == null ? null : String(row.parent_id),
		orderKey: Number(row.order_key ?? 0),
		collapsed: Boolean(row.collapsed),
		createdAt: String(row.created_at ?? ""),
		updatedAt: String(row.updated_at ?? ""),
	};
}

export class SurrealGraphStore implements GraphStore {
	readonly #db: Surreal;

	constructor(
		private readonly endpoint: string,
		private readonly username = "root",
		private readonly password = "root",
		private readonly diagnosticLogger?: SurrealDiagnosticLogger,
	) {
		this.trace("sdk.constructor.begin", { endpoint });
		this.#db = new Surreal();
		this.trace("sdk.constructor.ready");
	}

	async initialize(): Promise<void> {
		await this.step("sdk.connect", () =>
			this.#db.connect(this.endpoint, {
				authentication: { username: this.username, password: this.password },
			}));
		await this.step("sdk.namespace.ensure", () =>
			this.#db.query(`
				DEFINE NAMESPACE IF NOT EXISTS radiora_v2;
				USE NS radiora_v2;
				DEFINE DATABASE IF NOT EXISTS main;
			`));
		await this.step(
			"sdk.namespace.use",
			() => this.#db.use({ namespace: "radiora_v2", database: "main" }),
		);
		await this.step("sdk.schema.ensure", () =>
			this.#db.query(`
				DEFINE TABLE IF NOT EXISTS outline_item SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS text ON outline_item TYPE string;
				DEFINE FIELD IF NOT EXISTS order_key ON outline_item TYPE number;
				DEFINE FIELD IF NOT EXISTS collapsed ON outline_item TYPE bool DEFAULT false;
				DEFINE FIELD IF NOT EXISTS created_at ON outline_item TYPE string;
				DEFINE FIELD IF NOT EXISTS updated_at ON outline_item TYPE string;
				DEFINE TABLE IF NOT EXISTS evolved_from TYPE RELATION IN outline_item OUT outline_item SCHEMAFULL;
				DEFINE TABLE IF NOT EXISTS liked TYPE RELATION IN outline_item OUT outline_item SCHEMAFULL;
				DEFINE TABLE IF NOT EXISTS fixed TYPE RELATION IN outline_item OUT outline_item SCHEMAFULL;
				DEFINE TABLE IF NOT EXISTS conflicted TYPE RELATION IN outline_item OUT outline_item SCHEMAFULL;
				DEFINE TABLE IF NOT EXISTS in_knot TYPE RELATION IN outline_item OUT outline_item SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS created_at ON liked TYPE string;
				DEFINE FIELD IF NOT EXISTS created_at ON fixed TYPE string;
				DEFINE FIELD IF NOT EXISTS created_at ON conflicted TYPE string;
				DEFINE FIELD IF NOT EXISTS created_at ON in_knot TYPE string;
				DEFINE TABLE IF NOT EXISTS knot SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS cycle_ids ON knot TYPE array<string>;
				DEFINE FIELD IF NOT EXISTS created_at ON knot TYPE string;
			`));
		this.trace("sdk.initialize.ready");
	}

	async close(): Promise<void> {
		await this.#db.close();
	}

	async listItems(): Promise<OutlineItem[]> {
		const [rows] = await this.#db.query<[Row[]]>(`
			SELECT record::id(id) AS id, text, order_key, collapsed, created_at, updated_at,
				array::first(<-evolved_from<-outline_item).id AS parent_id
			FROM outline_item ORDER BY order_key;
		`);
		return rows.map(itemFromRow);
	}

	async createItem(item: OutlineItem): Promise<void> {
		await this.#db.query(
			`CREATE $record CONTENT {
				text: $text, order_key: $orderKey, collapsed: $collapsed,
				created_at: $createdAt, updated_at: $updatedAt
			};`,
			{ ...item, record: new RecordId("outline_item", item.id) },
		);
	}

	async updateItem(item: OutlineItem): Promise<void> {
		await this.#db.query(
			`UPDATE $record MERGE {
				text: $text, order_key: $orderKey, collapsed: $collapsed, updated_at: $updatedAt
			};`,
			{ ...item, record: new RecordId("outline_item", item.id) },
		);
	}

	async deleteItem(id: string): Promise<void> {
		await this.#db.query(`DELETE $record;`, { record: new RecordId("outline_item", id) });
	}

	async setParent(childId: string, parentId: string | null): Promise<void> {
		const child = new RecordId("outline_item", childId);
		await this.#db.query(`DELETE evolved_from WHERE out = $child;`, {
			child,
		});
		if (parentId) {
			await this.#db.query(
				`RELATE $parent->evolved_from->$child;`,
				{ child, parent: new RecordId("outline_item", parentId) },
			);
		}
	}

	async listLinks(): Promise<OutlineLink[]> {
		const links: OutlineLink[] = [];
		for (const [type, table] of Object.entries(RELATION_TABLE) as [LinkType, string][]) {
			const [rows] = await this.#db.query<[Row[]]>(
				`SELECT record::id(in) AS from_id, record::id(out) AS to_id, created_at FROM ${table};`,
			);
			links.push(...rows.map((row) => ({
				fromId: String(row.from_id),
				toId: String(row.to_id),
				type,
				createdAt: String(row.created_at ?? ""),
			})));
		}
		return links;
	}

	async createLink(link: OutlineLink): Promise<void> {
		const table = RELATION_TABLE[link.type];
		await this.#db.query(
			`RELATE $from->${table}->$to
				CONTENT { created_at: $createdAt };`,
			{
				...link,
				from: new RecordId("outline_item", link.fromId),
				to: new RecordId("outline_item", link.toId),
			},
		);
	}

	async deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		const table = RELATION_TABLE[type];
		await this.#db.query(
			`DELETE ${table} WHERE in = $from AND out = $to;`,
			{ from: new RecordId("outline_item", fromId), to: new RecordId("outline_item", toId) },
		);
	}

	async listKnots(): Promise<Knot[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, cycle_ids, created_at FROM knot;`,
		);
		return rows.map((row) => ({
			id: String(row.id),
			cycleIds: Array.isArray(row.cycle_ids) ? row.cycle_ids.map(String) : [],
			createdAt: String(row.created_at ?? ""),
		}));
	}

	async replaceKnots(knots: Knot[]): Promise<void> {
		await this.#db.query("DELETE knot;");
		for (const knot of knots) {
			await this.#db.query(
				`CREATE $record CONTENT { cycle_ids: $cycleIds, created_at: $createdAt };`,
				{ ...knot, record: new RecordId("knot", knot.id) },
			);
		}
	}

	private trace(event: string, detail?: unknown): void {
		try {
			this.diagnosticLogger?.(event, detail);
		} catch {
			// Diagnostics must never change database behavior.
		}
	}

	private async step<T>(event: string, operation: () => Promise<T>): Promise<T> {
		this.trace(`${event}.begin`);
		try {
			const result = await operation();
			this.trace(`${event}.ready`);
			return result;
		} catch (cause) {
			this.trace(`${event}.failed`, cause);
			throw cause;
		}
	}
}
