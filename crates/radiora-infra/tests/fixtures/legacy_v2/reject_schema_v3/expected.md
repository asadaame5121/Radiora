# Expected: reject schema_version 3

## Rejection

- Reject before opening/writing the destination because storage_metadata.schema_version is 3, not 2.
- No destination DB, import_run.completed marker, document, or partial archive is accepted.

## Archive/source safety

- 17 tables: work=0, branch=0, working_copy=0, revision=0, recovery_snapshot=0, occurrence=0,
  semantic_link=0, system_relation=0, knot=0, search_alias=0, emergence_feedback=0,
  emergence_suggestion=0, saved_rule_query=0, purge_manifest=0, bookmark=0, resume_position=0,
  relation_type_definition=8 storage_metadata=1, migration_journal=0, legacy rows total=9
- The source fixture remains unchanged.
