# Expected: separate Branch groups and pinned Revision

## Document layer

- Blocks: 4 (`work-link-source`, `occ-branch-a`, `occ-branch-b`, and `occ-pinned`).
- Representatives: `occ-branch-a`, `occ-branch-b`, and `occ-pinned` each own a separate group/block;
  `work-link-source` is an occurrence-less root Topic.
- No merge: different Branch selectors and the pinned Revision are never combined into one current
  text.
- Primary: `branch-a` is the deterministic primary candidate: unarchived first, then newer
  `promotedAt` (absent last), earlier `createdAt`, and finally Branch id; `branch-a` wins the final
  tie and resolves to `occ-branch-a`.
- Relation: 1; the Work-unit link resolves to the primary group's representative `occ-branch-a`.

## Relation / Missing

- Relation: one asserted `RELATED` link from `work-link-source` to the primary representative
  `occ-branch-a`.
- Missing: none.

## Diagnostics

- `ambiguous-primary` is emitted exactly once for the Work-unit reference to a Work with multiple
  groups.
- No data-loss diagnostic is emitted for the pinned Revision.

## Archive layer

- 17 tables: work=2, branch=2, working_copy=2, revision=1, recovery_snapshot=0, occurrence=3,
  semantic_link=1, system_relation=0, knot=0, search_alias=0, emergence_feedback=0,
  emergence_suggestion=0, saved_rule_query=0, purge_manifest=0, bookmark=0, resume_position=0,
  relation_type_definition=8 storage_metadata=1, migration_journal=0, legacy rows total=20
- Every archive row preserves table, legacy id, position, and payload JSON byte-for-byte.
