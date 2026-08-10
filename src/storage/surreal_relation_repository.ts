import { RecordId } from "surrealdb";
import type { Knot, LinkType, OutlineLink, SystemRelation } from "../domain/models.ts";
import type { RelationStorePort } from "./graph_store.ts";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import { knotFromRow, outlineLinkFromRow, systemRelationFromRow } from "./surreal_row_mapper.ts";

/** SurrealDB-backed repository for semantic links, system relations, and knots. */
export class SurrealRelationRepository implements RelationStorePort {
	constructor(private readonly db: SurrealQueryClient) {}

	async listLinks(): Promise<OutlineLink[]> {
		const [rows] = await this.db.query<[Record<string, unknown>[]]>(
			`SELECT record::id(id) AS id, from_scope, record::id(from_work) AS from_id,
				from_revision, to_scope,
				record::id(to_work) AS to_id, to_revision,
				type, status, origin, reason, created_at FROM semantic_link;`,
		);
		return rows.map(outlineLinkFromRow);
	}

	async createLink(link: OutlineLink): Promise<void> {
		const fromRevision = link.from.scope === "revision" ? "$fromRevision" : "NONE";
		const toRevision = link.to.scope === "revision" ? "$toRevision" : "NONE";
		const reason = link.reason ? "$reason" : "NONE";
		await this.db.query(
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
		await this.db.query(
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
		const [rows] = await this.db.query<[Record<string, unknown>[]]>(
			`SELECT record::id(id) AS id, record::id(from_work) AS from_id,
				record::id(to_work) AS to_id, type, created_at FROM system_relation;`,
		);
		return rows.map(systemRelationFromRow);
	}

	async listKnots(): Promise<Knot[]> {
		const [rows] = await this.db.query<[Record<string, unknown>[]]>(
			`SELECT record::id(id) AS id, cycle_ids, created_at FROM knot;`,
		);
		return rows.map(knotFromRow);
	}

	async replaceKnots(knots: Knot[]): Promise<void> {
		await this.db.query("DELETE knot;");
		for (const knot of knots) {
			await this.db.query(
				`CREATE $record CONTENT { cycle_ids: $cycleIds, created_at: $createdAt };`,
				{ ...knot, record: new RecordId("knot", knot.id) },
			);
		}
	}
}
