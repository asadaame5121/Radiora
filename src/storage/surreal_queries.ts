export function evolvedFromEndpoints(
	parentId: string,
	childId: string,
): { inId: string; outId: string } {
	return { inId: parentId, outId: childId };
}

export function recoveryRestoreTransactionQuery(
	hasSourceRevision: boolean,
	hasName: boolean,
): string {
	return `BEGIN TRANSACTION;
			CREATE $beforeRestore CONTENT {
				work: $work, branch: $branch, text: $beforeText, content_hash: $contentHash,
				created_at: $createdAt,
				source_revision: ${hasSourceRevision ? "$sourceRevision" : "NONE"},
				name: ${hasName ? "$name" : "NONE"},
				protection_reason: NONE, protected_at: NONE, protection_expires_at: NONE
			};
			UPDATE working_copy SET text = $targetText, updated_at = $updatedAt
				WHERE branch = $branch;
			UPDATE $work SET updated_at = $updatedAt;
			COMMIT TRANSACTION;`;
}

export function recoveryPromotionTransactionQuery(hasMessage: boolean): string {
	return `BEGIN TRANSACTION;
			CREATE $revision CONTENT {
				work: $work, text: $text, parent_revisions: $parents, kind: $kind,
				created_at: $createdAt, message: ${hasMessage ? "$message" : "NONE"}
			};
			UPDATE $branch SET head_revision = $revision;
			UPDATE $snapshot SET protection_reason = "revision-source",
				protected_at = $protectedAt, protection_expires_at = NONE;
			COMMIT TRANSACTION;`;
}

export function quickCaptureTransactionQuery(hasStub = false, hasStubContext = false): string {
	return `BEGIN TRANSACTION;
			CREATE $work CONTENT {
				created_at: $createdAt, updated_at: $updatedAt, deleted_at: NONE${
		hasStub
			? `,
				stub: {
					created_at: $stubCreatedAt, created_via: $stubCreatedVia,
					context: ${hasStubContext ? "$stubContext" : "NONE"}
				}`
			: ""
	}
			};
			CREATE $branch CONTENT {
				work: $work, name: "main", head_revision: NONE,
				created_at: $createdAt, promoted_at: NONE, archived_at: NONE
			};
			CREATE $copy CONTENT {
				work: $work, branch: $branch, text: $text, updated_at: $updatedAt
			};
			COMMIT TRANSACTION;`;
}

export function importWorkBundlesTransactionQuery(
	bundles: readonly { hasParent: boolean; hasContextualHeading: boolean }[],
): string {
	const statements = bundles.map((bundle, index) => {
		const parent = bundle.hasParent ? `$parent${index}` : "NONE";
		const heading = bundle.hasContextualHeading ? `$contextualHeading${index}` : "NONE";
		return `CREATE $work${index} CONTENT {
				created_at: $createdAt${index}, updated_at: $updatedAt${index}, deleted_at: NONE
			};
			CREATE $branch${index} CONTENT {
				work: $work${index}, name: "main", head_revision: NONE,
				created_at: $createdAt${index}, promoted_at: NONE, archived_at: NONE
			};
			CREATE $copy${index} CONTENT {
				work: $work${index}, branch: $branch${index}, text: $text${index},
				updated_at: $updatedAt${index}
			};
			CREATE $occurrence${index} CONTENT {
				work: $work${index}, parent_occurrence: ${parent}, order_key: $orderKey${index},
				collapsed: false, selector_mode: "branch", branch: $branch${index},
				revision: NONE, contextual_heading: ${heading}
			};`;
	}).join("\n");
	return `BEGIN TRANSACTION;
			${statements}
			COMMIT TRANSACTION;`;
}

export function mergeWorksTransactionQuery(includeAlias = true): string {
	return `BEGIN TRANSACTION;
			UPDATE branch SET name = string::concat("merged/", record::id(work), "/", name)
				WHERE work = $source;
			UPDATE branch SET work = $survivor WHERE work = $source;
			UPDATE working_copy SET work = $survivor WHERE work = $source;
			UPDATE revision SET work = $survivor WHERE work = $source;
			UPDATE recovery_snapshot SET work = $survivor WHERE work = $source;
			UPDATE occurrence SET work = $survivor WHERE work = $source;
			UPDATE bookmark SET work = $survivor WHERE work = $source;
			UPDATE resume_position SET work = $survivor WHERE work = $source;
			UPDATE semantic_link SET from_work = $survivor WHERE from_work = $source;
			UPDATE semantic_link SET to_work = $survivor WHERE to_work = $source;
			UPDATE semantic_link SET status = $retracted WHERE id IN $duplicateLinks;
			UPDATE system_relation SET from_work = $survivor WHERE from_work = $source;
			UPDATE system_relation SET to_work = $survivor WHERE to_work = $source;
			${
		includeAlias
			? `UPSERT $alias CONTENT {
				canonical: $canonical, variants: $variants,
				created_at: $aliasCreatedAt, updated_at: $aliasUpdatedAt
			};`
			: ""
	}
			UPDATE $source SET merged_into_work = $survivor, merged_at = $mergedAt;
			UPDATE $survivor SET updated_at = $mergedAt;
			COMMIT TRANSACTION;`;
}

export function emergenceAcceptanceTransactionQuery(
	hasReason = true,
	symmetric = false,
	hasResolutionReason = false,
): string {
	const reverseSuggestion = symmetric
		? ` OR (context_work = $toWork AND target_work = $fromWork)`
		: "";
	const reverseLink = symmetric ? ` OR (from_work = $toWork AND to_work = $fromWork)` : "";
	return `BEGIN TRANSACTION;
			IF (SELECT VALUE count() FROM $suggestion
				WHERE status IN ["pending", "held"]
				AND proposed_link_type = $type
				AND ((context_work = $fromWork AND target_work = $toWork)${reverseSuggestion})) = 1 {
				IF (SELECT VALUE count() FROM semantic_link
					WHERE status != "retracted" AND origin = "suggestion"
						AND from_scope = "work" AND to_scope = "work" AND type = $type
						AND ((from_work = $fromWork AND to_work = $toWork)${reverseLink})) = 0 {
					CREATE $link CONTENT {
						from_scope: "work", from_work: $fromWork, from_revision: NONE,
						to_scope: "work", to_work: $toWork, to_revision: NONE,
						type: $type, status: "asserted", origin: "suggestion",
						reason: ${hasReason ? "$reason" : "NONE"}, created_at: $createdAt
					};
				};
				UPDATE $suggestion SET status = "accepted", updated_at = $updatedAt,
					resolved_at = $updatedAt,
					resolution_reason: ${hasResolutionReason ? "$resolutionReason" : "NONE"};
			};
			COMMIT TRANSACTION;`;
}

export function emergenceSuggestionUpsertQuery(hasProposedLinkType: boolean): string {
	return `UPSERT $record MERGE {
				kind: $kind, context_work: $contextWork, target_work: $targetWork,
				context_occurrence_id: $contextItemId, target_occurrence_id: $targetItemId,
				proposed_link_type: ${hasProposedLinkType ? "$proposedLinkType" : "NONE"},
				title: $title, explanation: $explanation, evidence: $evidence, score: $score,
				updated_at: $updatedAt
			};
			UPDATE $record SET status = $pending, created_at = $createdAt
				WHERE status IS NONE;`;
}

export function resumePositionUpsertQuery(): string {
	return `UPSERT resume_position:current CONTENT {
				work: $work, occurrence: $occurrence,
				caret_offset: $caretOffset, updated_at: $updatedAt
			};`;
}

export function navigationPurgeStatements(): string {
	return `DELETE bookmark WHERE work = $work;
			DELETE resume_position WHERE work = $work;`;
}
