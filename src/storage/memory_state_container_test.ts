import { assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert@1";
import { BUILT_IN_RELATION_TYPES } from "../domain/relation_type.ts";
import type { ResumePosition } from "../domain/models.ts";
import { MemoryStateContainer } from "./memory_state_container.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";

const CREATED_AT = "2026-07-28T00:00:00.000Z";
const ORDER_KEY = 1024;
const CARET_OFFSET = 12;
const MUTATED_WORKS_COUNT = 2;

function sampleSnapshot(): GraphStateSnapshot {
	const workId = crypto.randomUUID();
	const branchId = crypto.randomUUID();
	const occurrenceId = crypto.randomUUID();
	return {
		works: [{ id: workId, createdAt: CREATED_AT, updatedAt: CREATED_AT }],
		branches: [{ id: branchId, workId, name: "main", headRevisionId: null, createdAt: CREATED_AT }],
		workingCopies: [{ branchId, workId, text: "Sample text", updatedAt: CREATED_AT }],
		occurrences: [{
			id: occurrenceId,
			workId,
			parentOccurrenceId: null,
			orderKey: ORDER_KEY,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId },
		}],
		links: [],
		systemRelations: [],
		knots: [],
		aliases: [{
			id: crypto.randomUUID(),
			canonical: "alias",
			variants: ["variant1"],
			createdAt: CREATED_AT,
			updatedAt: CREATED_AT,
		}],
		emergenceFeedback: { [workId]: "pin" },
		emergenceSuggestions: [],
		savedRuleQueries: [],
		purgeManifests: [],
		revisions: [],
		recoverySnapshots: [],
		bookmarks: [{ id: crypto.randomUUID(), workId, occurrenceId, createdAt: CREATED_AT }],
		resumePosition: { workId, occurrenceId, caretOffset: CARET_OFFSET, updatedAt: CREATED_AT },
		relationTypeDefinitions: BUILT_IN_RELATION_TYPES.map((def) => ({ ...def })),
	};
}

Deno.test("MemoryStateContainer initializes with default values and built-in relation types", () => {
	const container = new MemoryStateContainer();
	assertEquals(container.works, []);
	assertEquals(container.branches, []);
	assertEquals(container.workingCopies, []);
	assertEquals(container.occurrences, []);
	assertEquals(container.links, []);
	assertEquals(container.systemRelations, []);
	assertEquals(container.knots, []);
	assertEquals(container.aliases, []);
	assertEquals(container.emergenceFeedback, {});
	assertEquals(container.emergenceSuggestions, []);
	assertEquals(container.savedRuleQueries, []);
	assertEquals(container.purgeManifests, []);
	assertEquals(container.revisions, []);
	assertEquals(container.recoverySnapshots, []);
	assertEquals(container.bookmarks, []);
	assertEquals(container.resumePosition, null);
	assertEquals(container.relationTypeDefinitions, BUILT_IN_RELATION_TYPES);
});

Deno.test("MemoryStateContainer exportSnapshot returns an isolated deep clone", () => {
	const container = new MemoryStateContainer();
	const initial = sampleSnapshot();
	container.restoreGraphState(initial);

	const snapshot1 = container.exportGraphState();
	assertEquals(snapshot1.works.length, 1);
	assertEquals(snapshot1.resumePosition?.caretOffset, CARET_OFFSET);
	assertEquals(snapshot1.emergenceFeedback[initial.works[0].id], "pin");

	// Mutating returned snapshot does not affect container
	snapshot1.works[0].id = "mutated-id";
	assertEquals(container.works[0].id, initial.works[0].id);

	// Mutating container does not affect previously exported snapshot
	container.works.push({ id: crypto.randomUUID(), createdAt: CREATED_AT, updatedAt: CREATED_AT });
	assertNotEquals(container.works.length, snapshot1.works.length);
});

Deno.test("MemoryStateContainer capture and rollback preserves full state fidelity", () => {
	const container = new MemoryStateContainer();
	const initial = sampleSnapshot();
	container.restoreGraphState(initial);

	const rollbackToken = container.capture();

	// Mutate state container directly
	container.works.push({ id: crypto.randomUUID(), createdAt: CREATED_AT, updatedAt: CREATED_AT });
	container.emergenceFeedback["new-key"] = "accept";
	container.resumePosition = null;

	assertEquals(container.works.length, MUTATED_WORKS_COUNT);
	assertEquals(container.resumePosition, null);

	// Rollback
	container.rollback(rollbackToken);

	assertEquals(container.works.length, 1);
	assertEquals(container.works[0].id, initial.works[0].id);
	assertEquals(container.emergenceFeedback, { [initial.works[0].id]: "pin" });
	const restoredResume = (container as MemoryStateContainer).resumePosition;
	assertEquals((restoredResume as ResumePosition | null)?.caretOffset, CARET_OFFSET);
});

Deno.test("MemoryStateContainer restore validates snapshot and rejects invalid input atomically", () => {
	const container = new MemoryStateContainer();
	const initial = sampleSnapshot();
	container.restoreGraphState(initial);

	const invalid = { ...sampleSnapshot(), works: "not-an-array" as unknown as [] };
	assertThrows(() => container.restoreGraphState(invalid));

	// Existing state remains intact
	assertEquals(container.works.length, 1);
	assertEquals(container.works[0].id, initial.works[0].id);
});
