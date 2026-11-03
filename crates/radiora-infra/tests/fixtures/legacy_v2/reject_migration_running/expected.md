# Expected: reject migration_journal running

## Rejection

- Reject before conversion because migration_journal contains a running import.
- Do not treat an interrupted/active run as a complete legacy source.

## Archive/source safety

- 17 tables: work=0, branch=0, working_copy=0, revision=0, recovery_snapshot=0, occurrence=0,
  semantic_link=0, system_relation=0, knot=0, search_alias=0, emergence_feedback=0,
  emergence_suggestion=0, saved_rule_query=0, purge_manifest=0, bookmark=0, resume_position=0,
  relation_type_definition=8 storage_metadata=1, migration_journal=1, legacy rows total=10
- No destination DB or completed import marker is accepted; the source remains unchanged.
