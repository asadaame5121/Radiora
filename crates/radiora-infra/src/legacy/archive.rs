use super::source::{digests, row_hash};
use super::{ArchiveRow, ImportError, Result, SourceFingerprint, TableDigest, read_legacy};
use rusqlite::{Connection, params};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const IMPORTER_VERSION: &str = "legacy-archive/1";
#[derive(Debug)]
pub struct ArchiveReport {
    pub run_id: String,
    pub staging_path: PathBuf,
    pub source: SourceFingerprint,
    pub tables: BTreeMap<String, TableDigest>,
}
pub fn archive_legacy(source: &Path, staging_path: &Path) -> Result<ArchiveReport> {
    if staging_path.exists() {
        return Err(ImportError::Rejected("staging path already exists".into()));
    }
    // All refusal conditions run before even creating a temporary output.
    let source = read_legacy(source)?;
    let parent = staging_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let temporary = tempfile::NamedTempFile::new_in(parent)?;
    let run_id = Uuid::now_v7().to_string();
    {
        let mut db = Connection::open(temporary.path())?;
        db.execute_batch(
            "PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA;
             CREATE TABLE import_run (
               id TEXT PRIMARY KEY, source_path TEXT NOT NULL, source_size INTEGER NOT NULL,
               source_mtime_unix_ns TEXT NOT NULL, source_sha256 TEXT NOT NULL,
               source_wal_sha256 TEXT, schema_version INTEGER NOT NULL, importer_version TEXT NOT NULL,
               started_at_unix_ms TEXT NOT NULL, completed_at_unix_ms TEXT,
               status TEXT NOT NULL CHECK(status IN ('running','completed','failed'))
             ) STRICT;
             CREATE TABLE legacy_archive (
               \"table\" TEXT NOT NULL, legacy_id TEXT NOT NULL, position INTEGER,
               payload TEXT NOT NULL, row_hash TEXT NOT NULL,
               PRIMARY KEY(\"table\",legacy_id)
             ) STRICT;
             CREATE TABLE legacy_archive_summary (
               \"table\" TEXT PRIMARY KEY, row_count INTEGER NOT NULL,
               payload_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL
             ) STRICT;"
        )?;
        let tx = db.transaction()?;
        let mtime = match source
            .fingerprint
            .database
            .modified
            .duration_since(UNIX_EPOCH)
        {
            Ok(duration) => duration.as_nanos().to_string(),
            Err(before) => format!("-{}", before.duration().as_nanos()),
        };
        tx.execute(
            "INSERT INTO import_run VALUES(?1,?2,?3,?4,?5,?6,2,?7,?8,NULL,'running')",
            params![
                run_id,
                source
                    .path
                    .to_str()
                    .ok_or_else(|| ImportError::Rejected("source path is not UTF-8".into()))?,
                source.fingerprint.database.size,
                mtime,
                source.fingerprint.database.sha256,
                source.fingerprint.wal.as_ref().map(|wal| &wal.sha256),
                IMPORTER_VERSION,
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)?
                    .as_millis()
                    .to_string()
            ],
        )?;
        for row in &source.archive {
            tx.execute(
                "INSERT INTO legacy_archive VALUES(?1,?2,?3,?4,?5)",
                params![row.table, row.id, row.position, row.payload, row_hash(row)],
            )?;
        }
        let actual = verify_archive(&tx, &source.archive)?;
        if actual != source.tables {
            return Err(ImportError::Rejected(
                "archive table digest mismatch".into(),
            ));
        }
        for (table, digest) in &actual {
            tx.execute(
                "INSERT INTO legacy_archive_summary VALUES(?1,?2,?3,?4)",
                params![table, digest.rows, digest.payload_bytes, digest.sha256],
            )?;
        }
        super::source::ensure_unchanged(&source.path, &source.fingerprint)?;
        tx.commit()?;
        db.close().map_err(|(_, cause)| cause)?;
    }
    super::source::ensure_unchanged(&source.path, &source.fingerprint)?;
    // I4/I5 must populate/verify the document layer and publish before marking completed.
    temporary.as_file().sync_all()?;
    temporary
        .persist_noclobber(staging_path)
        .map_err(|cause| cause.error)?;
    Ok(ArchiveReport {
        run_id,
        staging_path: staging_path.into(),
        source: source.fingerprint,
        tables: source.tables,
    })
}
fn verify_archive(
    db: &Connection,
    expected: &[ArchiveRow],
) -> Result<BTreeMap<String, TableDigest>> {
    let mut query = db.prepare("SELECT \"table\",legacy_id,position,payload,row_hash FROM legacy_archive ORDER BY \"table\",legacy_id")?;
    let rows = query.query_map([], |r| {
        Ok((
            ArchiveRow {
                table: r.get(0)?,
                id: r.get(1)?,
                position: r.get(2)?,
                payload: r.get(3)?,
            },
            r.get::<_, String>(4)?,
        ))
    })?;
    let mut actual = Vec::new();
    for row in rows {
        let (row, saved_hash) = row?;
        if row_hash(&row) != saved_hash {
            return Err(ImportError::Rejected("archive row hash mismatch".into()));
        }
        actual.push(row);
    }
    let mut ordered = expected.to_vec();
    ordered.sort_by(|a, b| (&a.table, &a.id).cmp(&(&b.table, &b.id)));
    if actual != ordered {
        return Err(ImportError::Rejected(
            "archive verbatim comparison failed".into(),
        ));
    }
    Ok(digests(&actual))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_verification_rejects_tampered_hash_payload_and_missing_rows() -> Result<()> {
        for change in ["hash", "payload", "missing"] {
            let db = Connection::open_in_memory()?;
            db.execute_batch("CREATE TABLE legacy_archive(\"table\" TEXT,legacy_id TEXT,position INTEGER,payload TEXT,row_hash TEXT);")?;
            let row = ArchiveRow {
                table: "emergence_feedback".into(),
                id: "f".into(),
                position: Some(0),
                payload: "\"pin\"".into(),
            };
            db.execute(
                "INSERT INTO legacy_archive VALUES(?1,?2,?3,?4,?5)",
                params![row.table, row.id, row.position, row.payload, row_hash(&row)],
            )?;
            verify_archive(&db, std::slice::from_ref(&row))?;
            match change {
                "hash" => {
                    db.execute("UPDATE legacy_archive SET row_hash='wrong'", [])?;
                }
                "payload" => {
                    db.execute("UPDATE legacy_archive SET payload='different'", [])?;
                }
                _ => {
                    db.execute("DELETE FROM legacy_archive", [])?;
                }
            }
            assert!(verify_archive(&db, &[row]).is_err());
        }
        Ok(())
    }
}
