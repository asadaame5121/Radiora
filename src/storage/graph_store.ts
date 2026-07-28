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

export interface GraphStore {
	initialize(): Promise<void>;
	close(): Promise<void>;
	listItems(): Promise<OutlineItem[]>;
	listWorks(includeDeleted?: boolean): Promise<Work[]>;
	listOccurrences(includeDeletedWorks?: boolean): Promise<Occurrence[]>;
	createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void>;
	createOccurrence(occurrence: Occurrence): Promise<void>;
	updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void>;
	updateOccurrence(occurrence: Occurrence): Promise<void>;
	deleteOccurrence(id: string): Promise<void>;
	trashWork(workId: string, deletedAt: string): Promise<void>;
	restoreWork(workId: string): Promise<void>;
	purgeWork(workId: string): Promise<PurgeManifest>;
	listPurgeManifests(): Promise<PurgeManifest[]>;
	listLinks(): Promise<OutlineLink[]>;
	createLink(link: OutlineLink): Promise<void>;
	/** Marks matching active links as retracted while retaining them for history. */
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void>;
	listSystemRelations(): Promise<SystemRelation[]>;
	listKnots(): Promise<Knot[]>;
	replaceKnots(knots: Knot[]): Promise<void>;
	suggestItems(prefix: string, limit: number): Promise<OutlineItem[]>;
	searchLexical(query: string, limit: number): Promise<LexicalHit[]>;
	listAliases(): Promise<SearchAlias[]>;
	upsertAlias(alias: SearchAlias): Promise<void>;
	deleteAlias(id: string): Promise<void>;
	getEmergenceFeedback(id: string): Promise<"accept" | "dismiss" | "pin" | null>;
	setEmergenceFeedback(id: string, action: "accept" | "dismiss" | "pin"): Promise<void>;
	listSavedRuleQueries(): Promise<SavedRuleQuery[]>;
	upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void>;
	deleteSavedRuleQuery(id: string): Promise<void>;
}
