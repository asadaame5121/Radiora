import type { RelationTypeDefinition } from "../../src/domain/models.ts";
import type { SurrealSqlStatementResult } from "../../src/storage/legacy_surreal_migration_reader.ts";

const CREATED_AT = "2026-10-01T00:00:00.000Z";

export const T02_IDS = {
	workA: "legacy-work-a",
	workB: "legacy-work-b",
	branchA: "legacy-branch-a",
	branchB: "legacy-branch-b",
	occurrenceA: "legacy-occurrence-a",
	occurrenceB: "legacy-occurrence-b",
	revisionA: "legacy-revision-a",
	link: "legacy-link-custom",
	systemRelation: "legacy-system-relation",
	knot: "legacy-knot",
	alias: "legacy-alias",
	feedback: "legacy-feedback",
	suggestion: "legacy-suggestion",
	ruleQuery: "legacy-rule-query",
	recoverySnapshot: "legacy-recovery-snapshot",
	bookmark: "legacy-bookmark",
} as const;

export const T02_CUSTOM_RELATION_TYPE: RelationTypeDefinition = {
	name: "CUSTOM_REL",
	direction: "directed",
	builtIn: false,
	createdAt: CREATED_AT,
};

export const T02_LEGACY_READER_INPUT: SurrealSqlStatementResult[] = [
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.workA,
				created_at: CREATED_AT,
				updated_at: CREATED_AT,
				deleted_at: null,
				merged_into_work: null,
				merged_at: null,
			},
			{
				id: T02_IDS.workB,
				created_at: CREATED_AT,
				updated_at: CREATED_AT,
				deleted_at: null,
				stub: {
					created_at: CREATED_AT,
					created_via: "stub-list",
					context: "保留情報 e\u0301 🧪",
				},
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.branchA,
				work_id: T02_IDS.workA,
				name: "main",
				head_revision: T02_IDS.revisionA,
				created_at: CREATED_AT,
				promoted_at: null,
				archived_at: null,
			},
			{
				id: T02_IDS.branchB,
				work_id: T02_IDS.workB,
				name: "main",
				head_revision: null,
				created_at: CREATED_AT,
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				branch_id: T02_IDS.branchA,
				work_id: T02_IDS.workA,
				text: "日本語\r\nemoji 🧪\r\ncombining e\u0301",
				updated_at: CREATED_AT,
			},
			{
				branch_id: T02_IDS.branchB,
				work_id: T02_IDS.workB,
				text: "子ども\r\nかな\u3099\r\n🌱",
				updated_at: CREATED_AT,
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.occurrenceA,
				work_id: T02_IDS.workA,
				parent_occurrence_id: null,
				order_key: 1024,
				collapsed: false,
				branch_id: T02_IDS.branchA,
				contextual_heading: null,
			},
			{
				id: T02_IDS.occurrenceB,
				work_id: T02_IDS.workB,
				parent_occurrence_id: null,
				order_key: 2048,
				collapsed: true,
				branch_id: T02_IDS.branchB,
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.link,
				from_id: T02_IDS.workA,
				to_id: T02_IDS.workB,
				from_scope: "work",
				to_scope: "work",
				type: T02_CUSTOM_RELATION_TYPE.name,
				status: "asserted",
				origin: "import",
				reason: null,
				created_at: CREATED_AT,
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.systemRelation,
				from_id: T02_IDS.workA,
				to_id: T02_IDS.workB,
				type: "IN",
				created_at: CREATED_AT,
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.knot,
				cycle_ids: [T02_IDS.occurrenceA],
				created_at: CREATED_AT,
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.alias,
				canonical: "見出し e\u0301",
				variants: ["日本語", "🧪"],
				created_at: CREATED_AT,
				updated_at: CREATED_AT,
			},
		],
	},
	{
		status: "OK",
		result: [{ id: T02_IDS.feedback, action: "pin" }],
	},
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.suggestion,
				kind: "latent-relation",
				context_work_id: T02_IDS.workA,
				target_work_id: T02_IDS.workB,
				context_occurrence_id: T02_IDS.occurrenceA,
				target_occurrence_id: T02_IDS.occurrenceB,
				proposed_link_type: T02_CUSTOM_RELATION_TYPE.name,
				title: "日本語 🧪",
				explanation: "結合 e\u0301\r\n保留候補",
				evidence: [
					{
						from_id: T02_IDS.workA,
						to_id: T02_IDS.workB,
						relation: T02_CUSTOM_RELATION_TYPE.name,
					},
				],
				score: 0.75,
				status: "pending",
				created_at: CREATED_AT,
				updated_at: CREATED_AT,
				resolved_at: null,
				resolution_reason: null,
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.ruleQuery,
				name: "日本語 query",
				source: 'from = "legacy-work-a"\r\nselect 🧪',
				created_at: CREATED_AT,
				updated_at: CREATED_AT,
			},
		],
	},
	{ status: "OK", result: [] },
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.revisionA,
				work_id: T02_IDS.workA,
				text: "日本語\r\nemoji 🧪\r\ncombining e\u0301",
				parent_revisions: [],
				kind: "edition",
				created_at: CREATED_AT,
				message: null,
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.recoverySnapshot,
				work_id: T02_IDS.workA,
				branch_id: T02_IDS.branchA,
				text: "回復用\r\n日本語 🧪",
				content_hash: "legacy-recovery-hash",
				created_at: CREATED_AT,
				source_revision_id: null,
				name: null,
				protection_reason: null,
				protected_at: null,
				protection_expires_at: null,
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				id: T02_IDS.bookmark,
				work_id: T02_IDS.workA,
				occurrence_id: T02_IDS.occurrenceA,
				created_at: CREATED_AT,
			},
		],
	},
	{
		status: "OK",
		result: [
			{
				work_id: T02_IDS.workA,
				occurrence_id: T02_IDS.occurrenceA,
				caret_offset: 5,
				updated_at: CREATED_AT,
			},
		],
	},
];
