# Expected: contextualHeading and unselected Branch

## Document layer

- Blocks: 3; references: 1.
- Single-placement `occ-single-heading` keeps `単一配置見出し` only in legacy metadata; it is not
  promoted to the block title or aliases.
- The shared representative keeps its heading only as legacy metadata; `occ-shared-heading-ref`
  writes `参照配置見出し` to the reference item's `heading`.
- The visible Branch of `work-hidden-branch` is represented; `branch-hidden-unselected` has no
  document block.
- Relation: none.

## Relation / Missing

- See the Relation entries above.
- Missing: none.

## Diagnostics

- Two `contextual-heading-discarded` diagnostics are emitted for the single-placement and
  shared-representative headings; only the reference occurrence receives a document-layer heading.
- One `unselected-branch-archived` diagnostic is emitted; the hidden Branch working copy stays
  archive-only.

## Archive layer

- 17 tables: work=3, branch=4, working_copy=4, revision=0, recovery_snapshot=0, occurrence=4,
  semantic_link=0, system_relation=0, knot=0, search_alias=0, emergence_feedback=0,
  emergence_suggestion=0, saved_rule_query=0, purge_manifest=0, bookmark=0, resume_position=0,
  relation_type_definition=8 storage_metadata=1, migration_journal=0, legacy rows total=24
- Every archive row preserves table, legacy id, position, and payload JSON byte-for-byte.
