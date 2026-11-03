# Expected: single placement, occurrence-less Work, and stub

## Document layer

- Blocks: 3 (`work-single`, `work-orphan`, `work-stub`).
- Representative: each block is its own representative; `work-orphan` becomes a root Topic because
  it has no Occurrence.
- Parent/order: `occ-single` and `occ-stub` are roots ordered by their legacy `orderKey`; the
  occurrence-less root is retained without inventing a parent.
- Stub: `work-stub` is a normal Topic with `legacy.stub`; it is not discarded.
- Relation: none.

## Relation / Missing

- See the Relation entries above.
- Missing: none.

## Diagnostics

- No conversion diagnostic is expected for the valid single-placement/orphan/stub records.

## Archive layer

- 17 tables: work=3, branch=3, working_copy=3, revision=0, recovery_snapshot=0, occurrence=2,
  semantic_link=0, system_relation=0, knot=0, search_alias=0, emergence_feedback=0,
  emergence_suggestion=0, saved_rule_query=0, purge_manifest=0, bookmark=0, resume_position=0,
  relation_type_definition=8 storage_metadata=1, migration_journal=0, legacy rows total=20
- Every archive row preserves table, legacy id, position, and payload JSON byte-for-byte.
