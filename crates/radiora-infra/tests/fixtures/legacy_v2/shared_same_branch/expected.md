# Expected: same Work and same Branch shared group

## Document layer

- Blocks: 3; references: 1.
- Representative: `occ-shared-representative` owns the Work text; `occ-shared-reference` is a
  reference item targeting that block.
- Parent/order: both shared placements are roots ordered 1024 then 2048; `occ-child-representative`
  remains under the representative and `occ-child-reference` remains under the reference.
- Independent child structure: the two child Work IDs remain distinct blocks, proving
  placement-local children are not collapsed.
- Relation: none.

## Relation / Missing

- See the Relation entries above.
- Missing: none.

## Diagnostics

- The reference occurrence keeps `contextualHeading` as its reference heading.

## Archive layer

- 17 tables: work=3, branch=3, working_copy=3, revision=0, recovery_snapshot=0, occurrence=4,
  semantic_link=0, system_relation=0, knot=0, search_alias=0, emergence_feedback=0,
  emergence_suggestion=0, saved_rule_query=0, purge_manifest=0, bookmark=0, resume_position=0,
  relation_type_definition=8 storage_metadata=1, migration_journal=0, legacy rows total=22
- Every archive row preserves table, legacy id, position, and payload JSON byte-for-byte.
