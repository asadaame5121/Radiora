# Expected: Unicode, non-UUID IDs, omitted optional fields, and custom relation

## Document layer

- Blocks: 2; references: 0.
- Non-UUID legacy IDs are retained in archive/id-map input and do not cause rejection.
- 本文 keeps Japanese, emoji, combining `e\u0301`, and CRLF exactly.
- The stub and its context remain in `legacy`; omitted optional fields stay absent rather than
  becoming guessed values.
- Relation: one `ILLUSTRATES` relation with its reason preserved.

## Relation / Missing

- See the Relation entries above.
- Missing: none.

## Diagnostics

- No missing or coercion diagnostic is expected for these valid values.
- The custom relation type is copied to the relation-type catalog.

## Archive layer

- 17 tables: work=2, branch=2, working_copy=2, revision=0, recovery_snapshot=0, occurrence=2,
  semantic_link=1, system_relation=0, knot=0, search_alias=1, emergence_feedback=0,
  emergence_suggestion=0, saved_rule_query=0, purge_manifest=0, bookmark=0, resume_position=0,
  relation_type_definition=9 storage_metadata=1, migration_journal=0, legacy rows total=20
- Every archive row preserves table, legacy id, position, and payload JSON byte-for-byte.
