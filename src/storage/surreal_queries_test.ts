import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
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

Deno.test("Surreal query builders preserve endpoint and recovery variable branches", () => {
	assertEquals(evolvedFromEndpoints("parent", "child"), { inId: "parent", outId: "child" });
	const restore = recoveryRestoreTransactionQuery(true, false);
	assert(restore.startsWith("BEGIN TRANSACTION;"));
	assert(restore.includes("source_revision: $sourceRevision"));
	assert(restore.includes("name: NONE"));
	assert(restore.endsWith("COMMIT TRANSACTION;"));
	const promotion = recoveryPromotionTransactionQuery(false);
	assert(promotion.includes("message: NONE"));
	assert(promotion.includes("UPDATE $branch SET head_revision = $revision;"));
});

Deno.test("Surreal query builders preserve capture and merge statement ordering", () => {
	const capture = quickCaptureTransactionQuery(true, false);
	assert(capture.includes("context: NONE"));
	assert(capture.indexOf("CREATE $work") < capture.indexOf("CREATE $branch"));
	assert(capture.indexOf("CREATE $branch") < capture.indexOf("CREATE $copy"));
	const merge = mergeWorksTransactionQuery(true);
	assert(merge.indexOf("UPDATE branch") < merge.indexOf("UPDATE semantic_link"));
	assert(merge.indexOf("UPDATE semantic_link") < merge.indexOf("UPSERT $alias"));
	assertFalse(mergeWorksTransactionQuery(false).includes("UPSERT $alias"));
});

Deno.test("Surreal outline import encloses every Work bundle in one transaction", () => {
	const query = importWorkBundlesTransactionQuery([
		{ hasParent: false, hasContextualHeading: false },
		{ hasParent: true, hasContextualHeading: true },
	]);
	assert(query.startsWith("BEGIN TRANSACTION;"));
	assert(query.endsWith("COMMIT TRANSACTION;"));
	assertEquals(query.match(/BEGIN TRANSACTION;/g)?.length, 1);
	assertEquals(query.match(/COMMIT TRANSACTION;/g)?.length, 1);
	assert(query.indexOf("CREATE $work0") < query.indexOf("CREATE $occurrence0"));
	assert(query.indexOf("CREATE $occurrence0") < query.indexOf("CREATE $work1"));
	assert(query.includes("parent_occurrence: $parent1"));
	assert(query.includes("contextual_heading: $contextualHeading1"));
});

Deno.test("Surreal query builders preserve suggestion-link symmetry guard and variable branches", () => {
	const symmetric = emergenceAcceptanceTransactionQuery(false, true, true);
	assert(symmetric.includes("context_work = $toWork AND target_work = $fromWork"));
	assert(symmetric.includes("from_work = $toWork AND to_work = $fromWork"));
	assert(symmetric.includes("reason: NONE"));
	assert(symmetric.includes("resolution_reason: $resolutionReason"));
	assert(symmetric.includes('status != "retracted" AND origin = "suggestion"'));
	assert(emergenceSuggestionUpsertQuery(false).includes("proposed_link_type: NONE"));
	assert(emergenceSuggestionUpsertQuery(true).includes("proposed_link_type: $proposedLinkType"));
	assert(resumePositionUpsertQuery().includes("resume_position:current"));
	assertEquals(
		navigationPurgeStatements(),
		"DELETE bookmark WHERE work = $work;\n\t\t\tDELETE resume_position WHERE work = $work;",
	);
});
