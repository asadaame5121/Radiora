import { RecordId } from "surrealdb";
import type { Bookmark, Occurrence, OutlineItem, ResumePosition } from "../domain/models.ts";
import type { OutlineStorePort, WorkStorePort } from "./graph_store.ts";
import { resumePositionUpsertQuery } from "./surreal_queries.ts";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import {
	bookmarkFromRow,
	itemFromRow,
	occurrenceFromRow,
	optionalRecordDomainId,
	resumePositionFromRow,
	type SurrealRow as Row,
} from "./surreal_row_mapper.ts";

type OutlineWorkReader = Pick<
	WorkStorePort,
	"listWorks" | "listWorkingCopies" | "listRevisions"
>;

export class SurrealOutlineRepository implements OutlineStorePort {
	constructor(
		private readonly db: SurrealQueryClient,
		private readonly work: OutlineWorkReader,
	) {}

	async listItems(): Promise<OutlineItem[]> {
		const [occurrenceRows, works, copies, revisions] = await Promise.all([
			this.listOccurrenceRows(),
			this.work.listWorks(),
			this.work.listWorkingCopies(),
			this.work.listRevisions(),
		]);
		const workById = new Map(works.map((work) => [work.id, work]));
		const copyByBranch = new Map(copies.map((copy) => [copy.branchId, copy.text]));
		const revisionText = new Map(revisions.map((revision) => [revision.id, revision.text]));
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

	async listOccurrences(includeDeletedWorks = false): Promise<Occurrence[]> {
		const visible = new Set(
			(await this.work.listWorks(includeDeletedWorks)).map((work) => work.id),
		);
		return (await this.listOccurrenceRows()).flatMap((row): Occurrence[] => {
			const occurrence = occurrenceFromRow(row);
			return visible.has(occurrence.workId) ? [occurrence] : [];
		});
	}

	async listBookmarks(): Promise<Bookmark[]> {
		const activeWorkIds = new Set((await this.work.listWorks()).map((work) => work.id));
		const [rows] = await this.db.query<[Row[]]>(
			`SELECT record::id(id) AS id, record::id(work) AS work_id,
				record::id(occurrence) AS occurrence_id, created_at
				FROM bookmark ORDER BY created_at, id;`,
		);
		return rows.flatMap((row): Bookmark[] => {
			const bookmark = bookmarkFromRow(row);
			return activeWorkIds.has(bookmark.workId) ? [bookmark] : [];
		});
	}

	async getResumePosition(): Promise<ResumePosition | null> {
		const [rows] = await this.db.query<[Row[]]>(
			`SELECT record::id(work) AS work_id, record::id(occurrence) AS occurrence_id,
				caret_offset, updated_at FROM resume_position:current;`,
		);
		const row = rows[0];
		if (!row) return null;
		const position = resumePositionFromRow(row);
		if (!(await this.work.listWorks()).some((work) => work.id === position.workId)) return null;
		return position;
	}

	async createOccurrence(occurrence: Occurrence): Promise<void> {
		const expressions = this.occurrenceExpressions(occurrence);
		await this.db.query(
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
		await this.db.query(
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
		await this.db.query(`DELETE $record;`, { record: new RecordId("bookmark", id) });
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
		await this.db.query(
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
		await this.db.query(`DELETE resume_position:current;`);
	}

	async updateOccurrence(occurrence: Occurrence): Promise<void> {
		const expressions = this.occurrenceExpressions(occurrence);
		await this.db.query(
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
		await this.db.query(`DELETE $record;`, { record: new RecordId("occurrence", id) });
	}

	private async listOccurrenceRows(): Promise<Row[]> {
		const [rows] = await this.db.query<[Row[]]>(
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
}
