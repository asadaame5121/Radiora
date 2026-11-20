//! SQLite durability for the workspace document: the latest full snapshot plus the
//! Loro updates exported after it, and the record of applied requests.
//!
//! The version published to callers is the sequence number of the last durable update
//! (`0` for a workspace that holds only its initial snapshot). It only grows.

use super::error::{Result, WorkspaceError};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use std::path::Path;
use std::time::Duration;
use uuid::Uuid;

/// Bumped on any incompatible change to the tables below or to the Loro layout in `schema.rs`.
pub(super) const STORE_SCHEMA_VERSION: i64 = 1;
const FORMAT: &str = "radiora-v3-workspace";
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// `PRAGMA synchronous` reports FULL as 2.
const SYNCHRONOUS_FULL: i64 = 2;

/// A request already made durable, looked up by its client-issued ID.
pub(super) struct AppliedRequest {
    pub digest: Vec<u8>,
    pub version: u64,
}

/// What was read back from the store when opening an existing workspace.
pub(super) struct Restored {
    pub snapshot: Vec<u8>,
    pub updates: Vec<Vec<u8>>,
    pub version: u64,
}

pub(super) struct Store {
    db: Connection,
}

impl Store {
    /// Opens the database and checks its format. A database without any table is
    /// returned as `None` so that the caller can create the initial snapshot.
    pub fn open(path: &Path) -> Result<(Self, Option<Restored>)> {
        let db = Connection::open(path)?;
        db.busy_timeout(BUSY_TIMEOUT)?;
        let store = Self { db };
        store.require_durability()?;
        if store.table_count()? == 0 {
            return Ok((store, None));
        }
        store.check_format()?;
        let restored = store.read_all()?;
        Ok((store, Some(restored)))
    }

    /// Creates the tables and the first snapshot in one transaction.
    pub fn initialize(&mut self, snapshot: &[u8]) -> Result<()> {
        let tx = self.db.transaction()?;
        tx.execute_batch(
            "CREATE TABLE store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
             CREATE TABLE snapshot (
               id INTEGER PRIMARY KEY CHECK(id = 1),
               through_seq INTEGER NOT NULL CHECK(through_seq >= 0),
               bytes BLOB NOT NULL
             ) STRICT;
             CREATE TABLE updates (
               seq INTEGER PRIMARY KEY AUTOINCREMENT, bytes BLOB NOT NULL
             ) STRICT;
             CREATE TABLE applied_request (
               request_id TEXT PRIMARY KEY,
               digest BLOB NOT NULL,
               version INTEGER NOT NULL CHECK(version >= 0)
             ) STRICT;",
        )?;
        tx.execute(
            "INSERT INTO store_meta(key, value) VALUES ('format', ?1), ('schema_version', ?2)",
            params![FORMAT, STORE_SCHEMA_VERSION.to_string()],
        )?;
        tx.execute(
            "INSERT INTO snapshot(id, through_seq, bytes) VALUES (1, 0, ?1)",
            params![snapshot],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn applied_request(&self, request: Uuid) -> Result<Option<AppliedRequest>> {
        let row = self
            .db
            .query_row(
                "SELECT digest, version FROM applied_request WHERE request_id = ?1",
                params![request.to_string()],
                |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        row.map(|(digest, version)| {
            Ok(AppliedRequest {
                digest,
                version: to_version(version)?,
            })
        })
        .transpose()
    }

    /// Makes one request durable: its update (if the request changed the document) and
    /// its digest commit together, so a resent request is either fully recorded or absent.
    pub fn append(
        &mut self,
        update: Option<&[u8]>,
        request: Uuid,
        digest: &[u8],
        current: u64,
    ) -> Result<u64> {
        let tx = self.db.transaction()?;
        let version = match update {
            Some(bytes) => insert_update(&tx, bytes)?,
            None => current,
        };
        tx.execute(
            "INSERT INTO applied_request(request_id, digest, version) VALUES (?1, ?2, ?3)",
            params![request.to_string(), digest, to_sql(version)?],
        )?;
        tx.commit()?;
        Ok(version)
    }

    /// Sets WAL with `synchronous=FULL` (the setting the storage PoC verified) and checks
    /// that SQLite actually applied it: `journal_mode` silently stays unchanged on some
    /// file systems, and a success reported under weaker settings would not be durable.
    fn require_durability(&self) -> Result<()> {
        let journal: String = self
            .db
            .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
        self.db.execute_batch("PRAGMA synchronous=FULL;")?;
        let synchronous: i64 = self
            .db
            .query_row("PRAGMA synchronous", [], |row| row.get(0))?;
        if !journal.eq_ignore_ascii_case("wal") || synchronous != SYNCHRONOUS_FULL {
            return Err(WorkspaceError::NotDurable(format!(
                "journal_mode={journal}, synchronous={synchronous}"
            )));
        }
        Ok(())
    }

    fn table_count(&self) -> Result<i64> {
        Ok(self.db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )?)
    }

    fn check_format(&self) -> Result<()> {
        let has_meta: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'store_meta')",
            [],
            |row| row.get(0),
        )?;
        if !has_meta {
            return Err(WorkspaceError::NotWorkspace(
                "the database has tables but no store_meta".into(),
            ));
        }
        let format = self.meta("format")?;
        if format.as_deref() != Some(FORMAT) {
            return Err(WorkspaceError::NotWorkspace(format!(
                "unexpected format {format:?}"
            )));
        }
        let schema = self.meta("schema_version")?.unwrap_or_default();
        if schema != STORE_SCHEMA_VERSION.to_string() {
            return Err(WorkspaceError::SchemaMismatch {
                found: schema,
                expected: STORE_SCHEMA_VERSION,
            });
        }
        Ok(())
    }

    fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .db
            .query_row(
                "SELECT value FROM store_meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?)
    }

    fn read_all(&self) -> Result<Restored> {
        let (through, snapshot): (i64, Vec<u8>) = self
            .db
            .query_row(
                "SELECT through_seq, bytes FROM snapshot WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| WorkspaceError::Corrupt("the snapshot row is missing".into()))?;
        let mut version = to_version(through)?;
        let mut query = self
            .db
            .prepare("SELECT seq, bytes FROM updates WHERE seq > ?1 ORDER BY seq")?;
        let rows = query.query_map(params![through], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?;
        let mut updates = Vec::new();
        for row in rows {
            let (seq, bytes) = row?;
            version = to_version(seq)?;
            updates.push(bytes);
        }
        Ok(Restored {
            snapshot,
            updates,
            version,
        })
    }
}

fn insert_update(tx: &Transaction<'_>, bytes: &[u8]) -> Result<u64> {
    tx.execute("INSERT INTO updates(bytes) VALUES (?1)", params![bytes])?;
    to_version(tx.last_insert_rowid())
}

fn to_version(value: i64) -> Result<u64> {
    u64::try_from(value).map_err(|_| WorkspaceError::Corrupt(format!("negative version {value}")))
}

fn to_sql(version: u64) -> Result<i64> {
    i64::try_from(version)
        .map_err(|_| WorkspaceError::Corrupt(format!("version {version} exceeds SQLite INTEGER")))
}
