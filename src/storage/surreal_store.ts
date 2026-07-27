import { RecordId, Surreal } from "surrealdb";
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
	CURRENT_STORAGE_SCHEMA_VERSION,
	type MigrationJournalEntry,
	runStorageMigrations,
	type SchemaMetadata,
	type StorageMigration,
} from "./migrations/mod.ts";
import {
	countOccurrences,
	normalizeSearchText,
	searchTerms,
	titleFromText,
	titleOf,
} from "../services/search_text.ts";

type Row = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_VERSION = "0.1.0";
const STORAGE_MIGRATIONS: readonly StorageMigration[] = [];

export type SurrealDiagnosticLogger = (event: string, detail?: unknown) => void;

export function evolvedFromEndpoints(
	parentId: string,
	childId: string,
): { inId: string; outId: string } {
	return { inId: parentId, outId: childId };
}

const RELATION_TABLE: Record<LinkType, string> = {
	LIKE: "liked",
	FIX: "fixed",
	VS: "conflicted",
	IN: "in_knot",
};

function domainId(value: unknown, field: "id" | "parent_id"): string {
	const id = String(value ?? "");
	if (!UUID_PATTERN.test(id)) {
		throw new TypeError(`Expected ${field} to be a UUID, received: ${id}`);
	}
	return id;
}

export function itemFromRow(row: Row): OutlineItem {
	return {
		id: domainId(row.id, "id"),
		text: String(row.text ?? ""),
		parentId: row.parent_id == null ? null : domainId(row.parent_id, "parent_id"),
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
				DEFINE FIELD IF NOT EXISTS title ON outline_item TYPE string DEFAULT "";
				DEFINE FIELD IF NOT EXISTS title_key ON outline_item TYPE string DEFAULT "";
				DEFINE FIELD IF NOT EXISTS title_prefix ON outline_item TYPE string DEFAULT "";
				DEFINE FIELD IF NOT EXISTS search_terms ON outline_item TYPE string DEFAULT "";
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
				DEFINE TABLE IF NOT EXISTS search_alias SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS canonical ON search_alias TYPE string;
				DEFINE FIELD IF NOT EXISTS variants ON search_alias TYPE array<string>;
				DEFINE FIELD IF NOT EXISTS created_at ON search_alias TYPE string;
				DEFINE FIELD IF NOT EXISTS updated_at ON search_alias TYPE string;
				DEFINE TABLE IF NOT EXISTS emergence_feedback SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS action ON emergence_feedback TYPE string;
				DEFINE FIELD IF NOT EXISTS updated_at ON emergence_feedback TYPE string;
				DEFINE TABLE IF NOT EXISTS saved_rule_query SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS name ON saved_rule_query TYPE string;
				DEFINE FIELD IF NOT EXISTS source ON saved_rule_query TYPE string;
				DEFINE FIELD IF NOT EXISTS created_at ON saved_rule_query TYPE string;
				DEFINE FIELD IF NOT EXISTS updated_at ON saved_rule_query TYPE string;
				DEFINE TABLE IF NOT EXISTS schema_metadata SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS version ON schema_metadata TYPE number;
				DEFINE FIELD IF NOT EXISTS updated_at ON schema_metadata TYPE string;
				DEFINE FIELD IF NOT EXISTS last_migration_id ON schema_metadata TYPE string;
				DEFINE FIELD IF NOT EXISTS app_version ON schema_metadata TYPE string;
				DEFINE TABLE IF NOT EXISTS migration_journal SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS from_version ON migration_journal TYPE number;
				DEFINE FIELD IF NOT EXISTS to_version ON migration_journal TYPE number;
				DEFINE FIELD IF NOT EXISTS started_at ON migration_journal TYPE string;
				DEFINE FIELD IF NOT EXISTS completed_at ON migration_journal TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS app_version ON migration_journal TYPE string;
				DEFINE FIELD IF NOT EXISTS status ON migration_journal TYPE string;
				DEFINE FIELD IF NOT EXISTS error ON migration_journal TYPE option<string>;
				DEFINE ANALYZER IF NOT EXISTS title_prefix FILTERS lowercase, edgengram(1,64);
				DEFINE ANALYZER IF NOT EXISTS lexical TOKENIZERS class, camel, punct FILTERS lowercase;
				DEFINE ANALYZER IF NOT EXISTS japanese_terms TOKENIZERS blank FILTERS lowercase;
				DEFINE INDEX IF NOT EXISTS outline_title_prefix ON outline_item FIELDS title_prefix
					FULLTEXT ANALYZER title_prefix;
				DEFINE INDEX IF NOT EXISTS outline_title_lexical ON outline_item FIELDS title_key
					FULLTEXT ANALYZER lexical BM25;
				DEFINE INDEX IF NOT EXISTS outline_text_lexical ON outline_item FIELDS text
					FULLTEXT ANALYZER lexical BM25;
				DEFINE INDEX IF NOT EXISTS outline_terms_lexical ON outline_item FIELDS search_terms
					FULLTEXT ANALYZER japanese_terms BM25;
			`));
		await this.step("sdk.schema.migrate", () => this.runMigrations());
		for (const item of await this.listItems()) await this.updateItem(item);
		this.trace("sdk.initialize.ready");
	}

	async close(): Promise<void> {
		await this.#db.close();
	}

	async listItems(): Promise<OutlineItem[]> {
		const [rows] = await this.#db.query<[Row[]]>(`
			SELECT record::id(id) AS id, text, order_key, collapsed, created_at, updated_at,
				array::first(
					(<-evolved_from<-outline_item).map(|$parent| record::id($parent.id))
				) AS parent_id
			FROM outline_item ORDER BY order_key;
		`);
		return rows.map(itemFromRow);
	}

	async createItem(item: OutlineItem): Promise<void> {
		const title = titleFromText(item.text);
		await this.#db.query(
			`CREATE $record CONTENT {
				text: $text, order_key: $orderKey, collapsed: $collapsed,
				created_at: $createdAt, updated_at: $updatedAt,
				title: $title, title_key: $titleKey, title_prefix: $titleKey, search_terms: $searchTerms
			};`,
			{
				...item,
				title,
				titleKey: normalizeSearchText(title),
				searchTerms: searchTerms(item.text),
				record: new RecordId("outline_item", item.id),
			},
		);
	}

	async updateItem(item: OutlineItem): Promise<void> {
		const title = titleFromText(item.text);
		await this.#db.query(
			`UPDATE $record MERGE {
				text: $text, order_key: $orderKey, collapsed: $collapsed, updated_at: $updatedAt,
				title: $title, title_key: $titleKey, title_prefix: $titleKey, search_terms: $searchTerms
			};`,
			{
				...item,
				title,
				titleKey: normalizeSearchText(title),
				searchTerms: searchTerms(item.text),
				record: new RecordId("outline_item", item.id),
			},
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
			const endpoints = evolvedFromEndpoints(parentId, childId);
			await this.#db.query(
				`RELATE $parent->evolved_from->$child;`,
				{
					child: new RecordId("outline_item", endpoints.outId),
					parent: new RecordId("outline_item", endpoints.inId),
				},
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

	async suggestItems(prefix: string, limit: number): Promise<OutlineItem[]> {
		const normalized = normalizeSearchText(prefix);
		if (!normalized) return [];
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id FROM outline_item
				WHERE title_prefix @1@ $prefix LIMIT $limit;`,
			{ prefix: normalized, limit },
		);
		const ids = new Set(rows.map((row) => String(row.id)));
		return (await this.listItems())
			.filter((item) =>
				ids.has(item.id) && normalizeSearchText(titleOf(item)).startsWith(normalized)
			)
			.sort((a, b) =>
				titleOf(a).length - titleOf(b).length || b.updatedAt.localeCompare(a.updatedAt)
			)
			.slice(0, limit);
	}

	async searchLexical(query: string, limit: number): Promise<LexicalHit[]> {
		const normalized = normalizeSearchText(query);
		if (!normalized) return [];
		const terms = searchTerms(query);
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id,
				(search::score(1) ?? 0) AS title_score,
				(search::score(2) ?? 0) + (search::score(3) ?? 0) AS body_score
			FROM outline_item
			WHERE title_key @1@ $query OR text @2@ $query OR search_terms @3@ $terms
			ORDER BY title_score DESC, body_score DESC LIMIT $limit;`,
			{ query: normalized, terms, limit },
		);
		const items = new Map((await this.listItems()).map((item) => [item.id, item]));
		return rows.flatMap((row) => {
			const item = items.get(String(row.id));
			const title = item ? normalizeSearchText(titleOf(item)) : "";
			const body = item ? normalizeSearchText(item.text) : "";
			const tokens = terms.split(" ").filter(Boolean);
			const fallbackTitle = countOccurrences(title, normalized) +
				tokens.reduce((score, token) => score + countOccurrences(title, token), 0);
			const fallbackBody = countOccurrences(body, normalized) +
				tokens.reduce((score, token) => score + countOccurrences(body, token), 0);
			return item
				? [{
					item,
					titleScore: Number(row.title_score ?? row.titleScore ?? 0) || fallbackTitle,
					bodyScore: Number(row.body_score ?? row.bodyScore ?? 0) || fallbackBody,
				}]
				: [];
		});
	}

	async listAliases(): Promise<SearchAlias[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, canonical, variants, created_at, updated_at
				FROM search_alias ORDER BY canonical;`,
		);
		return rows.map((row) => ({
			id: String(row.id),
			canonical: String(row.canonical ?? ""),
			variants: Array.isArray(row.variants) ? row.variants.map(String) : [],
			createdAt: String(row.created_at ?? ""),
			updatedAt: String(row.updated_at ?? ""),
		}));
	}

	async upsertAlias(alias: SearchAlias): Promise<void> {
		await this.#db.query(
			`UPSERT $record CONTENT {
				canonical: $canonical, variants: $variants,
				created_at: $createdAt, updated_at: $updatedAt
			};`,
			{ ...alias, record: new RecordId("search_alias", alias.id) },
		);
	}

	async deleteAlias(id: string): Promise<void> {
		await this.#db.query(`DELETE $record;`, { record: new RecordId("search_alias", id) });
	}

	async getEmergenceFeedback(id: string): Promise<"accept" | "dismiss" | "pin" | null> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT action FROM $record;`,
			{ record: new RecordId("emergence_feedback", id) },
		);
		const action = rows[0]?.action;
		return action === "accept" || action === "dismiss" || action === "pin" ? action : null;
	}

	async setEmergenceFeedback(id: string, action: "accept" | "dismiss" | "pin"): Promise<void> {
		await this.#db.query(
			`UPSERT $record CONTENT { action: $action, updated_at: $updatedAt };`,
			{
				action,
				updatedAt: new Date().toISOString(),
				record: new RecordId("emergence_feedback", id),
			},
		);
	}

	async listSavedRuleQueries(): Promise<SavedRuleQuery[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, name, source, created_at, updated_at
				FROM saved_rule_query ORDER BY updated_at DESC;`,
		);
		return rows.map((row) => ({
			id: String(row.id),
			name: String(row.name ?? ""),
			source: String(row.source ?? ""),
			createdAt: String(row.created_at ?? ""),
			updatedAt: String(row.updated_at ?? ""),
		}));
	}

	async upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		await this.#db.query(
			`UPSERT $record CONTENT {
				name: $name, source: $source, created_at: $createdAt, updated_at: $updatedAt
			};`,
			{ ...query, record: new RecordId("saved_rule_query", query.id) },
		);
	}

	async deleteSavedRuleQuery(id: string): Promise<void> {
		await this.#db.query(`DELETE $record;`, { record: new RecordId("saved_rule_query", id) });
	}

	private trace(event: string, detail?: unknown): void {
		try {
			this.diagnosticLogger?.(event, detail);
		} catch {
			// Diagnostics must never change database behavior.
		}
	}

	private async runMigrations(): Promise<void> {
		await runStorageMigrations({
			appVersion: APP_VERSION,
			targetVersion: CURRENT_STORAGE_SCHEMA_VERSION,
			migrations: STORAGE_MIGRATIONS,
			context: {
				execute: (statement, variables) => this.#db.query(statement, variables),
			},
			state: {
				readMetadata: async () => {
					const [rows] = await this.#db.query<[Row[]]>(
						`SELECT version, updated_at, last_migration_id, app_version
							FROM schema_metadata:radiora;`,
					);
					const row = rows[0];
					if (!row) return null;
					return {
						id: "radiora",
						version: Number(row.version),
						updatedAt: String(row.updated_at ?? ""),
						lastMigrationId: String(row.last_migration_id ?? ""),
						appVersion: String(row.app_version ?? ""),
					} satisfies SchemaMetadata;
				},
				writeMetadata: (metadata) =>
					this.#db.query(
						`UPSERT schema_metadata:radiora CONTENT {
							version: $version,
							updated_at: $updatedAt,
							last_migration_id: $lastMigrationId,
							app_version: $appVersion
						};`,
						{ ...metadata },
					).then(() => undefined),
				writeJournal: (entry) => this.writeMigrationJournal(entry),
			},
		});
	}

	private async writeMigrationJournal(entry: MigrationJournalEntry): Promise<void> {
		await this.#db.query(
			`UPSERT $record CONTENT {
				from_version: $fromVersion,
				to_version: $toVersion,
				started_at: $startedAt,
				completed_at: $completedAt,
				app_version: $appVersion,
				status: $status,
				error: $error
			};`,
			{
				...entry,
				completedAt: entry.completedAt ?? null,
				error: entry.error ?? null,
				record: new RecordId("migration_journal", entry.id),
			},
		);
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
