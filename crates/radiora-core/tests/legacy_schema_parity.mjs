// Run with the project's Node >=22 strip-types support from the repository root.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStoredRecord } from "../../../src/storage/sqlite_records.ts";
const cases = JSON.parse(readFileSync(new URL("./fixtures/legacy_payload_cases.json", import.meta.url)));
for (const test of cases) {
  let accepted = true;
  try { parseStoredRecord(test.table, { id: test.id, payload: test.json }, 0); }
  catch { accepted = false; }
  assert.equal(accepted, test.accept, test.name);
}
console.log(`v2 TypeScript schema corpus: ${cases.length} cases PASS`);
// Known JSON decoder gap: TS strings can contain isolated UTF-16 surrogates.
parseStoredRecord("working_copy", { id: "b", payload: JSON.stringify({
  branchId: "b", workId: "w", text: String.fromCharCode(0xd800),
  updatedAt: "2026-01-01T00:00:00.000Z"
}) }, 0);
console.log("Known gap: TS accepts isolated UTF-16 surrogate; Rust rejects without replacement");
