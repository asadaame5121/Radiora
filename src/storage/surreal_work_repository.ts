import { RecordId } from "surrealdb";
import type { Branch, Occurrence, PurgeManifest, Work, WorkingCopy } from "../domain/models.ts";
import type {
	DiscoveryStorePort,
	MergeWorksInput,
	OutlineStorePort,
	RelationStorePort,
	WorkBundle,
	WorkStorePort,
} from "./graph_store.ts";
import { validateUnplacedWorkCreation, validateWorkBundleImport } from "./graph_store.ts";
import {
	importWorkBundlesTransactionQuery,
	mergeWorksTransactionQuery,
	navigationPurgeStatements,
	quickCaptureTransactionQuery,
} from "./surreal_queries.ts";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import { purgeManifestFromRow, type SurrealRow as Row, workFromRow } from "./surreal_row_mapper.ts";
import { duplicateLinkIdsAfterMerge } from "./surreal_relation_operations.ts";

export type SurrealWorkRepositoryPort = Pick<
	WorkStorePort,
	| "listWorks"
	| "createWorkBundle"
	| "importWorkBundles"
	| "createUnplacedWork"
	| "mergeWorks"
	| "resolveWorkStub"
	| "trashWork"
	| "restoreWork"
	| "purgeWork"
	| "listPurgeManifests"
>;

type RelatedWorkState =
	& Pick<WorkStorePort, "listBranches" | "listWorkingCopies">
	& Pick<OutlineStorePort, "listOccurrences">;

export class SurrealWorkRepository implements SurrealWorkRepositoryPort {
	constructor(
		private readonly db: SurrealQueryClient,
		private readonly relatedState: RelatedWorkState,
		private readonly relations: Pick<RelationStorePort, "listLinks">,
		private readonly discovery: Pick<DiscoveryStorePort, "listAliases">,
	) {}

	async listWorks(includeDeleted = false): Promise<Work[]> {
		const [rows] = await this.db.query<[Row[]]>(
			`SELECT record::id(id) AS id, created_at, updated_at, deleted_at, stub,
				merged_into_work, merged_at
				FROM work ${
				includeDeleted ? "" : "WHERE deleted_at IS NONE AND merged_into_work IS NONE"
			};`,
		);
		return rows.map(workFromRow);
	}

	async createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void> {
		const parent = occurrence.parentOccurrenceId ? "$parent" : "NONE";
		const contextualHeading = occurrence.contextualHeading ? "$contextualHeading" : "NONE";
		await this.db.query(
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
			this.relatedState.listBranches(),
			this.relatedState.listWorkingCopies(),
			this.relatedState.listOccurrences(true),
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
		await this.db.query(
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
			this.relatedState.listBranches(),
			this.relatedState.listWorkingCopies(),
		]);
		validateUnplacedWorkCreation(work, branch, workingCopy, works, branches, copies);
		await this.db.query(
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
			this.discovery.listAliases(),
			this.relations.listLinks(),
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
		await this.db.query(mergeWorksTransactionQuery(Boolean(input.alias)), {
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
		await this.db.query(
			`UPDATE $work SET stub = NONE, updated_at = $updatedAt;`,
			{ work: new RecordId("work", workId), updatedAt },
		);
	}

	async trashWork(workId: string, deletedAt: string): Promise<void> {
		await this.db.query(`UPDATE $work SET deleted_at = $deletedAt, updated_at = $deletedAt;`, {
			work: new RecordId("work", workId),
			deletedAt,
		});
	}

	async restoreWork(workId: string): Promise<void> {
		await this.db.query(`UPDATE $work SET deleted_at = NONE;`, {
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
			this.db.query<[Row[]]>(
				`SELECT record::id(id) AS id FROM occurrence WHERE work = $work;`,
				{ work },
			).then(([rows]) => rows),
			this.db.query<[Row[]]>(
				`SELECT record::id(id) AS id FROM branch WHERE work = $work;`,
				{ work },
			).then(([rows]) => rows),
			this.db.query<[Row[]]>(
				`SELECT record::id(id) AS id FROM revision WHERE work = $work;`,
				{ work },
			).then(([rows]) => rows),
			this.relations.listLinks(),
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
		await this.db.query(
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
		const [rows] = await this.db.query<[Row[]]>(
			`SELECT record::id(id) AS id, work_id, occurrence_ids, branch_ids,
				revision_ids, link_ids, purged_at FROM purge_manifest ORDER BY purged_at DESC;`,
		);
		return rows.map(purgeManifestFromRow);
	}
}
