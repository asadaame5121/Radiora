import { assertEquals, assertThrows } from "jsr:@std/assert";
import { parseStoredRecord, validateStoredPayload } from "../src/storage/sqlite_records.ts";

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
