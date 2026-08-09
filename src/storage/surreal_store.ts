import type {
	BackupStorePort,
	DiscoveryStorePort,
	GraphStore,
	OutlineStorePort,
	RelationStorePort,
	WorkStorePort,
} from "./graph_store.ts";
import { SurrealConnection, type SurrealDiagnosticLogger } from "./surreal_connection.ts";
import { SurrealBackupRepository } from "./surreal_backup_repository.ts";
import { SurrealDiscoveryRepository } from "./surreal_discovery_repository.ts";
import { SurrealOutlineRepository } from "./surreal_outline_repository.ts";
import { SurrealRelationRepository } from "./surreal_relation_repository.ts";
import { SurrealRevisionRepository } from "./surreal_revision_repository.ts";
import { SurrealWorkRepository } from "./surreal_work_repository.ts";

export type { SurrealDiagnosticLogger } from "./surreal_connection.ts";
export { duplicateLinkIdsAfterMerge } from "./surreal_relation_operations.ts";

/**
 * Composition root for the SurrealDB storage adapter.
 *
 * Persistence behavior lives in feature repositories; this class only owns
 * their shared connection and exposes the legacy GraphStore facade.
 */
export class SurrealGraphStore implements GraphStore {
	readonly #connection: SurrealConnection;
	readonly #backup: SurrealBackupRepository;
	readonly #outline: SurrealOutlineRepository;
	readonly #work: SurrealWorkRepository;
	readonly #revision: SurrealRevisionRepository;
	readonly #relation: SurrealRelationRepository;
	readonly #discovery: SurrealDiscoveryRepository;

	readonly exportGraphState: BackupStorePort["exportGraphState"];
	readonly restoreGraphState: BackupStorePort["restoreGraphState"];

	readonly listItems: OutlineStorePort["listItems"];
	readonly listOccurrences: OutlineStorePort["listOccurrences"];
	readonly createOccurrence: OutlineStorePort["createOccurrence"];
	readonly updateOccurrence: OutlineStorePort["updateOccurrence"];
	readonly deleteOccurrence: OutlineStorePort["deleteOccurrence"];
	readonly listBookmarks: OutlineStorePort["listBookmarks"];
	readonly createBookmark: OutlineStorePort["createBookmark"];
	readonly deleteBookmark: OutlineStorePort["deleteBookmark"];
	readonly getResumePosition: OutlineStorePort["getResumePosition"];
	readonly setResumePosition: OutlineStorePort["setResumePosition"];
	readonly clearResumePosition: OutlineStorePort["clearResumePosition"];

	readonly listWorks: WorkStorePort["listWorks"];
	readonly listBranches: WorkStorePort["listBranches"];
	readonly listWorkingCopies: WorkStorePort["listWorkingCopies"];
	readonly listRevisions: WorkStorePort["listRevisions"];
	readonly listRecoverySnapshots: WorkStorePort["listRecoverySnapshots"];
	readonly createWorkBundle: WorkStorePort["createWorkBundle"];
	readonly importWorkBundles: WorkStorePort["importWorkBundles"];
	readonly createUnplacedWork: WorkStorePort["createUnplacedWork"];
	readonly resolveWorkStub: WorkStorePort["resolveWorkStub"];
	readonly mergeWorks: WorkStorePort["mergeWorks"];
	readonly createBranch: WorkStorePort["createBranch"];
	readonly updateBranch: WorkStorePort["updateBranch"];
	readonly updateBranchWorkingCopy: WorkStorePort["updateBranchWorkingCopy"];
	readonly updateWorkingCopy: WorkStorePort["updateWorkingCopy"];
	readonly createRevision: WorkStorePort["createRevision"];
	readonly createRecoverySnapshot: WorkStorePort["createRecoverySnapshot"];
	readonly applyRecoverySnapshot: WorkStorePort["applyRecoverySnapshot"];
	readonly restoreRecoverySnapshot: WorkStorePort["restoreRecoverySnapshot"];
	readonly promoteRecoverySnapshot: WorkStorePort["promoteRecoverySnapshot"];
	readonly trashWork: WorkStorePort["trashWork"];
	readonly restoreWork: WorkStorePort["restoreWork"];
	readonly purgeWork: WorkStorePort["purgeWork"];
	readonly listPurgeManifests: WorkStorePort["listPurgeManifests"];

	readonly listLinks: RelationStorePort["listLinks"];
	readonly createLink: RelationStorePort["createLink"];
	readonly deleteLink: RelationStorePort["deleteLink"];
	readonly listSystemRelations: RelationStorePort["listSystemRelations"];
	readonly listKnots: RelationStorePort["listKnots"];
	readonly replaceKnots: RelationStorePort["replaceKnots"];

	readonly suggestItems: DiscoveryStorePort["suggestItems"];
	readonly searchLexical: DiscoveryStorePort["searchLexical"];
	readonly listAliases: DiscoveryStorePort["listAliases"];
	readonly upsertAlias: DiscoveryStorePort["upsertAlias"];
	readonly deleteAlias: DiscoveryStorePort["deleteAlias"];
	readonly getEmergenceFeedback: DiscoveryStorePort["getEmergenceFeedback"];
	readonly setEmergenceFeedback: DiscoveryStorePort["setEmergenceFeedback"];
	readonly listEmergenceSuggestions: DiscoveryStorePort["listEmergenceSuggestions"];
	readonly upsertEmergenceSuggestion: DiscoveryStorePort["upsertEmergenceSuggestion"];
	readonly resolveEmergenceSuggestion: DiscoveryStorePort["resolveEmergenceSuggestion"];
	readonly listSavedRuleQueries: DiscoveryStorePort["listSavedRuleQueries"];
	readonly upsertSavedRuleQuery: DiscoveryStorePort["upsertSavedRuleQuery"];
	readonly deleteSavedRuleQuery: DiscoveryStorePort["deleteSavedRuleQuery"];

	constructor(
		endpoint: string,
		username = "root",
		password = "root",
		diagnosticLogger?: SurrealDiagnosticLogger,
	) {
		this.#connection = new SurrealConnection(
			endpoint,
			username,
			password,
			diagnosticLogger,
		);
		this.#relation = new SurrealRelationRepository(this.#connection);
		this.#revision = new SurrealRevisionRepository(this.#connection);
		this.#discovery = new SurrealDiscoveryRepository(
			this.#connection,
			() => this.#outline.listItems(),
		);
		this.#work = new SurrealWorkRepository(
			this.#connection,
			{
				listBranches: (...args) => this.#revision.listBranches(...args),
				listWorkingCopies: (...args) => this.#revision.listWorkingCopies(...args),
				listOccurrences: (...args) => this.#outline.listOccurrences(...args),
			},
			this.#relation,
			this.#discovery,
		);
		this.#outline = new SurrealOutlineRepository(this.#connection, {
			listWorks: (...args) => this.#work.listWorks(...args),
			listWorkingCopies: (...args) => this.#revision.listWorkingCopies(...args),
			listRevisions: (...args) => this.#revision.listRevisions(...args),
		});
		this.#backup = new SurrealBackupRepository(this.#connection, () => this);

		this.exportGraphState = this.#backup.exportGraphState.bind(this.#backup);
		this.restoreGraphState = this.#backup.restoreGraphState.bind(this.#backup);

		this.listItems = this.#outline.listItems.bind(this.#outline);
		this.listOccurrences = this.#outline.listOccurrences.bind(this.#outline);
		this.createOccurrence = this.#outline.createOccurrence.bind(this.#outline);
		this.updateOccurrence = this.#outline.updateOccurrence.bind(this.#outline);
		this.deleteOccurrence = this.#outline.deleteOccurrence.bind(this.#outline);
		this.listBookmarks = this.#outline.listBookmarks.bind(this.#outline);
		this.createBookmark = this.#outline.createBookmark.bind(this.#outline);
		this.deleteBookmark = this.#outline.deleteBookmark.bind(this.#outline);
		this.getResumePosition = this.#outline.getResumePosition.bind(this.#outline);
		this.setResumePosition = this.#outline.setResumePosition.bind(this.#outline);
		this.clearResumePosition = this.#outline.clearResumePosition.bind(this.#outline);

		this.listWorks = this.#work.listWorks.bind(this.#work);
		this.listBranches = this.#revision.listBranches.bind(this.#revision);
		this.listWorkingCopies = this.#revision.listWorkingCopies.bind(this.#revision);
		this.listRevisions = this.#revision.listRevisions.bind(this.#revision);
		this.listRecoverySnapshots = this.#revision.listRecoverySnapshots.bind(this.#revision);
		this.createWorkBundle = this.#work.createWorkBundle.bind(this.#work);
		this.importWorkBundles = this.#work.importWorkBundles.bind(this.#work);
		this.createUnplacedWork = this.#work.createUnplacedWork.bind(this.#work);
		this.resolveWorkStub = this.#work.resolveWorkStub.bind(this.#work);
		this.mergeWorks = this.#work.mergeWorks.bind(this.#work);
		this.createBranch = this.#revision.createBranch.bind(this.#revision);
		this.updateBranch = this.#revision.updateBranch.bind(this.#revision);
		this.updateBranchWorkingCopy = this.#revision.updateBranchWorkingCopy.bind(this.#revision);
		this.updateWorkingCopy = this.#revision.updateWorkingCopy.bind(this.#revision);
		this.createRevision = this.#revision.createRevision.bind(this.#revision);
		this.createRecoverySnapshot = this.#revision.createRecoverySnapshot.bind(this.#revision);
		this.applyRecoverySnapshot = this.#revision.applyRecoverySnapshot.bind(this.#revision);
		this.restoreRecoverySnapshot = this.#revision.restoreRecoverySnapshot.bind(this.#revision);
		this.promoteRecoverySnapshot = this.#revision.promoteRecoverySnapshot.bind(this.#revision);
		this.trashWork = this.#work.trashWork.bind(this.#work);
		this.restoreWork = this.#work.restoreWork.bind(this.#work);
		this.purgeWork = this.#work.purgeWork.bind(this.#work);
		this.listPurgeManifests = this.#work.listPurgeManifests.bind(this.#work);

		this.listLinks = this.#relation.listLinks.bind(this.#relation);
		this.createLink = this.#relation.createLink.bind(this.#relation);
		this.deleteLink = this.#relation.deleteLink.bind(this.#relation);
		this.listSystemRelations = this.#relation.listSystemRelations.bind(this.#relation);
		this.listKnots = this.#relation.listKnots.bind(this.#relation);
		this.replaceKnots = this.#relation.replaceKnots.bind(this.#relation);

		this.suggestItems = this.#discovery.suggestItems.bind(this.#discovery);
		this.searchLexical = this.#discovery.searchLexical.bind(this.#discovery);
		this.listAliases = this.#discovery.listAliases.bind(this.#discovery);
		this.upsertAlias = this.#discovery.upsertAlias.bind(this.#discovery);
		this.deleteAlias = this.#discovery.deleteAlias.bind(this.#discovery);
		this.getEmergenceFeedback = this.#discovery.getEmergenceFeedback.bind(this.#discovery);
		this.setEmergenceFeedback = this.#discovery.setEmergenceFeedback.bind(this.#discovery);
		this.listEmergenceSuggestions = this.#discovery.listEmergenceSuggestions.bind(
			this.#discovery,
		);
		this.upsertEmergenceSuggestion = this.#discovery.upsertEmergenceSuggestion.bind(
			this.#discovery,
		);
		this.resolveEmergenceSuggestion = this.#discovery.resolveEmergenceSuggestion.bind(
			this.#discovery,
		);
		this.listSavedRuleQueries = this.#discovery.listSavedRuleQueries.bind(this.#discovery);
		this.upsertSavedRuleQuery = this.#discovery.upsertSavedRuleQuery.bind(this.#discovery);
		this.deleteSavedRuleQuery = this.#discovery.deleteSavedRuleQuery.bind(this.#discovery);
	}

	initialize(): Promise<void> {
		return this.#connection.initialize();
	}

	close(): Promise<void> {
		return this.#connection.close();
	}
}
