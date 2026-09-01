import type {
	Bookmark,
	Branch,
	EmergenceSuggestion,
	Knot,
	Occurrence,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	RelationTypeDefinition,
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { BUILT_IN_RELATION_TYPES } from "../domain/relation_type.ts";

interface LegacyItem {
	id: string;
	text: string;
	parentId: string | null;
	orderKey: number;
	collapsed: boolean;
	createdAt: string;
	updatedAt: string;
}

interface LegacyLink {
	fromId: string;
	toId: string;
	type: "LIKE" | "FIX" | "VS" | "IN";
	createdAt: string;
}

export interface BackupV0 {
	items: LegacyItem[];
	links: LegacyLink[];
	knots: Knot[];
	aliases?: SearchAlias[];
	emergenceFeedback?: Record<string, "accept" | "dismiss" | "pin">;
	savedRuleQueries?: SavedRuleQuery[];
}

export interface StoredGraphV1 {
	works: Work[];
	branches: Branch[];
	workingCopies: WorkingCopy[];
	occurrences: Occurrence[];
	links: OutlineLink[];
	systemRelations: SystemRelation[];
	knots: Knot[];
	aliases: SearchAlias[];
	emergenceFeedback: Record<string, "accept" | "dismiss" | "pin">;
	savedRuleQueries: SavedRuleQuery[];
	purgeManifests: PurgeManifest[];
}

export interface BackupV1 {
	format: "radiora-backup";
	schemaVersion: 1;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 1 };
	data: StoredGraphV1;
}

export interface StoredGraphV2 extends StoredGraphV1 {
	revisions: Revision[];
	recoverySnapshots: RecoverySnapshot[];
}

export interface BackupV2 {
	format: "radiora-backup";
	schemaVersion: 2;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 2 };
	data: StoredGraphV2;
}

export interface StoredGraphV3 extends StoredGraphV2 {
	bookmarks: Bookmark[];
	resumePosition: ResumePosition | null;
}

export interface BackupV3 {
	format: "radiora-backup";
	schemaVersion: 3;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 3 };
	data: StoredGraphV3;
}

/** Structurally identical to V3; `Work` now carries an optional `stub`. */
export interface StoredGraphV4 extends StoredGraphV3 {}

export interface BackupV4 {
	format: "radiora-backup";
	schemaVersion: 4;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 4 };
	data: StoredGraphV4;
}

/** Structurally identical to V4; Work now carries merge provenance. */
export interface StoredGraphV5 extends StoredGraphV4 {}

export interface BackupV5 {
	format: "radiora-backup";
	schemaVersion: 5;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 5 };
	data: StoredGraphV5;
}

export interface StoredGraphV6 extends StoredGraphV5 {
	emergenceSuggestions: EmergenceSuggestion[];
	relationTypeDefinitions?: RelationTypeDefinition[];
}

export interface BackupV6 {
	format: "radiora-backup";
	schemaVersion: 6;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 6 };
	data: StoredGraphV6;
}

export interface StoredGraphV7 extends StoredGraphV6 {
	relationTypeDefinitions: RelationTypeDefinition[];
}

export interface BackupV7 {
	format: "radiora-backup";
	schemaVersion: 7;
	exportedAt: string;
	appVersion: string;
	source: { storageSchemaVersion: 7 };
	data: StoredGraphV7;
}

export function migrateBackupV6(data: StoredGraphV6): StoredGraphV7 {
	return {
		...data,
		relationTypeDefinitions: data.relationTypeDefinitions
			? structuredClone(data.relationTypeDefinitions)
			: BUILT_IN_RELATION_TYPES.map((def) => ({ ...def })),
	};
}

export function migrateBackupV5(data: StoredGraphV5): StoredGraphV6 {
	return { ...data, emergenceSuggestions: [] };
}

export function migrateBackupV4(data: StoredGraphV4): StoredGraphV5 {
	return { ...data };
}

export function migrateBackupV3(data: StoredGraphV3): StoredGraphV4 {
	return { ...data };
}

export function migrateBackupV2(data: StoredGraphV2): StoredGraphV3 {
	return { ...data, bookmarks: [], resumePosition: null };
}

export function migrateBackupV1(data: StoredGraphV1): StoredGraphV2 {
	return {
		...data,
		revisions: [],
		recoverySnapshots: [],
	};
}

export function migrateBackupV0(data: BackupV0): StoredGraphV1 {
	const works: Work[] = data.items.map((item) => ({
		id: item.id,
		createdAt: item.createdAt,
		updatedAt: item.updatedAt,
	}));
	const branches: Branch[] = data.items.map((item) => ({
		id: item.id,
		workId: item.id,
		name: "main",
		headRevisionId: null,
		createdAt: item.createdAt,
	}));
	const workingCopies: WorkingCopy[] = data.items.map((item) => ({
		branchId: item.id,
		workId: item.id,
		text: item.text,
		updatedAt: item.updatedAt,
	}));
	const occurrences: Occurrence[] = data.items.map((item) => ({
		id: item.id,
		workId: item.id,
		parentOccurrenceId: item.parentId,
		orderKey: item.orderKey,
		collapsed: item.collapsed,
		revisionSelector: { mode: "branch", branchId: item.id },
	}));
	const semanticLinks = data.links.filter((link) => link.type !== "IN");
	const links: OutlineLink[] = semanticLinks.map((link) => ({
		id: legacyRelationId(link),
		fromId: link.fromId,
		toId: link.toId,
		from: { scope: "work", workId: link.fromId },
		to: { scope: "work", workId: link.toId },
		type: link.type as "LIKE" | "FIX" | "VS",
		status: "asserted",
		origin: "import",
		createdAt: link.createdAt,
	}));
	const systemRelations: SystemRelation[] = data.links
		.filter((link) => link.type === "IN")
		.map((link) => ({
			id: legacyRelationId(link),
			fromWorkId: link.fromId,
			toWorkId: link.toId,
			type: "IN",
			createdAt: link.createdAt,
		}));

	return {
		works,
		branches,
		workingCopies,
		occurrences,
		links,
		systemRelations,
		knots: data.knots ?? [],
		aliases: data.aliases ?? [],
		emergenceFeedback: data.emergenceFeedback ?? {},
		savedRuleQueries: data.savedRuleQueries ?? [],
		purgeManifests: [],
	};
}

function legacyRelationId(link: LegacyLink): string {
	return `v0-${link.type.toLowerCase()}-${link.fromId}-${link.toId}`;
}
