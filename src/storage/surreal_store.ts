import { RecordId, Surreal } from "surrealdb";
import type {
	Bookmark,
	Branch,
	EmergenceAction,
	EmergenceSuggestion,
	Knot,
	LexicalHit,
	LinkType,
	Occurrence,
	OutlineItem,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { isSymmetricLinkType } from "../domain/models.ts";
import {
	type GraphStateSnapshot,
	type GraphStore,
	type MergeWorksInput,
	validatedGraphStateSnapshot,
	validateRevisionCreation,
	validateUnplacedWorkCreation,
	validateWorkBundleImport,
	type WorkBundle,
} from "./graph_store.ts";
import { buildSurrealRestoreTransaction } from "./surreal_backup_restore.ts";
import {
	CURRENT_STORAGE_SCHEMA_VERSION,
	type MigrationJournalEntry,
	runStorageMigrations,
	type SchemaMetadata,
	type StorageMigration,
} from "./migrations/mod.ts";
import { workOccurrenceMigration } from "./migrations/0001_work_occurrence.ts";
import { revisionSnapshotMigration } from "./migrations/0002_revision_snapshot.ts";
import { bookmarkResumeMigration } from "./migrations/0003_bookmark_resume.ts";
import { stubStateMigration } from "./migrations/0004_stub_state.ts";
import { mergeProvenanceMigration } from "./migrations/0005_merge_provenance.ts";
import { emergenceSuggestionMigration } from "./migrations/0006_emergence_suggestion.ts";
import {
	emergenceAcceptanceTransactionQuery,
	emergenceSuggestionUpsertQuery,
	evolvedFromEndpoints,
	importWorkBundlesTransactionQuery,
	mergeWorksTransactionQuery,
	navigationPurgeStatements,
	quickCaptureTransactionQuery,
	recoveryPromotionTransactionQuery,
	recoveryRestoreTransactionQuery,
	resumePositionUpsertQuery,
} from "./surreal_queries.ts";
import {
	domainId,
	itemFromRow,
	occurrenceFromRow,
	optionalRecordDomainId,
	revisionFromRow,
	snapshotProtectionFromRow,
	type SurrealRow as Row,
	workFromRow,
} from "./surreal_row_mapper.ts";
import {
	countOccurrences,
	normalizeSearchText,
	searchTerms,
	titleOf,
} from "../services/search_text.ts";

const APP_VERSION = "0.1.0";
const STORAGE_MIGRATIONS: readonly StorageMigration[] = [
	workOccurrenceMigration,
	revisionSnapshotMigration,
	bookmarkResumeMigration,
	stubStateMigration,
	mergeProvenanceMigration,
	emergenceSuggestionMigration,
];

export type SurrealDiagnosticLogger = (event: string, detail?: unknown) => void;

export function duplicateLinkIdsAfterMerge(
	links: readonly OutlineLink[],
	sourceWorkId: string,
	survivorWorkId: string,
): string[] {
	const seen = new Set<string>();
	const duplicates: string[] = [];
	for (const link of links) {
		if (link.status === "retracted") continue;
		const replace = (endpoint: OutlineLink["from"]) =>
			endpoint.workId === sourceWorkId ? { ...endpoint, workId: survivorWorkId } : endpoint;
		const from = replace(link.from);
		const to = replace(link.to);
		const endpointKey = (endpoint: typeof from) =>
			endpoint.scope === "revision"
				? `revision:${endpoint.workId}:${endpoint.revisionId}`
				: `work:${endpoint.workId}`;
		let left = endpointKey(from);
		let right = endpointKey(to);
		if (isSymmetricLinkType(link.type) && left > right) [left, right] = [right, left];
		const key = `${link.type}|${left}|${right}`;
		if (left === right || seen.has(key)) duplicates.push(link.id);
		else seen.add(key);
	}
	return duplicates;
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
				DEFINE TABLE IF NOT EXISTS emergence_suggestion SCHEMAFULL;
				DEFINE FIELD IF NOT EXISTS kind ON emergence_suggestion TYPE string;
				DEFINE FIELD IF NOT EXISTS context_work ON emergence_suggestion TYPE record<work>;
				DEFINE FIELD IF NOT EXISTS target_work ON emergence_suggestion TYPE record<work>;
				DEFINE FIELD IF NOT EXISTS context_occurrence_id ON emergence_suggestion TYPE string;
				DEFINE FIELD IF NOT EXISTS target_occurrence_id ON emergence_suggestion TYPE string;
				DEFINE FIELD IF NOT EXISTS proposed_link_type ON emergence_suggestion TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS title ON emergence_suggestion TYPE string;
				DEFINE FIELD IF NOT EXISTS explanation ON emergence_suggestion TYPE string;
				DEFINE FIELD IF NOT EXISTS evidence ON emergence_suggestion TYPE array<object>;
				DEFINE FIELD IF NOT EXISTS score ON emergence_suggestion TYPE number;
				DEFINE FIELD IF NOT EXISTS status ON emergence_suggestion TYPE string;
				DEFINE FIELD IF NOT EXISTS created_at ON emergence_suggestion TYPE string;
				DEFINE FIELD IF NOT EXISTS updated_at ON emergence_suggestion TYPE string;
				DEFINE FIELD IF NOT EXISTS resolved_at ON emergence_suggestion TYPE option<string>;
				DEFINE FIELD IF NOT EXISTS resolution_reason ON emergence_suggestion TYPE option<string>;
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

	async exportGraphState(): Promise<GraphStateSnapshot> {
		const [
			works,
			branches,
			workingCopies,
			occurrences,
			links,
			systemRelations,
			knots,
			aliases,
			emergenceSuggestions,
			savedRuleQueries,
			purgeManifests,
			revisions,
			recoverySnapshots,
			bookmarkResult,
			resumeResult,
			feedbackResult,
		] = await Promise.all([
			this.listWorks(true),
			this.listBranches(),
			this.listWorkingCopies(),
			this.listOccurrences(true),
			this.listLinks(),
			this.listSystemRelations(),
			this.listKnots(),
			this.listAliases(),
			this.listEmergenceSuggestions(),
			this.listSavedRuleQueries(),
			this.listPurgeManifests(),
			this.listRevisions(),
			this.listRecoverySnapshots(),
			this.#db.query<[Row[]]>(
				`SELECT record::id(id) AS id, record::id(work) AS work_id,
					record::id(occurrence) AS occurrence_id, created_at FROM bookmark;`,
			),
			this.#db.query<[Row[]]>(
				`SELECT record::id(work) AS work_id, record::id(occurrence) AS occurrence_id,
					caret_offset, updated_at FROM resume_position:current;`,
			),
			this.#db.query<[Row[]]>(
				`SELECT record::id(id) AS id, action FROM emergence_feedback;`,
			),
		]);
		const bookmarks = bookmarkResult[0].map((row) => ({
			id: String(row.id),
			workId: domainId(row.work_id, "work_id"),
			occurrenceId: domainId(row.occurrence_id, "id"),
			createdAt: String(row.created_at ?? ""),
		}));
		const resumeRow = resumeResult[0][0];
		const resumePosition = resumeRow
			? {
				workId: domainId(resumeRow.work_id, "work_id"),
				occurrenceId: domainId(resumeRow.occurrence_id, "id"),
				caretOffset: Number(resumeRow.caret_offset),
				updatedAt: String(resumeRow.updated_at ?? ""),
			}
			: null;
		const emergenceFeedback = Object.fromEntries(
			feedbackResult[0].flatMap((row) =>
				row.action === "accept" || row.action === "dismiss" || row.action === "pin"
					? [[String(row.id), row.action]]
					: []
			),
		) as Record<string, "accept" | "dismiss" | "pin">;
		return {
			works,
			branches,
			workingCopies,
			occurrences,
			links,
			systemRelations,
			knots,
			aliases,
			emergenceFeedback,
			emergenceSuggestions,
			savedRuleQueries,
			purgeManifests,
			revisions,
			recoverySnapshots,
			bookmarks,
			resumePosition,
		};
	}

	async restoreGraphState(source: GraphStateSnapshot): Promise<void> {
		const state = validatedGraphStateSnapshot(source);
		const transaction = buildSurrealRestoreTransaction(state);
		await this.#db.query(transaction.query, transaction.variables);
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
			`SELECT record::id(id) AS id, created_at, updated_at, deleted_at, stub,
				merged_into_work, merged_at
				FROM work ${
				includeDeleted ? "" : "WHERE deleted_at IS NONE AND merged_into_work IS NONE"
			};`,
		);
		return rows.map(workFromRow);
	}

	async listOccurrences(includeDeletedWorks = false): Promise<Occurrence[]> {
		const visible = new Set(
			(await this.listWorks(includeDeletedWorks)).map((work) => work.id),
		);
		return (await this.listOccurrenceRows()).flatMap((row): Occurrence[] => {
			const occurrence = occurrenceFromRow(row);
			return visible.has(occurrence.workId) ? [occurrence] : [];
		});
	}

	async listBranches(workId?: string): Promise<Branch[]> {
		const variables = workId ? { work: new RecordId("work", workId) } : undefined;
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, record::id(work) AS work_id, name,
				head_revision, created_at, promoted_at, archived_at
				FROM branch ${workId ? "WHERE work = $work" : ""};`,
			variables,
		);
		return rows.map((row) => ({
			id: String(row.id),
			workId: domainId(row.work_id, "work_id"),
			name: String(row.name ?? ""),
			headRevisionId: optionalRecordDomainId(row.head_revision),
			createdAt: String(row.created_at ?? ""),
			promotedAt: row.promoted_at == null ? undefined : String(row.promoted_at),
			archivedAt: row.archived_at == null ? undefined : String(row.archived_at),
		}));
	}

	async listWorkingCopies(workId?: string): Promise<WorkingCopy[]> {
		const rows = await this.listWorkingCopyRows(workId);
		return rows.map((row) => ({
			workId: domainId(row.work_id, "work_id"),
			branchId: domainId(row.branch_id, "branch_id"),
			text: String(row.text ?? ""),
			updatedAt: String(row.updated_at ?? ""),
		}));
	}

	async listRevisions(workId?: string): Promise<Revision[]> {
		const rows = await this.listRevisionRows(workId);
		return rows.map(revisionFromRow);
	}

	async listRecoverySnapshots(
		workId?: string,
		branchId?: string,
	): Promise<RecoverySnapshot[]> {
		const conditions = [
			workId ? "work = $work" : "",
			branchId ? "branch = $branch" : "",
		].filter(Boolean);
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, record::id(work) AS work_id,
				record::id(branch) AS branch_id, text, content_hash, created_at,
				source_revision, name, protection_reason, protected_at, protection_expires_at
				FROM recovery_snapshot ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
				ORDER BY created_at;`,
			{
				...(workId ? { work: new RecordId("work", workId) } : {}),
				...(branchId ? { branch: new RecordId("branch", branchId) } : {}),
			},
		);
		return rows.map((row) => ({
			id: String(row.id),
			workId: domainId(row.work_id, "work_id"),
			branchId: domainId(row.branch_id, "branch_id"),
			text: String(row.text ?? ""),
			contentHash: String(row.content_hash ?? ""),
			createdAt: String(row.created_at ?? ""),
			sourceRevisionId: optionalRecordDomainId(row.source_revision),
			name: row.name == null ? undefined : String(row.name),
			protection: snapshotProtectionFromRow(row),
		}));
	}

	async listBookmarks(): Promise<Bookmark[]> {
		const activeWorkIds = new Set((await this.listWorks()).map((work) => work.id));
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, record::id(work) AS work_id,
				record::id(occurrence) AS occurrence_id, created_at
				FROM bookmark ORDER BY created_at, id;`,
		);
		return rows.flatMap((row): Bookmark[] => {
			const workId = domainId(row.work_id, "work_id");
			return activeWorkIds.has(workId)
				? [{
					id: String(row.id),
					workId,
					occurrenceId: domainId(row.occurrence_id, "id"),
					createdAt: String(row.created_at ?? ""),
				}]
				: [];
		});
	}

	async getResumePosition(): Promise<ResumePosition | null> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(work) AS work_id, record::id(occurrence) AS occurrence_id,
				caret_offset, updated_at FROM resume_position:current;`,
		);
		const row = rows[0];
		if (!row) return null;
		const workId = domainId(row.work_id, "work_id");
		if (!(await this.listWorks()).some((work) => work.id === workId)) return null;
		return {
			workId,
			occurrenceId: domainId(row.occurrence_id, "id"),
			caretOffset: Number(row.caret_offset),
			updatedAt: String(row.updated_at ?? ""),
		};
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

	async importWorkBundles(bundles: readonly WorkBundle[]): Promise<void> {
		const [works, branches, workingCopies, occurrences] = await Promise.all([
			this.listWorks(true),
			this.listBranches(),
			this.listWorkingCopies(),
			this.listOccurrences(true),
		]);
		validateWorkBundleImport(bundles, { works, branches, workingCopies, occurrences });
		const parameters: Record<string, unknown> = {};
		for (const [index, bundle] of bundles.entries()) {
			parameters[`work${index}`] = new RecordId("work", bundle.work.id);
			parameters[`branch${index}`] = new RecordId("branch", bundle.branch.id);
			parameters[`copy${index}`] = new RecordId("working_copy", bundle.branch.id);
			parameters[`occurrence${index}`] = new RecordId("occurrence", bundle.occurrence.id);
			parameters[`createdAt${index}`] = bundle.work.createdAt;
			parameters[`updatedAt${index}`] = bundle.work.updatedAt;
			parameters[`text${index}`] = bundle.workingCopy.text;
			parameters[`orderKey${index}`] = bundle.occurrence.orderKey;
			if (bundle.occurrence.parentOccurrenceId) {
				parameters[`parent${index}`] = new RecordId(
					"occurrence",
					bundle.occurrence.parentOccurrenceId,
				);
			}
			if (bundle.occurrence.contextualHeading) {
				parameters[`contextualHeading${index}`] = bundle.occurrence.contextualHeading;
			}
		}
		await this.#db.query(
			importWorkBundlesTransactionQuery(bundles.map((bundle) => ({
				hasParent: bundle.occurrence.parentOccurrenceId !== null,
				hasContextualHeading: Boolean(bundle.occurrence.contextualHeading),
			}))),
			parameters,
		);
	}

	async createUnplacedWork(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
	): Promise<void> {
		const [works, branches, copies] = await Promise.all([
			this.listWorks(true),
			this.listBranches(),
			this.listWorkingCopies(),
		]);
		validateUnplacedWorkCreation(work, branch, workingCopy, works, branches, copies);
		await this.#db.query(
			quickCaptureTransactionQuery(Boolean(work.stub), Boolean(work.stub?.context)),
			{
				work: new RecordId("work", work.id),
				branch: new RecordId("branch", branch.id),
				copy: new RecordId("working_copy", branch.id),
				text: workingCopy.text,
				createdAt: work.createdAt,
				updatedAt: work.updatedAt,
				...(work.stub
					? {
						stubCreatedAt: work.stub.createdAt,
						stubCreatedVia: work.stub.createdVia,
						...(work.stub.context ? { stubContext: work.stub.context } : {}),
					}
					: {}),
			},
		);
	}

	async mergeWorks(input: MergeWorksInput): Promise<void> {
		const [works, aliases, links] = await Promise.all([
			this.listWorks(true),
			this.listAliases(),
			this.listLinks(),
		]);
		const source = works.find((work) => work.id === input.sourceWorkId);
		const survivor = works.find((work) => work.id === input.survivorWorkId);
		if (
			input.sourceWorkId === input.survivorWorkId || !source || source.deletedAt ||
			source.mergedIntoWorkId
		) {
			throw new Error(`Active source Work not found: ${input.sourceWorkId}`);
		}
		if (!survivor || survivor.deletedAt || survivor.mergedIntoWorkId) {
			throw new Error(`Active survivor Work not found: ${input.survivorWorkId}`);
		}
		const parsed = Date.parse(input.mergedAt);
		if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== input.mergedAt) {
			throw new Error("Duplicate merge requires a valid ISO instant");
		}
		if (input.alias) {
			if (!input.alias.id || !input.alias.canonical.trim() || input.alias.variants.length === 0) {
				throw new Error("Duplicate merge alias requires a non-empty old name");
			}
			if (
				aliases.some((alias) =>
					alias.id === input.alias!.id && alias.canonical !== input.alias!.canonical
				)
			) {
				throw new Error(`Search Alias ID collision: ${input.alias.id}`);
			}
		}
		const duplicateLinks = duplicateLinkIdsAfterMerge(
			links,
			input.sourceWorkId,
			input.survivorWorkId,
		).map((id) => new RecordId("semantic_link", id));
		await this.#db.query(mergeWorksTransactionQuery(Boolean(input.alias)), {
			source: new RecordId("work", input.sourceWorkId),
			survivor: new RecordId("work", input.survivorWorkId),
			mergedAt: input.mergedAt,
			retracted: "retracted",
			duplicateLinks,
			...(input.alias
				? {
					alias: new RecordId("search_alias", input.alias.id),
					canonical: input.alias.canonical,
					variants: input.alias.variants,
					aliasCreatedAt: input.alias.createdAt,
					aliasUpdatedAt: input.alias.updatedAt,
				}
				: {}),
		});
	}

	async resolveWorkStub(workId: string, updatedAt: string): Promise<void> {
		const work = (await this.listWorks(true)).find((candidate) => candidate.id === workId);
		if (!work) throw new Error(`Work not found: ${workId}`);
		if (!work.stub) throw new Error(`Work is not a Stub: ${workId}`);
		await this.#db.query(
			`UPDATE $work SET stub = NONE, updated_at = $updatedAt;`,
			{ work: new RecordId("work", workId), updatedAt },
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

	async createBookmark(bookmark: Bookmark): Promise<void> {
		const occurrence = (await this.listOccurrences()).find((candidate) =>
			candidate.id === bookmark.occurrenceId
		);
		if (occurrence?.workId !== bookmark.workId) {
			throw new Error("Bookmark Work and Occurrence must exist and match");
		}
		if ((await this.listBookmarks()).some((candidate) => candidate.id === bookmark.id)) {
			throw new Error(`Bookmark already exists: ${bookmark.id}`);
		}
		await this.#db.query(
			`CREATE $record CONTENT { work: $work, occurrence: $occurrence, created_at: $createdAt };`,
			{
				record: new RecordId("bookmark", bookmark.id),
				work: new RecordId("work", bookmark.workId),
				occurrence: new RecordId("occurrence", bookmark.occurrenceId),
				createdAt: bookmark.createdAt,
			},
		);
	}

	async deleteBookmark(id: string): Promise<void> {
		await this.#db.query(`DELETE $record;`, { record: new RecordId("bookmark", id) });
	}

	async setResumePosition(position: ResumePosition): Promise<void> {
		if (!Number.isSafeInteger(position.caretOffset) || position.caretOffset < 0) {
			throw new Error(`Invalid caret offset: ${position.caretOffset}`);
		}
		const occurrence = (await this.listOccurrences()).find((candidate) =>
			candidate.id === position.occurrenceId
		);
		if (occurrence?.workId !== position.workId) {
			throw new Error("Resume Work and Occurrence must exist and match");
		}
		await this.#db.query(
			resumePositionUpsertQuery(),
			{
				work: new RecordId("work", position.workId),
				occurrence: new RecordId("occurrence", position.occurrenceId),
				caretOffset: position.caretOffset,
				updatedAt: position.updatedAt,
			},
		);
	}

	async clearResumePosition(): Promise<void> {
		await this.#db.query(`DELETE resume_position:current;`);
	}

	async createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		if (branch.id !== workingCopy.branchId || branch.workId !== workingCopy.workId) {
			throw new Error("Branch and Working Copy identity must match");
		}
		await this.#db.query(
			`BEGIN TRANSACTION;
			CREATE $branch CONTENT {
				work: $work, name: $name, head_revision: ${branch.headRevisionId ? "$head" : "NONE"},
				created_at: $createdAt, promoted_at: ${branch.promotedAt ? "$promotedAt" : "NONE"},
				archived_at: ${branch.archivedAt ? "$archivedAt" : "NONE"}
			};
			CREATE $copy CONTENT {
				work: $work, branch: $branch, text: $text, updated_at: $updatedAt
			};
			COMMIT TRANSACTION;`,
			{
				...branch,
				...workingCopy,
				branch: new RecordId("branch", branch.id),
				copy: new RecordId("working_copy", branch.id),
				work: new RecordId("work", branch.workId),
				...(branch.headRevisionId ? { head: new RecordId("revision", branch.headRevisionId) } : {}),
			},
		);
	}

	async updateBranch(branch: Branch): Promise<void> {
		await this.#db.query(
			`UPDATE $branch CONTENT {
				work: $work, name: $name, head_revision: ${branch.headRevisionId ? "$head" : "NONE"},
				created_at: $createdAt, promoted_at: ${branch.promotedAt ? "$promotedAt" : "NONE"},
				archived_at: ${branch.archivedAt ? "$archivedAt" : "NONE"}
			};`,
			{
				...branch,
				branch: new RecordId("branch", branch.id),
				work: new RecordId("work", branch.workId),
				...(branch.headRevisionId ? { head: new RecordId("revision", branch.headRevisionId) } : {}),
			},
		);
	}

	async updateBranchWorkingCopy(
		branchId: string,
		text: string,
		updatedAt: string,
	): Promise<void> {
		const copy = (await this.listWorkingCopies()).find((candidate) =>
			candidate.branchId === branchId
		);
		if (!copy) throw new Error(`Working Copy not found for Branch: ${branchId}`);
		const branch = new RecordId("branch", branchId);
		await this.#db.query(
			`UPDATE working_copy SET text = $text, updated_at = $updatedAt WHERE branch = $branch;
			UPDATE $work SET updated_at = $updatedAt;`,
			{ branch, work: new RecordId("work", copy.workId), text, updatedAt },
		);
	}

	async updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void> {
		const main = (await this.listBranches(workId)).find((branch) => branch.name === "main");
		if (!main) throw new Error(`Main Branch not found for Work: ${workId}`);
		await this.updateBranchWorkingCopy(main.id, text, updatedAt);
	}

	async createRevision(revision: Revision, branchId: string): Promise<void> {
		const [branches, revisions] = await Promise.all([
			this.listBranches(),
			this.listRevisions(),
		]);
		const branch = branches.find((candidate) => candidate.id === branchId);
		validateRevisionCreation(revision, branch, revisions);
		const message = revision.message ? "$message" : "NONE";
		await this.#db.query(
			`BEGIN TRANSACTION;
			CREATE $revision CONTENT {
				work: $work, text: $text, parent_revisions: $parents, kind: $kind,
				created_at: $createdAt, message: ${message}
			};
			UPDATE $branch SET head_revision = $revision;
			COMMIT TRANSACTION;`,
			{
				...revision,
				revision: new RecordId("revision", revision.id),
				work: new RecordId("work", revision.workId),
				branch: new RecordId("branch", branchId),
				parents: revision.parentRevisionIds.map((id) => new RecordId("revision", id)),
			},
		);
	}

	async createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
		const copy = (await this.listWorkingCopies(snapshot.workId)).find((candidate) =>
			candidate.branchId === snapshot.branchId
		);
		if (!copy) {
			throw new Error(`Working Copy not found for Snapshot: ${snapshot.branchId}`);
		}
		await this.#db.query(
			`CREATE $snapshot CONTENT {
				work: $work, branch: $branch, text: $text, content_hash: $contentHash,
				created_at: $createdAt,
				source_revision: ${snapshot.sourceRevisionId ? "$sourceRevision" : "NONE"},
				name: ${snapshot.name ? "$name" : "NONE"},
				protection_reason: ${snapshot.protection ? "$protectionReason" : "NONE"},
				protected_at: ${snapshot.protection ? "$protectedAt" : "NONE"},
				protection_expires_at: ${snapshot.protection?.expiresAt ? "$expiresAt" : "NONE"}
			};`,
			{
				...snapshot,
				snapshot: new RecordId("recovery_snapshot", snapshot.id),
				work: new RecordId("work", snapshot.workId),
				branch: new RecordId("branch", snapshot.branchId),
				...(snapshot.sourceRevisionId
					? { sourceRevision: new RecordId("revision", snapshot.sourceRevisionId) }
					: {}),
				...(snapshot.protection
					? {
						protectionReason: snapshot.protection.reason,
						protectedAt: snapshot.protection.protectedAt,
						expiresAt: snapshot.protection.expiresAt,
					}
					: {}),
			},
		);
	}

	async applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void> {
		const snapshots = await this.listRecoverySnapshots();
		const snapshot = snapshots.find((candidate) => candidate.id === snapshotId);
		if (!snapshot) throw new Error(`Recovery Snapshot not found: ${snapshotId}`);
		await this.updateBranchWorkingCopy(snapshot.branchId, snapshot.text, updatedAt);
	}

	async restoreRecoverySnapshot(
		snapshotId: string,
		beforeRestore: RecoverySnapshot,
		updatedAt: string,
	): Promise<void> {
		const [snapshots, copies] = await Promise.all([
			this.listRecoverySnapshots(),
			this.listWorkingCopies(),
		]);
		const target = snapshots.find((candidate) => candidate.id === snapshotId);
		if (!target) throw new Error(`Recovery Snapshot not found: ${snapshotId}`);
		const copy = copies.find((candidate) => candidate.branchId === target.branchId);
		if (
			!copy || copy.workId !== target.workId ||
			beforeRestore.workId !== target.workId ||
			beforeRestore.branchId !== target.branchId
		) {
			throw new Error("Recovery Snapshot scope does not match Working Copy");
		}
		if (snapshots.some((candidate) => candidate.id === beforeRestore.id)) {
			throw new Error(`Recovery Snapshot already exists: ${beforeRestore.id}`);
		}
		if (beforeRestore.text !== copy.text) {
			throw new Error("Recovery Snapshot does not capture current Working Copy");
		}
		await this.#db.query(
			recoveryRestoreTransactionQuery(
				beforeRestore.sourceRevisionId !== null,
				beforeRestore.name !== undefined,
			),
			{
				beforeRestore: new RecordId("recovery_snapshot", beforeRestore.id),
				work: new RecordId("work", target.workId),
				branch: new RecordId("branch", target.branchId),
				beforeText: beforeRestore.text,
				contentHash: beforeRestore.contentHash,
				createdAt: beforeRestore.createdAt,
				targetText: target.text,
				updatedAt,
				...(beforeRestore.sourceRevisionId
					? { sourceRevision: new RecordId("revision", beforeRestore.sourceRevisionId) }
					: {}),
				...(beforeRestore.name ? { name: beforeRestore.name } : {}),
			},
		);
	}

	async promoteRecoverySnapshot(
		snapshotId: string,
		revision: Revision,
		branchId: string,
		protectedAt: string,
	): Promise<void> {
		const [snapshots, branches, revisions] = await Promise.all([
			this.listRecoverySnapshots(),
			this.listBranches(),
			this.listRevisions(),
		]);
		const snapshot = snapshots.find((candidate) => candidate.id === snapshotId);
		const branch = branches.find((candidate) => candidate.id === branchId);
		if (!snapshot) throw new Error(`Recovery Snapshot not found: ${snapshotId}`);
		if (
			snapshot.branchId !== branchId || snapshot.workId !== revision.workId ||
			branch?.workId !== snapshot.workId || revision.text !== snapshot.text
		) {
			throw new Error("Recovery Snapshot scope does not match Revision");
		}
		validateRevisionCreation(revision, branch, revisions);
		await this.#db.query(
			recoveryPromotionTransactionQuery(revision.message !== undefined),
			{
				...revision,
				revision: new RecordId("revision", revision.id),
				work: new RecordId("work", revision.workId),
				branch: new RecordId("branch", branchId),
				snapshot: new RecordId("recovery_snapshot", snapshotId),
				parents: revision.parentRevisionIds.map((id) => new RecordId("revision", id)),
				protectedAt,
			},
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
			DELETE recovery_snapshot WHERE work = $work;
			${navigationPurgeStatements()}
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

	async listEmergenceSuggestions(): Promise<EmergenceSuggestion[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, kind, record::id(context_work) AS context_work_id,
				record::id(target_work) AS target_work_id, context_occurrence_id,
				target_occurrence_id, proposed_link_type, title, explanation, evidence,
				score, status, created_at, updated_at, resolved_at, resolution_reason
				FROM emergence_suggestion ORDER BY updated_at DESC;`,
		);
		return rows.map((row) => {
			const persistenceStatus = String(row.status) as EmergenceSuggestion["persistenceStatus"];
			return {
				id: String(row.id),
				kind: String(row.kind) as EmergenceSuggestion["kind"],
				contextWorkId: domainId(row.context_work_id, "work_id"),
				targetWorkId: domainId(row.target_work_id, "work_id"),
				contextItemId: String(row.context_occurrence_id ?? ""),
				targetItemId: String(row.target_occurrence_id ?? ""),
				...(row.proposed_link_type == null
					? {}
					: { proposedLinkType: String(row.proposed_link_type) as LinkType }),
				title: String(row.title ?? ""),
				explanation: String(row.explanation ?? ""),
				evidence: Array.isArray(row.evidence)
					? row.evidence.map((step) => {
						const value = step as Row;
						return {
							fromId: String(value.fromId ?? value.from_id ?? ""),
							toId: String(value.toId ?? value.to_id ?? ""),
							relation: String(
								value.relation ?? "",
							) as EmergenceSuggestion["evidence"][number]["relation"],
						};
					})
					: [],
				score: Number(row.score ?? 0),
				...(persistenceStatus === "held" ? { status: "pinned" as const } : {}),
				persistenceStatus,
				createdAt: String(row.created_at ?? ""),
				updatedAt: String(row.updated_at ?? ""),
				...(row.resolved_at == null ? {} : { resolvedAt: String(row.resolved_at) }),
				...(row.resolution_reason == null
					? {}
					: { resolutionReason: String(row.resolution_reason) }),
			};
		});
	}

	async upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void> {
		await this.#db.query(
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
			await this.#db.query(
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
		await this.#db.query(
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

	private async listWorkingCopyRows(workId?: string): Promise<Row[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(work) AS work_id, record::id(branch) AS branch_id,
				text, updated_at FROM working_copy ${workId ? "WHERE work = $work" : ""};`,
			workId ? { work: new RecordId("work", workId) } : undefined,
		);
		return rows;
	}

	private async listRevisionRows(workId?: string): Promise<Row[]> {
		const [rows] = await this.#db.query<[Row[]]>(
			`SELECT record::id(id) AS id, record::id(work) AS work_id, text,
				parent_revisions, kind, created_at, message
				FROM revision ${workId ? "WHERE work = $work" : ""};`,
			workId ? { work: new RecordId("work", workId) } : undefined,
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
