# Expected: Markdown work/revision links and protected code text

## Document layer

- Blocks: 3; source block, target Work block, and one materialized block for referenced
  `revision-link-target`.
- Normal Markdown work/revision links are rewritten to the corresponding new block IDs with labels
  preserved.
- Inline code and fenced code occurrences of the same `radiora://...` strings remain byte-for-byte
  unchanged.
- Relation: none.

## Relation / Missing

- See the Relation entries above.
- Missing: none.

## Diagnostics

- No unresolved-reference diagnostic is expected because both work and revision targets exist.

## Archive layer

- 17 tables: work=2, branch=2, working_copy=2, revision=1, recovery_snapshot=0, occurrence=2,
  semantic_link=0, system_relation=0, knot=0, search_alias=0, emergence_feedback=0,
  emergence_suggestion=0, saved_rule_query=0, purge_manifest=0, bookmark=0, resume_position=0,
  relation_type_definition=8 storage_metadata=1, migration_journal=0, legacy rows total=18
- Every archive row preserves table, legacy id, position, and payload JSON byte-for-byte.
