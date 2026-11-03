use radiora_core::legacy::RECORD_TABLES;
use radiora_infra::legacy::{ImportError, archive_legacy, fingerprint, read_legacy};
use rusqlite::{Connection, params};
use serde_json::Value;
use std::{error::Error, fs, path::Path};

type TestResult = Result<(), Box<dyn Error>>;
const INSTANT: &str = "2026-09-04T12:00:00.000Z";
fn empty_database(path: &Path) -> rusqlite::Result<Connection> {
    let db = Connection::open(path)?;
    // Deliberately omit UNIQUE/JSON constraints so rejection paths are testable.
    for table in RECORD_TABLES {
        db.execute_batch(&format!(
            "CREATE TABLE {table}(id TEXT,position INTEGER,payload TEXT);"
        ))?;
    }
    db.execute_batch(
        "CREATE TABLE storage_metadata(id TEXT,schema_version INTEGER,updated_at TEXT);
        CREATE TABLE migration_journal(id TEXT,from_version INTEGER,to_version INTEGER,
        started_at TEXT,completed_at TEXT,status TEXT,error TEXT);",
    )?;
    db.execute(
        "INSERT INTO storage_metadata VALUES('radiora',2,?1)",
        [INSTANT],
    )?;
    Ok(db)
}
fn insert(
    db: &Connection,
    table: &str,
    id: &str,
    position: i64,
    payload: &str,
) -> rusqlite::Result<()> {
    assert!(RECORD_TABLES.contains(&table));
    db.execute(
        &format!("INSERT INTO {table} VALUES(?1,?2,?3)"),
        params![id, position, payload],
    )?;
    Ok(())
}
#[test]
fn all_17_tables_archive_verbatim_and_marker_is_not_product_completion() -> TestResult {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("legacy.db");
    let db = empty_database(&path)?;
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../radiora-core/tests/fixtures/legacy_payload_cases.json"
    ))?;
    for (index, case) in cases
        .iter()
        .filter(|case| case["name"].as_str().is_some_and(|s| s.ends_with(":valid")))
        .enumerate()
    {
        // Whitespace, escaping, key order and unknown fields must survive archive unchanged.
        let payload = format!(" \n {} \r\n", case["json"].as_str().unwrap());
        insert(
            &db,
            case["table"].as_str().unwrap(),
            case["id"].as_str().unwrap(),
            index as i64,
            &payload,
        )?;
    }
    db.execute(
        "INSERT INTO migration_journal VALUES('m2',1,2,?1,?1,'completed',NULL)",
        [INSTANT],
    )?;
    drop(db);
    let before = fingerprint(&path)?;
    let source = read_legacy(&path)?;
    assert_eq!(source.records.len(), 17);
    let staging = dir.path().join("staging.db");
    let report = archive_legacy(&path, &staging)?;
    assert_eq!(fingerprint(&path)?, before);
    assert_eq!(report.source, before);
    assert_eq!(report.tables.len(), 19);
    let output = Connection::open(&staging)?;
    for row in &source.archive {
        let (position,payload,hash):(Option<i64>,String,String)=output.query_row(
            "SELECT position,payload,row_hash FROM legacy_archive WHERE \"table\"=?1 AND legacy_id=?2",
            params![row.table,row.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        assert_eq!(position, row.position);
        assert_eq!(payload, row.payload);
        assert_eq!(hash.len(), 64);
        assert_eq!(report.tables[&row.table].rows, 1);
    }
    let metadata: Value = serde_json::from_str(&output.query_row::<String, _, _>(
        "SELECT payload FROM legacy_archive WHERE \"table\"='migration_journal'",
        [],
        |r| r.get(0),
    )?)?;
    assert_eq!(metadata["completed_at"], INSTANT);
    assert!(metadata["error"].is_null());
    let (status, completed, version): (String, Option<String>, String) = output.query_row(
        "SELECT status,completed_at_unix_ms,importer_version FROM import_run WHERE id=?1",
        [&report.run_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    assert_eq!(status, "running");
    assert_eq!(completed, None);
    assert_eq!(version, "legacy-archive/1");
    let count: i64 = output.query_row("SELECT count(*) FROM legacy_archive_summary", [], |r| {
        r.get(0)
    })?;
    assert_eq!(count, 19);
    // A rerun uses a fresh destination and has identical source/archive digests.
    let rerun = archive_legacy(&path, &dir.path().join("retry.db"))?;
    assert_ne!(rerun.run_id, report.run_id);
    assert_eq!(rerun.tables, report.tables);
    assert!(archive_legacy(&path, &staging).is_err());
    Ok(())
}
#[test]
fn refusals_leave_no_destination_or_temporary_database() -> TestResult {
    for reason in [
        "schema",
        "running",
        "failed",
        "unknown",
        "json",
        "type",
        "duplicate",
        "missing",
        "columns",
        "identity",
        "position",
    ] {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("legacy.db");
        let db = empty_database(&path)?;
        match reason {
            "schema" => {
                db.execute("UPDATE storage_metadata SET schema_version=3", [])?;
            }
            "running" | "failed" => {
                db.execute(
                    "INSERT INTO migration_journal VALUES('m',1,2,?1,NULL,?2,NULL)",
                    params![INSTANT, reason],
                )?;
            }
            "unknown" => db.execute_batch("CREATE TABLE surprise(data TEXT);")?,
            "json" => insert(&db, "work", "w", 0, "{")?,
            "type" => insert(&db, "work", "w", 0, r#"{"id":"w"}"#)?,
            "duplicate" => {
                insert(&db, "emergence_feedback", "same", 0, r#""pin""#)?;
                insert(&db, "emergence_feedback", "same", 1, r#""accept""#)?;
            }
            "missing" => db.execute_batch("DROP TABLE work;")?,
            "columns" => db.execute_batch("ALTER TABLE work ADD COLUMN unarchived TEXT;")?,
            "identity" => insert(
                &db,
                "working_copy",
                "wrong",
                0,
                &format!(r#"{{"branchId":"b","workId":"w","text":"","updatedAt":"{INSTANT}"}}"#),
            )?,
            "position" => insert(&db, "emergence_feedback", "id", -1, r#""pin""#)?,
            _ => unreachable!(),
        }
        drop(db);
        let before = fingerprint(&path)?;
        let destination = dir.path().join("new.db");
        let error = archive_legacy(&path, &destination).unwrap_err();
        assert!(!destination.exists(), "{reason}: {error}");
        assert_eq!(fingerprint(&path)?, before);
        assert_eq!(
            fs::read_dir(dir.path())?.count(),
            1,
            "{reason}: leaked temp DB"
        );
        if matches!(
            reason,
            "json" | "type" | "duplicate" | "identity" | "position"
        ) {
            assert!(matches!(error, ImportError::Record(_)), "{error}");
        }
    }
    Ok(())
}
#[test]
fn wal_input_is_included_and_existing_files_are_never_overwritten() -> TestResult {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("legacy.db");
    let db = empty_database(&path)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")?;
    insert(&db, "emergence_feedback", "wal-only", 0, r#""pin""#)?;
    let before = fingerprint(&path)?;
    assert!(before.wal.is_some());
    let source = read_legacy(&path)?;
    assert_eq!(source.records.len(), 1);
    let target = dir.path().join("new.db");
    archive_legacy(&path, &target)?;
    assert_eq!(fingerprint(&path)?, before);
    let target_before = fingerprint(&target)?;
    assert!(archive_legacy(&path, &target).is_err());
    assert_eq!(fingerprint(&target)?, target_before);
    assert!(archive_legacy(&path, &path).is_err());
    assert_eq!(fingerprint(&path)?, before);
    Ok(())
}
#[test]
fn shared_i6_valid_fixtures_are_accepted_without_reinterpreting_their_data() -> TestResult {
    for name in [
        "single_work_stub",
        "shared_same_branch",
        "separate_branch_pinned",
        "deleted_missing",
        "unicode_custom_relation",
        "markdown_links",
        "contextual_heading_hidden_branch",
    ] {
        let raw = fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/legacy_v2")
                .join(name)
                .join("database.json"),
        )?;
        let fixture: Value = serde_json::from_str(&raw)?;
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("legacy.db");
        let db = empty_database(&path)?;
        for (table, rows) in fixture["tables"].as_object().unwrap() {
            for row in rows.as_array().unwrap() {
                insert(
                    &db,
                    table,
                    row["id"].as_str().unwrap(),
                    row["position"].as_i64().unwrap(),
                    &serde_json::to_string(&row["payload"])?,
                )?;
            }
        }
        drop(db);
        let source = read_legacy(&path)?;
        assert!(!source.records.is_empty(), "{name}");
        let report = archive_legacy(&path, &dir.path().join("staging.db"))?;
        assert_eq!(report.tables, source.tables, "{name}");
    }
    Ok(())
}
