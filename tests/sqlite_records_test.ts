import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
	calculateSqliteDiff,
	parseStoredRecord,
	validateStoredPayload,
} from "../src/storage/sqlite_records.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";

const VALID_UUID = "12345678-1234-4234-8234-1234567890ab";
const VALID_UUID_2 = "87654321-4321-4321-9321-ba0987654321";
const ISO_NOW = "2026-09-04T12:00:00.000Z";

Deno.test("validateStoredPayload accepts valid records across tables", () => {
	const validWork = { id: VALID_UUID, createdAt: ISO_NOW, updatedAt: ISO_NOW };
	validateStoredPayload("work", validWork);

	const validBranch = {
		id: VALID_UUID,
		workId: VALID_UUID_2,
		name: "main",
		headRevisionId: null,
		createdAt: ISO_NOW,
	};
	validateStoredPayload("branch", validBranch);

	const validCopy = {
		branchId: VALID_UUID,
		workId: VALID_UUID_2,
		text: "content",
		updatedAt: ISO_NOW,
	};
	validateStoredPayload("working_copy", validCopy);

	const validOccurrence = {
		id: VALID_UUID,
		workId: VALID_UUID_2,
		parentOccurrenceId: null,
		orderKey: 10,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: VALID_UUID },
	};
	validateStoredPayload("occurrence", validOccurrence);

	const validLink = {
		id: VALID_UUID,
		fromId: VALID_UUID,
		toId: VALID_UUID_2,
		from: { scope: "work", workId: VALID_UUID },
		to: { scope: "work", workId: VALID_UUID_2 },
		type: "RELATED",
		status: "asserted",
		origin: "human",
		createdAt: ISO_NOW,
	};
	validateStoredPayload("semantic_link", validLink);
});

Deno.test("validateStoredPayload rejects invalid record payloads with descriptive error", () => {
	// Invalid work (missing createdAt)
	assertThrows(
		() => validateStoredPayload("work", { id: VALID_UUID }),
		Error,
		"Invalid SQLite work payload",
	);

	// Invalid branch (name is not string)
	assertThrows(
		() =>
			validateStoredPayload("branch", {
				id: VALID_UUID,
				workId: VALID_UUID_2,
				name: 123,
				headRevisionId: null,
				createdAt: ISO_NOW,
			}),
		Error,
		"Invalid SQLite branch payload",
	);

	// Invalid revision (invalid kind)
	assertThrows(
		() =>
			validateStoredPayload("revision", {
				id: VALID_UUID,
				workId: VALID_UUID_2,
				text: "rev",
				parentRevisionIds: [],
				kind: "invalid-kind",
				createdAt: ISO_NOW,
			}),
		Error,
		"Invalid SQLite revision payload",
	);

	// Invalid bookmark (missing occurrenceId)
	assertThrows(
		() =>
			validateStoredPayload("bookmark", {
				id: VALID_UUID,
				workId: VALID_UUID_2,
				createdAt: ISO_NOW,
			}),
		Error,
		"Invalid SQLite bookmark payload",
	);
});

Deno.test("parseStoredRecord validates payload structure and rejects invalid payload", () => {
	const validRow = {
		id: VALID_UUID,
		payload: JSON.stringify({
			id: VALID_UUID,
			createdAt: ISO_NOW,
			updatedAt: ISO_NOW,
		}),
	};
	const parsed = parseStoredRecord("work", validRow, 0);
	assertEquals(parsed.id, VALID_UUID);

	const invalidRow = {
		id: VALID_UUID,
		payload: JSON.stringify({
			id: VALID_UUID,
			createdAt: "not-a-date",
			updatedAt: ISO_NOW,
		}),
	};
	assertThrows(
		() => parseStoredRecord("work", invalidRow, 0),
		Error,
		"Invalid SQLite work payload",
	);
});

function emptySnapshot(): GraphStateSnapshot {
	return {
		works: [],
		branches: [],
		workingCopies: [],
		occurrences: [],
		links: [],
		systemRelations: [],
		knots: [],
		aliases: [],
		emergenceFeedback: {},
		emergenceSuggestions: [],
		savedRuleQueries: [],
		purgeManifests: [],
		revisions: [],
		recoverySnapshots: [],
		bookmarks: [],
		resumePosition: null,
	};
}

Deno.test("calculateSqliteDiff accurately calculates emergence_feedback adds, updates, reorders and deletes", () => {
	const before = emptySnapshot();
	before.emergenceFeedback = {
		fb1: "accept",
		fb2: "dismiss",
		fb3: "pin",
	};

	const after = emptySnapshot();
	after.emergenceFeedback = {
		fb3: "pin", // reordered to pos 0
		fb2: "accept", // modified action
		fb4: "dismiss", // newly added
		// fb1 deleted
	};

	const diff = calculateSqliteDiff(before, after);
	const feedbackUpserts = diff.upserts.filter((u) => u.table === "emergence_feedback");
	const feedbackDeletes = diff.deletes.filter((d) => d.table === "emergence_feedback");

	assertEquals(feedbackDeletes, [{ table: "emergence_feedback", id: "fb1" }]);
	assertEquals(feedbackUpserts, [
		{ table: "emergence_feedback", id: "fb3", position: 0, payload: "pin" },
		{ table: "emergence_feedback", id: "fb2", position: 1, payload: "accept" },
		{ table: "emergence_feedback", id: "fb4", position: 2, payload: "dismiss" },
	]);
});
