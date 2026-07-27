import { RecordId } from "surrealdb";
import type { LinkType } from "../../domain/models.ts";
import type { MigrationContext, StorageMigration } from "./mod.ts";

type Row = Record<string, unknown>;

const SEMANTIC_RELATIONS: Array<{ table: string; type: LinkType }> = [
	{ table: "liked", type: "LIKE" },
	{ table: "fixed", type: "FIX" },
	{ table: "conflicted", type: "VS" },
];

export const workOccurrenceMigration: StorageMigration = {
	id: "0001_work_occurrence",
	fromVersion: 0,
	toVersion: 1,
	async up(context) {
		await context.execute(V1_SCHEMA);
		const items = await rows(
			context,
			`
			SELECT record::id(id) AS id, text, order_key, collapsed, created_at, updated_at,
				array::first(
					(<-evolved_from<-outline_item).map(|$parent| record::id($parent.id))
				) AS parent_id
			FROM outline_item ORDER BY order_key;
		`,
		);

		for (const row of items) {
			const id = String(row.id);
			const work = new RecordId("work", id);
			const branch = new RecordId("branch", id);
			const occurrence = new RecordId("occurrence", id);
			await context.execute(
				`UPSERT $work CONTENT {
					created_at: $createdAt,
					updated_at: $updatedAt,
					deleted_at: NONE
				};
				UPSERT $branch CONTENT {
					work: $work,
					name: "main",
					head_revision: NONE,
					created_at: $createdAt,
					promoted_at: NONE,
					archived_at: NONE
				};
				UPSERT $copy CONTENT {
					work: $work,
					branch: $branch,
					text: $text,
					updated_at: $updatedAt
				};
				UPSERT $occurrence CONTENT {
					work: $work,
					parent_occurrence: NONE,
					order_key: $orderKey,
					collapsed: $collapsed,
					selector_mode: "branch",
					branch: $branch,
					revision: NONE,
					contextual_heading: NONE
				};`,
				{
					work,
					branch,
					copy: new RecordId("working_copy", id),
					occurrence,
					text: String(row.text ?? ""),
					orderKey: Number(row.order_key ?? 0),
					collapsed: Boolean(row.collapsed),
					createdAt: String(row.created_at ?? ""),
					updatedAt: String(row.updated_at ?? ""),
				},
			);
		}

		for (const row of items) {
			if (row.parent_id == null) continue;
			await context.execute(
				`UPDATE $occurrence SET parent_occurrence = $parent;`,
				{
					occurrence: new RecordId("occurrence", String(row.id)),
					parent: new RecordId("occurrence", String(row.parent_id)),
				},
			);
		}

		for (const relation of SEMANTIC_RELATIONS) {
			const relationRows = await rows(
				context,
				`SELECT record::id(id) AS id, record::id(in) AS from_id,
					record::id(out) AS to_id, created_at FROM ${relation.table};`,
			);
			for (const row of relationRows) {
				const id = `v0-${relation.type.toLowerCase()}-${String(row.id)}`;
				await context.execute(
					`UPSERT $record CONTENT {
						from_scope: "work",
						from_work: $fromWork,
						from_revision: NONE,
						to_scope: "work",
						to_work: $toWork,
						to_revision: NONE,
						type: $type,
						status: "asserted",
						origin: "import",
						reason: NONE,
						created_at: $createdAt
					};`,
					{
						record: new RecordId("semantic_link", id),
						fromWork: new RecordId("work", String(row.from_id)),
						toWork: new RecordId("work", String(row.to_id)),
						type: relation.type,
						createdAt: String(row.created_at ?? ""),
					},
				);
			}
		}

		const systemRows = await rows(
			context,
			`SELECT record::id(id) AS id, record::id(in) AS from_id,
				record::id(out) AS to_id, created_at FROM in_knot;`,
		);
		for (const row of systemRows) {
			await context.execute(
				`UPSERT $record CONTENT {
					from_work: $fromWork,
					to_work: $toWork,
					type: "IN",
					created_at: $createdAt
				};`,
				{
					record: new RecordId("system_relation", `v0-in-${String(row.id)}`),
					fromWork: new RecordId("work", String(row.from_id)),
					toWork: new RecordId("work", String(row.to_id)),
					createdAt: String(row.created_at ?? ""),
				},
			);
		}
	},
	async validate(context) {
		const legacy = await rows(
			context,
			`
			SELECT record::id(id) AS id, text, created_at, updated_at FROM outline_item;
		`,
		);
		const migrated = await rows(
			context,
			`
			SELECT record::id(work.id) AS id, text,
				work.created_at AS created_at, work.updated_at AS updated_at
			FROM working_copy;
		`,
		);
		if (legacy.length !== migrated.length) {
			throw new Error(
				`Work migration count mismatch: ${legacy.length} legacy, ${migrated.length} migrated`,
			);
		}
		const byId = new Map(migrated.map((row) => [String(row.id), row]));
		for (const source of legacy) {
			const target = byId.get(String(source.id));
			if (
				!target ||
				String(target.text ?? "") !== String(source.text ?? "") ||
				String(target.created_at ?? "") !== String(source.created_at ?? "") ||
				String(target.updated_at ?? "") !== String(source.updated_at ?? "")
			) {
				throw new Error(`Work migration data mismatch for ${String(source.id)}`);
			}
		}

		const occurrences = await rows(
			context,
			`
			SELECT record::id(id) AS id, record::id(work) AS work_id,
				parent_occurrence, selector_mode, branch FROM occurrence;
		`,
		);
		if (occurrences.length !== legacy.length) {
			throw new Error("Each legacy OutlineItem must produce exactly one Occurrence");
		}
		for (const occurrence of occurrences) {
			if (
				String(occurrence.id) !== String(occurrence.work_id) ||
				occurrence.selector_mode !== "branch" ||
				occurrence.branch == null
			) {
				throw new Error(`Invalid Occurrence migration for ${String(occurrence.id)}`);
			}
		}
	},
};

async function rows(context: MigrationContext, statement: string): Promise<Row[]> {
	const result = await context.execute(statement) as unknown[];
	return Array.isArray(result?.[0]) ? result[0] as Row[] : [];
}

const V1_SCHEMA = `
	DEFINE TABLE IF NOT EXISTS work SCHEMAFULL;
	DEFINE FIELD IF NOT EXISTS created_at ON work TYPE string;
	DEFINE FIELD IF NOT EXISTS updated_at ON work TYPE string;
	DEFINE FIELD IF NOT EXISTS deleted_at ON work TYPE option<string>;

	DEFINE TABLE IF NOT EXISTS revision SCHEMAFULL;
	DEFINE FIELD IF NOT EXISTS work ON revision TYPE record<work>;
	DEFINE FIELD IF NOT EXISTS text ON revision TYPE string;
	DEFINE FIELD IF NOT EXISTS parent_revisions ON revision TYPE array<record<revision>>;
	DEFINE FIELD IF NOT EXISTS kind ON revision TYPE string;
	DEFINE FIELD IF NOT EXISTS created_at ON revision TYPE string;
	DEFINE FIELD IF NOT EXISTS message ON revision TYPE option<string>;

	DEFINE TABLE IF NOT EXISTS branch SCHEMAFULL;
	DEFINE FIELD IF NOT EXISTS work ON branch TYPE record<work>;
	DEFINE FIELD IF NOT EXISTS name ON branch TYPE string;
	DEFINE FIELD IF NOT EXISTS head_revision ON branch TYPE option<record<revision>>;
	DEFINE FIELD IF NOT EXISTS created_at ON branch TYPE string;
	DEFINE FIELD IF NOT EXISTS promoted_at ON branch TYPE option<string>;
	DEFINE FIELD IF NOT EXISTS archived_at ON branch TYPE option<string>;

	DEFINE TABLE IF NOT EXISTS working_copy SCHEMAFULL;
	DEFINE FIELD IF NOT EXISTS work ON working_copy TYPE record<work>;
	DEFINE FIELD IF NOT EXISTS branch ON working_copy TYPE record<branch>;
	DEFINE FIELD IF NOT EXISTS text ON working_copy TYPE string;
	DEFINE FIELD IF NOT EXISTS updated_at ON working_copy TYPE string;

	DEFINE TABLE IF NOT EXISTS occurrence SCHEMAFULL;
	DEFINE FIELD IF NOT EXISTS work ON occurrence TYPE record<work>;
	DEFINE FIELD IF NOT EXISTS parent_occurrence ON occurrence TYPE option<record<occurrence>>;
	DEFINE FIELD IF NOT EXISTS order_key ON occurrence TYPE number;
	DEFINE FIELD IF NOT EXISTS collapsed ON occurrence TYPE bool DEFAULT false;
	DEFINE FIELD IF NOT EXISTS selector_mode ON occurrence TYPE string;
	DEFINE FIELD IF NOT EXISTS branch ON occurrence TYPE option<record<branch>>;
	DEFINE FIELD IF NOT EXISTS revision ON occurrence TYPE option<record<revision>>;
	DEFINE FIELD IF NOT EXISTS contextual_heading ON occurrence TYPE option<string>;

	DEFINE TABLE IF NOT EXISTS semantic_link SCHEMAFULL;
	DEFINE FIELD IF NOT EXISTS from_scope ON semantic_link TYPE string;
	DEFINE FIELD IF NOT EXISTS from_work ON semantic_link TYPE record<work>;
	DEFINE FIELD IF NOT EXISTS from_revision ON semantic_link TYPE option<record<revision>>;
	DEFINE FIELD IF NOT EXISTS to_scope ON semantic_link TYPE string;
	DEFINE FIELD IF NOT EXISTS to_work ON semantic_link TYPE record<work>;
	DEFINE FIELD IF NOT EXISTS to_revision ON semantic_link TYPE option<record<revision>>;
	DEFINE FIELD IF NOT EXISTS type ON semantic_link TYPE string;
	DEFINE FIELD IF NOT EXISTS status ON semantic_link TYPE string;
	DEFINE FIELD IF NOT EXISTS origin ON semantic_link TYPE string;
	DEFINE FIELD IF NOT EXISTS reason ON semantic_link TYPE option<string>;
	DEFINE FIELD IF NOT EXISTS created_at ON semantic_link TYPE string;

	DEFINE TABLE IF NOT EXISTS system_relation SCHEMAFULL;
	DEFINE FIELD IF NOT EXISTS from_work ON system_relation TYPE record<work>;
	DEFINE FIELD IF NOT EXISTS to_work ON system_relation TYPE record<work>;
	DEFINE FIELD IF NOT EXISTS type ON system_relation TYPE string;
	DEFINE FIELD IF NOT EXISTS created_at ON system_relation TYPE string;

	DEFINE TABLE IF NOT EXISTS purge_manifest SCHEMAFULL;
	DEFINE FIELD IF NOT EXISTS work_id ON purge_manifest TYPE string;
	DEFINE FIELD IF NOT EXISTS occurrence_ids ON purge_manifest TYPE array<string>;
	DEFINE FIELD IF NOT EXISTS branch_ids ON purge_manifest TYPE array<string>;
	DEFINE FIELD IF NOT EXISTS revision_ids ON purge_manifest TYPE array<string>;
	DEFINE FIELD IF NOT EXISTS link_ids ON purge_manifest TYPE array<string>;
	DEFINE FIELD IF NOT EXISTS purged_at ON purge_manifest TYPE string;
`;
