use crate::Result;
use loro::{ExportMode, LoroDoc, VersionVector};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub(crate) struct Store {
    db: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path)?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             CREATE TABLE IF NOT EXISTS snapshot (
               id INTEGER PRIMARY KEY CHECK(id=1), bytes BLOB NOT NULL
             );
             CREATE TABLE IF NOT EXISTS updates (
               seq INTEGER PRIMARY KEY, bytes BLOB NOT NULL
             );",
        )?;
        Ok(Self { db })
    }

    pub fn restore(&self) -> Result<Option<LoroDoc>> {
        let snapshot: Option<Vec<u8>> = self
            .db
            .query_row("SELECT bytes FROM snapshot WHERE id=1", [], |row| {
                row.get(0)
            })
            .optional()?;
        let Some(bytes) = snapshot else {
            return Ok(None);
        };
        let doc = LoroDoc::from_snapshot(&bytes)?;
        let mut query = self.db.prepare("SELECT bytes FROM updates ORDER BY seq")?;
        let rows = query.query_map([], |row| row.get::<_, Vec<u8>>(0))?;
        for row in rows {
            if doc.import(&row?)?.pending.is_some() {
                return Err("incomplete fixture update dependencies".into());
            }
        }
        Ok(Some(doc))
    }

    pub fn initialize(&self, doc: &LoroDoc) -> Result<()> {
        self.db.execute(
            "INSERT INTO snapshot(id,bytes) VALUES(1,?1)",
            params![doc.export(ExportMode::Snapshot)?],
        )?;
        Ok(())
    }

    pub fn append(&mut self, doc: &LoroDoc, from: &VersionVector) -> Result<VersionVector> {
        let bytes = doc.export(ExportMode::updates(from))?;
        let version = doc.oplog_vv();
        let transaction = self.db.transaction()?;
        transaction.execute("INSERT INTO updates(bytes) VALUES(?1)", params![bytes])?;
        transaction.commit()?;
        Ok(version)
    }

    pub fn inject_write_failure(&self, enabled: bool) -> Result<()> {
        self.db.execute_batch(if enabled {
            "CREATE TEMP TRIGGER IF NOT EXISTS reject_fixture_write
             BEFORE INSERT ON updates BEGIN
               SELECT RAISE(ABORT, 'injected SQLite write failure');
             END;"
        } else {
            "DROP TRIGGER IF EXISTS temp.reject_fixture_write;"
        })?;
        Ok(())
    }
}
