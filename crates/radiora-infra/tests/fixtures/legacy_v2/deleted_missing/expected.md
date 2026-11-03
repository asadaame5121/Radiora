# Expected: deleted Work, purge manifest, and unresolved link

## Document layer

- Blocks: 2; the deleted Work is one Q1 trash item and the live Work remains a normal block.
- Representative: `occ-deleted` is the representative of the deleted Work's trash item; no alternate
  deleted group is invented.
- Relation: `link-live-deleted` is retained to the deleted/trash target; `link-live-missing` retains
  a Missing target for `work-does-not-exist`.
- Missing: purge manifest IDs are recorded in `deletedIds`; no body is reconstructed for
  `work-purged-no-row`.

## Relation / Missing

- See the Relation entries above.
- Missing endpoints are retained symbolically and never reassigned.

## Diagnostics

- `unresolved-reference` is emitted for `link-live-missing`.
- Q1 deleted Work is reported as `旧版の削除` rather than silently omitted.

## Archive layer

- 17 tables: work=2, branch=2, working_copy=2, revision=0, recovery_snapshot=0, occurrence=2,
  semantic_link=2, system_relation=0, knot=0, search_alias=0, emergence_feedback=0,
  emergence_suggestion=0, saved_rule_query=0, purge_manifest=1, bookmark=1, resume_position=0,
  relation_type_definition=8 storage_metadata=1, migration_journal=0, legacy rows total=21
- Every archive row preserves table, legacy id, position, and payload JSON byte-for-byte.
