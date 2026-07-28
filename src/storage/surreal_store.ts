import { RecordId, Surreal } from "surrealdb";
import type {
	Branch,
	Knot,
	LexicalHit,
	LinkType,
	Occurrence,
	OutlineItem,
	OutlineLink,
	PurgeManifest,
	SavedRuleQuery,
	SearchAlias,
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import type { GraphStore } from "./graph_store.ts";
import {
	CURRENT_STORAGE_SCHEMA_VERSION,
	type MigrationJournalEntry,
	runStorageMigrations,
	type SchemaMetadata,
	type StorageMigration,
} from "./migrations/mod.ts";
import { workOccurrenceMigration } from "./migrations/0001_work_occurrence.ts";
import {
	countOccurrences,
	normalizeSearchText,
	searchTerms,
	titleOf,
} from "../services/search_text.ts";

type Row = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_VERSION = "0.1.0";
const STORAGE_MIGRATIONS: readonly StorageMigration[] = [workOccurrenceMigration];

export type SurrealDiagnosticLogger = (event: string, detail?: unknown) => void;

export function evolvedFromEndpoints(
	parentId: string,
	childId: string,
): { inId: string; outId: string } {
	return { inId: parentId, outId: childId };
}

function domainId(value: unknown, field: "id" | "work_id" | "parent_id" | "branch_id"): string {
	const id = String(value ?? "");
	if (!UUID_PATTERN.test(id)) {
		throw new TypeError(`Expected ${field} to be a UUID, received: ${id}`);
	}
	return id;
}

function optionalRecordDomainId(value: unknown): string | null {
	if (value == null) return null;
	if (value instanceof RecordId) return String(value.id);
	if (typeof value === "object" && "id" in value) {
		return String((value as { id: unknown }).id);
	}
	const raw = String(value);
	const separator = raw.indexOf(":");
	return separator < 0 ? raw : raw.slice(separator + 1).replace(/^`|`$/g, "");
}

export function itemFromRow(row: Row): OutlineItem {
	const selectorMode = row.selector_mode === "pinned" ? "pinned" : "branch";
	return {
		id: domainId(row.id, "id"),
		workId: domainId(row.work_id ?? row.id, "work_id"),
		text: String(row.text ?? ""),
		parentId: row.parent_id == null ? null : domainId(row.parent_id, "parent_id"),
		orderKey: Number(row.order_key ?? 0),
		collapsed: Boolean(row.collapsed),
		revisionSelector: selectorMode === "branch"
			? { mode: "branch", branchId: domainId(row.branch_id ?? row.work_id, "branch_id") }
			: { mode: "pinned", revisionId: String(row.revision_id ?? "") },
		contextualHeading: row.contextual_heading == null ? undefined : String(row.contextual_heading),
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
		this.trace("sdk.initialize.ready");
	}

	async close(): Promise<void> {
		await this.#db.close();
	}

	async listItems(): Promise<OutlineItem[]> {
		const [occurrenceRows, works, copyRows, revisionRows] = await Promise.all([
			this.listOccurrenceRows(),
			this.listWorks(),
			this.listWorkingCopyRows(),
			this.listRevisionRows(),
		]);
		const workById = new Map(works.map((work) => [work.id, work]));
		const copyByBranch = new Map(
			copyRows.map((row) => [String(row.branch_id), String(row.text ?? "")]),
		);
		const revisionText = new Map(
			revisionRows.map((row) => [String(row.id), String(row.text ?? "")]),
		);
		return occurrenceRows.flatMap((row): OutlineItem[] => {
			const work = workById.get(String(row.work_id));
			if (!work) return [];
			return [itemFromRow({
				...row,
				text: row.selector_mode === "pinned"
					? revisionText.get(String(row.revision_id)) ?? ""
					: copyByBranch.get(String(row.branch_id)) ?? "",
				created_at: work.createdAt,
				updated_at: work.updatedAt,
			})];
		});
	}

	async listWorks(includeDeleted = false): Promise<Work[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, created_at, updated_at, deleted_at
				FROM work ${includeDeleted ? "" : "WHERE deleted_at IS NONE"};`,
		);
		return rows.map((row) => ({
			id: domainId(row.id, "id"),
			createdAt: String(row.created_at ?? ""),
			updatedAt: String(row.updated_at ?? ""),
			deletedAt: row.deleted_at == null ? undefined : String(row.deleted_at),
		}));
	}

	async listOccurrences(includeDeletedWorks = false): Promise<Occurrence[]> {
		const visible = new Set(
			(await this.listWorks(includeDeletedWorks)).map((work) => work.id),
		);
		return (await this.listOccurrenceRows()).flatMap((row): Occurrence[] => {
			const workId = domainId(row.work_id, "work_id");
			if (!visible.has(workId)) return [];
			return [{
				id: domainId(row.id, "id"),
				workId,
				parentOccurrenceId: row.parent_id == null ? null : domainId(row.parent_id, "parent_id"),
				orderKey: Number(row.order_key ?? 0),
				collapsed: Boolean(row.collapsed),
				revisionSelector: row.selector_mode === "pinned"
					? { mode: "pinned", revisionId: String(row.revision_id ?? "") }
					: { mode: "branch", branchId: domainId(row.branch_id, "branch_id") },
				contextualHeading: row.contextual_heading == null
					? undefined
					: String(row.contextual_heading),
			}];
		});
	}

	async createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void> {
		const parent = occurrence.parentOccurrenceId ? "$parent" : "NONE";
		const contextualHeading = occurrence.contextualHeading ? "$contextualHeading" : "NONE";
		await this.#db.query(
			`BEGIN TRANSACTION;
			CREATE $work CONTENT {
				created_at: $createdAt, updated_at: $updatedAt, deleted_at: NONE
			};
			CREATE $branch CONTENT {
				work: $work, name: $name, head_revision: NONE,
				created_at: $createdAt, promoted_at: NONE, archived_at: NONE
			};
			CREATE $copy CONTENT {
				work: $work, branch: $branch, text: $text, updated_at: $updatedAt
			};
			CREATE $occurrence CONTENT {
				work: $work, parent_occurrence: ${parent}, order_key: $orderKey,
				collapsed: $collapsed, selector_mode: "branch", branch: $branch,
				revision: NONE, contextual_heading: ${contextualHeading}
			};
			COMMIT TRANSACTION;`,
			{
				work: new RecordId("work", work.id),
				branch: new RecordId("branch", branch.id),
				copy: new RecordId("working_copy", branch.id),
				occurrence: new RecordId("occurrence", occurrence.id),
				...(occurrence.parentOccurrenceId
					? { parent: new RecordId("occurrence", occurrence.parentOccurrenceId) }
					: {}),
				orderKey: occurrence.orderKey,
				collapsed: occurrence.collapsed,
				...(occurrence.contextualHeading
					? { contextualHeading: occurrence.contextualHeading }
					: {}),
				name: branch.name,
				text: workingCopy.text,
				createdAt: work.createdAt,
				updatedAt: work.updatedAt,
			},
		);
	}

	async createOccurrence(occurrence: Occurrence): Promise<void> {
		const expressions = this.occurrenceExpressions(occurrence);
		await this.#db.query(
			`CREATE $record CONTENT {
				work: $work, parent_occurrence: ${expressions.parent}, order_key: $orderKey,
				collapsed: $collapsed, selector_mode: $selectorMode,
				branch: ${expressions.branch}, revision: ${expressions.revision},
				contextual_heading: ${expressions.contextualHeading}
			};`,
			this.occurrenceVariables(occurrence),
		);
	}

	async updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void> {
		const work = new RecordId("work", workId);
		await this.#db.query(
			`UPDATE working_copy SET text = $text, updated_at = $updatedAt WHERE work = $work;
			UPDATE $work SET updated_at = $updatedAt;`,
			{ work, text, updatedAt },
		);
	}

	async updateOccurrence(occurrence: Occurrence): Promise<void> {
		const expressions = this.occurrenceExpressions(occurrence);
		await this.#db.query(
			`UPDATE $record MERGE {
				work: $work, parent_occurrence: ${expressions.parent}, order_key: $orderKey,
				collapsed: $collapsed, selector_mode: $selectorMode,
				branch: ${expressions.branch}, revision: ${expressions.revision},
				contextual_heading: ${expressions.contextualHeading}
			};`,
			this.occurrenceVariables(occurrence),
		);
	}

	async deleteOccurrence(id: string): Promise<void> {
		await this.#db.query(`DELETE $record;`, { record: new RecordId("occurrence", id) });
	}

	async trashWork(workId: string, deletedAt: string): Promise<void> {
		await this.#db.query(`UPDATE $work SET deleted_at = $deletedAt, updated_at = $deletedAt;`, {
			work: new RecordId("work", workId),
			deletedAt,
		});
	}

	async restoreWork(workId: string): Promise<void> {
		await this.#db.query(`UPDATE $work SET deleted_at = NONE;`, {
			work: new RecordId("work", workId),
		});
	}

	async purgeWork(workId: string): Promise<PurgeManifest> {
		const workState = (await this.listWorks(true)).find((candidate) => candidate.id === workId);
		if (!workState?.deletedAt) {
			throw new Error(`Work must be in trash before it can be purged: ${workId}`);
		}
		const work = new RecordId("work", workId);
		const [occurrenceRows, branchRows, revisionRows, links] = await Promise.all([
			this.#db.query<[Row[]]>(
				`SELECT record::id(id) AS id FROM occurrence WHERE work = $work;`,
				{ work },
			).then(([rows]) => rows),
			this.#db.query<[Row[]]>(
				`SELECT record::id(id) AS id FROM branch WHERE work = $work;`,
				{ work },
			).then(([rows]) => rows),
			this.#db.query<[Row[]]>(
				`SELECT record::id(id) AS id FROM revision WHERE work = $work;`,
				{ work },
			).then(([rows]) => rows),
			this.listLinks(),
		]);
		const manifest: PurgeManifest = {
			id: crypto.randomUUID(),
			workId,
			occurrenceIds: occurrenceRows.map((row) => String(row.id)),
			branchIds: branchRows.map((row) => String(row.id)),
			revisionIds: revisionRows.map((row) => String(row.id)),
			linkIds: links
				.filter((link) => link.from.workId === workId || link.to.workId === workId)
				.map((link) => link.id),
			purgedAt: new Date().toISOString(),
		};
		await this.#db.query(
			`BEGIN TRANSACTION;
			CREATE $manifest CONTENT {
				work_id: $workId, occurrence_ids: $occurrenceIds, branch_ids: $branchIds,
				revision_ids: $revisionIds, link_ids: $linkIds, purged_at: $purgedAt
			};
			LET $removed = SELECT VALUE id FROM occurrence WHERE work = $work;
			UPDATE occurrence SET parent_occurrence = NONE WHERE parent_occurrence IN $removed;
			DELETE semantic_link WHERE from_work = $work OR to_work = $work;
			DELETE system_relation WHERE from_work = $work OR to_work = $work;
			DELETE occurrence WHERE work = $work;
			DELETE working_copy WHERE work = $work;
			DELETE revision WHERE work = $work;
			DELETE branch WHERE work = $work;
			DELETE $work;
			COMMIT TRANSACTION;`,
			{
				...manifest,
				work,
				manifest: new RecordId("purge_manifest", manifest.id),
			},
		);
		return manifest;
	}

	async listPurgeManifests(): Promise<PurgeManifest[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, work_id, occurrence_ids, branch_ids,
				revision_ids, link_ids, purged_at FROM purge_manifest ORDER BY purged_at DESC;`,
		);
		return rows.map((row) => ({
			id: String(row.id),
			workId: String(row.work_id),
			occurrenceIds: Array.isArray(row.occurrence_ids) ? row.occurrence_ids.map(String) : [],
			branchIds: Array.isArray(row.branch_ids) ? row.branch_ids.map(String) : [],
			revisionIds: Array.isArray(row.revision_ids) ? row.revision_ids.map(String) : [],
			linkIds: Array.isArray(row.link_ids) ? row.link_ids.map(String) : [],
			purgedAt: String(row.purged_at ?? ""),
		}));
	}

	async listLinks(): Promise<OutlineLink[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, from_scope, record::id(from_work) AS from_id,
				from_revision, to_scope,
				record::id(to_work) AS to_id, to_revision,
				type, status, origin, reason, created_at FROM semantic_link;`,
		);
		return rows.map((row) => {
			const fromId = domainId(row.from_id, "work_id");
			const toId = domainId(row.to_id, "work_id");
			return {
				id: String(row.id),
				fromId,
				toId,
				from: row.from_scope === "revision"
					? {
						scope: "revision",
						workId: fromId,
						revisionId: optionalRecordDomainId(row.from_revision) ?? "",
					}
					: { scope: "work", workId: fromId },
				to: row.to_scope === "revision"
					? {
						scope: "revision",
						workId: toId,
						revisionId: optionalRecordDomainId(row.to_revision) ?? "",
					}
					: { scope: "work", workId: toId },
				type: String(row.type) as LinkType,
				status: String(row.status) as OutlineLink["status"],
				origin: String(row.origin) as OutlineLink["origin"],
				createdAt: String(row.created_at ?? ""),
				reason: row.reason == null ? undefined : String(row.reason),
			};
		});
	}

	async createLink(link: OutlineLink): Promise<void> {
		const fromRevision = link.from.scope === "revision" ? "$fromRevision" : "NONE";
		const toRevision = link.to.scope === "revision" ? "$toRevision" : "NONE";
		const reason = link.reason ? "$reason" : "NONE";
		await this.#db.query(
			`CREATE $record CONTENT {
				from_scope: $fromScope, from_work: $fromWork, from_revision: ${fromRevision},
				to_scope: $toScope, to_work: $toWork, to_revision: ${toRevision},
				type: $type, status: $status, origin: $origin, reason: ${reason},
				created_at: $createdAt
			};`,
			{
				...link,
				record: new RecordId("semantic_link", link.id),
				fromScope: link.from.scope,
				fromWork: new RecordId("work", link.from.workId),
				...(link.from.scope === "revision"
					? { fromRevision: new RecordId("revision", link.from.revisionId) }
					: {}),
				toScope: link.to.scope,
				toWork: new RecordId("work", link.to.workId),
				...(link.to.scope === "revision"
					? { toRevision: new RecordId("revision", link.to.revisionId) }
					: {}),
				...(link.reason ? { reason: link.reason } : {}),
			},
		);
	}

	async deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		await this.#db.query(
			`UPDATE semantic_link SET status = $retracted
				WHERE from_work = $from AND to_work = $to AND type = $type AND status != $retracted;`,
			{
				from: new RecordId("work", fromId),
				to: new RecordId("work", toId),
				type,
				retracted: "retracted",
			},
		);
	}

	async listSystemRelations(): Promise<SystemRelation[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, record::id(from_work) AS from_id,
				record::id(to_work) AS to_id, type, created_at FROM system_relation;`,
		);
		return rows.map((row) => ({
			id: String(row.id),
			fromWorkId: domainId(row.from_id, "work_id"),
			toWorkId: domainId(row.to_id, "work_id"),
			type: "IN",
			createdAt: String(row.created_at ?? ""),
		}));
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
		return this.representativeItems(await this.listItems())
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
		return this.representativeItems(await this.listItems()).map((item) => {
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

	private async listOccurrenceRows(): Promise<Row[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, record::id(work) AS work_id,
				parent_occurrence, order_key, collapsed,
				selector_mode, branch, revision, contextual_heading
			FROM occurrence ORDER BY order_key;`,
		);
		return rows.map((row) => ({
			...row,
			parent_id: optionalRecordDomainId(row.parent_occurrence),
			branch_id: optionalRecordDomainId(row.branch),
			revision_id: optionalRecordDomainId(row.revision),
		}));
	}

	private async listWorkingCopyRows(): Promise<Row[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(work) AS work_id, record::id(branch) AS branch_id,
				text, updated_at FROM working_copy;`,
		);
		return rows;
	}

	private async listRevisionRows(): Promise<Row[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, text FROM revision;`,
		);
		return rows;
	}

	private occurrenceVariables(occurrence: Occurrence): Record<string, unknown> {
		return {
			record: new RecordId("occurrence", occurrence.id),
			work: new RecordId("work", occurrence.workId),
			...(occurrence.parentOccurrenceId
				? { parent: new RecordId("occurrence", occurrence.parentOccurrenceId) }
				: {}),
			orderKey: occurrence.orderKey,
			collapsed: occurrence.collapsed,
			selectorMode: occurrence.revisionSelector.mode,
			...(occurrence.revisionSelector.mode === "branch"
				? { branch: new RecordId("branch", occurrence.revisionSelector.branchId) }
				: { revision: new RecordId("revision", occurrence.revisionSelector.revisionId) }),
			...(occurrence.contextualHeading ? { contextualHeading: occurrence.contextualHeading } : {}),
		};
	}

	private occurrenceExpressions(occurrence: Occurrence): {
		parent: string;
		branch: string;
		revision: string;
		contextualHeading: string;
	} {
		return {
			parent: occurrence.parentOccurrenceId ? "$parent" : "NONE",
			branch: occurrence.revisionSelector.mode === "branch" ? "$branch" : "NONE",
			revision: occurrence.revisionSelector.mode === "pinned" ? "$revision" : "NONE",
			contextualHeading: occurrence.contextualHeading ? "$contextualHeading" : "NONE",
		};
	}

	private representativeItems(items: OutlineItem[]): OutlineItem[] {
		const byWork = new Map<string, OutlineItem>();
		for (const item of items) {
			if (!byWork.has(item.workId)) byWork.set(item.workId, item);
		}
		return [...byWork.values()];
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
		const completedAt = entry.completedAt ? "$completedAt" : "NONE";
		const error = entry.error ? "$error" : "NONE";
		await this.#db.query(
			`UPSERT $record CONTENT {
				from_version: $fromVersion,
				to_version: $toVersion,
				started_at: $startedAt,
				completed_at: ${completedAt},
				app_version: $appVersion,
				status: $status,
				error: ${error}
			};`,
			{
				...entry,
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
