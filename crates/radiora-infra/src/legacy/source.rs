use super::{ImportError, Result};
use radiora_core::legacy::{Payload, RECORD_TABLES, RecordError, validate_record};
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFingerprint {
    pub size: u64,
    pub modified: SystemTime,
    pub sha256: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFingerprint {
    pub database: FileFingerprint,
    // Committed input may still reside in WAL; the main file hash alone is insufficient.
    pub wal: Option<FileFingerprint>,
}
#[derive(Debug, Clone)]
pub struct LegacyRecord {
    pub table: String,
    pub id: String,
    pub position: i64,
    pub payload: String,
    pub value: Payload,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveRow {
    pub table: String,
    pub id: String,
    pub position: Option<i64>,
    pub payload: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableDigest {
    pub rows: u64,
    pub payload_bytes: u64,
    pub sha256: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quarantined {
    pub table: String,
    pub id: String,
    pub position: i64,
    pub reason: String,
}
#[derive(Debug)]
pub struct LegacySource {
    pub path: PathBuf,
    pub fingerprint: SourceFingerprint,
    pub records: Vec<LegacyRecord>,
    pub quarantined: Vec<Quarantined>,
    pub archive: Vec<ArchiveRow>,
    pub tables: BTreeMap<String, TableDigest>,
}

fn file_fingerprint(path: &Path) -> Result<FileFingerprint> {
    let mut file = File::open(path)?;
    let before = file.metadata()?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 32 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    let after = file.metadata()?;
    if before.len() != after.len() || before.modified()? != after.modified()? {
        return Err(ImportError::SourceChanged);
    }
    Ok(FileFingerprint {
        size: after.len(),
        modified: after.modified()?,
        sha256: hex(&hash.finalize()),
    })
}
pub fn fingerprint(path: &Path) -> Result<SourceFingerprint> {
    let mut wal_path = path.as_os_str().to_os_string();
    wal_path.push("-wal");
    let wal = match fs::metadata(&wal_path) {
        Ok(meta) if meta.len() > 0 => Some(file_fingerprint(Path::new(&wal_path))?),
        Ok(_) => None,
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => None,
        Err(cause) => return Err(cause.into()),
    };
    Ok(SourceFingerprint {
        database: file_fingerprint(path)?,
        wal,
    })
}
pub(super) fn row_hash(row: &ArchiveRow) -> String {
    let mut hash = Sha256::new();
    for bytes in [
        row.table.as_bytes(),
        row.id.as_bytes(),
        row.payload.as_bytes(),
    ] {
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    match row.position {
        Some(position) => {
            hash.update([1]);
            hash.update(position.to_le_bytes());
        }
        None => hash.update([0]),
    }
    hex(&hash.finalize())
}
pub(super) fn digests(rows: &[ArchiveRow]) -> BTreeMap<String, TableDigest> {
    let mut result = BTreeMap::new();
    // Include empty tables and deterministic ID ordering.
    for table in RECORD_TABLES
        .into_iter()
        .chain(["storage_metadata", "migration_journal"])
    {
        let mut selected: Vec<_> = rows.iter().filter(|row| row.table == table).collect();
        selected.sort_by(|a, b| a.id.cmp(&b.id));
        let mut hash = Sha256::new();
        let mut bytes = 0;
        for row in &selected {
            hash.update(row_hash(row).as_bytes());
            bytes += row.payload.len() as u64;
        }
        result.insert(
            table.into(),
            TableDigest {
                rows: selected.len() as u64,
                payload_bytes: bytes,
                sha256: hex(&hash.finalize()),
            },
        );
    }
    result
}
pub fn read_legacy(path: &Path) -> Result<LegacySource> {
    let path = fs::canonicalize(path)?;
    let before = fingerprint(&path)?;
    let result = read_database(&path);
    // Check even when schema/payload validation failed.
    ensure_unchanged(&path, &before)?;
    let (records, archive, quarantined) = result?;
    let tables = digests(&archive);
    Ok(LegacySource {
        path,
        fingerprint: before,
        records,
        quarantined,
        archive,
        tables,
    })
}
fn read_database(path: &Path) -> Result<(Vec<LegacyRecord>, Vec<ArchiveRow>, Vec<Quarantined>)> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch("PRAGMA query_only=ON; BEGIN;")?;
    let mut tables = HashSet::new();
    let mut statement =
        db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")?;
    for name in statement.query_map([], |row| row.get::<_, String>(0))? {
        let name = name?;
        if name.starts_with("sqlite_") {
            continue;
        }
        if !RECORD_TABLES.contains(&name.as_str())
            && name != "storage_metadata"
            && name != "migration_journal"
        {
            return Err(ImportError::Rejected(format!("unknown table {name}")));
        }
        tables.insert(name);
    }
    for table in RECORD_TABLES
        .into_iter()
        .chain(["storage_metadata", "migration_journal"])
    {
        if !tables.contains(table) {
            return Err(ImportError::Rejected(format!("missing table {table}")));
        }
        let expected: &[&str] = match table {
            "storage_metadata" => &["id", "schema_version", "updated_at"],
            "migration_journal" => &[
                "id",
                "from_version",
                "to_version",
                "started_at",
                "completed_at",
                "status",
                "error",
            ],
            _ => &["id", "position", "payload"],
        };
        let mut query = db.prepare(&format!("PRAGMA table_info(\"{table}\")"))?;
        let actual: std::collections::BTreeSet<String> = query
            .query_map([], |r| r.get(1))?
            .collect::<std::result::Result<_, _>>()?;
        if actual != expected.iter().map(|v| v.to_string()).collect() {
            return Err(ImportError::Rejected(format!(
                "unexpected columns in {table}"
            )));
        }
    }
    let mut archive = read_metadata(&db)?;
    let mut records = Vec::new();
    let mut quarantined = Vec::new();
    for table in RECORD_TABLES {
        let mut seen = HashSet::new();
        let mut query = db.prepare(&format!(
            "SELECT id,position,payload FROM \"{table}\" ORDER BY position,id"
        ))?;
        let mut rows = query.query([])?;
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let error = |reason: &str| {
                ImportError::Record(RecordError {
                    table: table.into(),
                    id: id.clone(),
                    reason: reason.into(),
                })
            };
            if id.is_empty() {
                return Err(error("empty row ID"));
            }
            if !seen.insert(id.clone()) {
                return Err(error("duplicate table ID"));
            }
            let position: i64 = row
                .get(1)
                .map_err(|_| error("position must be an integer"))?;
            if position < 0 {
                return Err(error("negative position"));
            }
            let payload: String = row.get(2).map_err(|_| error("payload must be text"))?;
            archive.push(ArchiveRow {
                table: table.into(),
                id: id.clone(),
                position: Some(position),
                payload: payload.clone(),
            });
            match validate_record(table, &id, &payload) {
                Ok(value) => records.push(LegacyRecord {
                    table: table.into(),
                    id,
                    position,
                    payload,
                    value,
                }),
                Err(error) => quarantined.push(Quarantined {
                    table: error.table,
                    id: error.id,
                    position,
                    reason: error.reason,
                }),
            }
        }
    }
    Ok((records, archive, quarantined))
}
fn read_metadata(db: &Connection) -> Result<Vec<ArchiveRow>> {
    let mut query =
        db.prepare("SELECT id,schema_version,updated_at FROM storage_metadata ORDER BY id")?;
    let rows = query
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if rows.len() != 1 || rows[0].0 != "radiora" || rows[0].1 != 2 {
        return Err(ImportError::Rejected(
            "expected storage_metadata radiora schema_version=2".into(),
        ));
    }
    let mut archive = Vec::new();
    for (id, version, updated) in rows {
        // Metadata has no payload/position columns. Encode its original column values only.
        let payload = serde_json::to_string(
            &serde_json::json!({"id":id,"schema_version":version,"updated_at":updated}),
        )?;
        archive.push(ArchiveRow {
            table: "storage_metadata".into(),
            id,
            position: None,
            payload,
        });
    }
    let mut query = db.prepare("SELECT id,from_version,to_version,started_at,completed_at,status,error FROM migration_journal ORDER BY id")?;
    let mut rows = query.query([])?;
    let mut seen = HashSet::new();
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let status: String = row.get(5)?;
        if !seen.insert(id.clone()) || status != "completed" {
            return Err(ImportError::Rejected(format!(
                "incomplete/invalid migration_journal {id}: {status}"
            )));
        }
        let payload = serde_json::to_string(&serde_json::json!({
            "id":id,"from_version":row.get::<_,i64>(1)?,"to_version":row.get::<_,i64>(2)?,
            "started_at":row.get::<_,String>(3)?,"completed_at":row.get::<_,Option<String>>(4)?,
            "status":status,"error":row.get::<_,Option<String>>(6)?
        }))?;
        archive.push(ArchiveRow {
            table: "migration_journal".into(),
            id,
            position: None,
            payload,
        });
    }
    Ok(archive)
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
pub(super) fn ensure_unchanged(path: &Path, expected: &SourceFingerprint) -> Result<()> {
    if &fingerprint(path)? != expected {
        return Err(ImportError::SourceChanged);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sha256_and_same_size_modification_and_wal_changes_are_detected() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("fixture");
        fs::write(&path, b"abc")?;
        let before = fingerprint(&path)?;
        assert_eq!(
            before.database.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        fs::write(&path, b"abd")?;
        assert_eq!(fingerprint(&path)?.database.size, before.database.size);
        assert!(matches!(
            ensure_unchanged(&path, &before),
            Err(ImportError::SourceChanged)
        ));
        let before = fingerprint(&path)?;
        fs::write(dir.path().join("fixture-wal"), b"wal fixture")?;
        assert!(matches!(
            ensure_unchanged(&path, &before),
            Err(ImportError::SourceChanged)
        ));
        Ok(())
    }
}
