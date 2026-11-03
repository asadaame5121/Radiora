//! Fixture-only storage protocol, not the product schema or command API.
use loro::{ExportMode, LoroDoc, VersionVector};
use radiora_loro_purge_poc::{Phase, Result};
use std::path::Path;
use std::process::{Command, Stdio};

mod storage {
    include!("../src/storage.rs");

    impl Store {
        pub fn prepare_requests(&self) -> Result<()> {
            let journal: String = self.db.query_row("PRAGMA journal_mode", [], |r| r.get(0))?;
            let synchronous: i64 = self.db.query_row("PRAGMA synchronous", [], |r| r.get(0))?;
            assert_eq!(journal, "wal");
            assert_eq!(synchronous, 2, "FULL durability");
            self.db.execute_batch(
                "CREATE TABLE IF NOT EXISTS requests (
                 id TEXT PRIMARY KEY, body TEXT NOT NULL);",
            )?;
            Ok(())
        }

        pub fn request(&self, id: &str) -> Result<Option<String>> {
            Ok(self
                .db
                .query_row("SELECT body FROM requests WHERE id=?1", [id], |row| {
                    row.get(0)
                })
                .optional()?)
        }

        // A fixture request receipt and update must share the same transaction.
        pub fn save_request(
            &mut self,
            doc: &LoroDoc,
            from: &VersionVector,
            id: &str,
            body: &str,
            fault: super::Fault,
        ) -> Result<VersionVector> {
            if fault == super::Fault::Export {
                return Err("injected export failure".into());
            }
            let bytes = doc.export(ExportMode::updates(from))?;
            let version = doc.oplog_vv();
            if fault == super::Fault::Commit {
                // A deferred FK violation fails COMMIT after both INSERTs succeed.
                self.db.execute_batch(
                    "PRAGMA foreign_keys=ON;
                     CREATE TABLE IF NOT EXISTS parent(id INTEGER PRIMARY KEY);
                     CREATE TABLE IF NOT EXISTS commit_fault(
                     id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);",
                )?;
            }
            let tx = self.db.transaction()?;
            tx.execute("INSERT INTO updates(bytes) VALUES(?1)", params![bytes])?;
            tx.execute(
                "INSERT INTO requests(id,body) VALUES(?1,?2)",
                params![id, body],
            )?;
            if fault == super::Fault::Commit {
                tx.execute("INSERT INTO commit_fault(id) VALUES(99)", [])?;
            }
            if fault == super::Fault::BeforeCommit {
                super::kill_gate();
            }
            tx.commit()?;
            if fault == super::Fault::AfterCommit {
                super::kill_gate();
            }
            if fault == super::Fault::LostResponse {
                return Err("injected response loss".into());
            }
            Ok(version)
        }

        pub fn compact(&mut self, fault: super::Fault) -> Result<()> {
            // Restore every update first: pending dependencies must never be trimmed.
            let doc = self.restore()?.ok_or("missing snapshot")?;
            let bytes = doc.export(ExportMode::Snapshot)?;
            let tx = self.db.transaction()?;
            tx.execute("UPDATE snapshot SET bytes=?1 WHERE id=1", params![bytes])?;
            if fault == super::Fault::CompactError {
                return Err("injected failure between snapshot and deletion".into());
            }
            if fault == super::Fault::CompactKill {
                super::kill_gate();
            }
            tx.execute("DELETE FROM updates", [])?;
            tx.commit()?;
            Ok(())
        }

        pub fn update_count(&self) -> Result<i64> {
            Ok(self
                .db
                .query_row("SELECT count(*) FROM updates", [], |r| r.get(0))?)
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Fault {
    None,
    Export,
    Commit,
    LostResponse,
    BeforeCommit,
    AfterCommit,
    Partial,
    CompactError,
    CompactKill,
}

// This owner deliberately blocks publication while an unsaved mutation exists.
struct Fixture {
    store: storage::Store,
    doc: LoroDoc,
    saved: VersionVector,
    phase: Phase,
    pending: Option<(String, String)>,
}

impl Fixture {
    fn open(path: &Path) -> Result<Self> {
        let store = storage::Store::open(path)?;
        store.prepare_requests()?;
        let doc = match store.restore()? {
            Some(doc) => doc,
            None => {
                let doc = LoroDoc::new();
                doc.get_text("body").insert(0, "before")?;
                doc.commit();
                store.initialize(&doc)?;
                doc
            }
        };
        let saved = doc.oplog_vv();
        Ok(Self {
            store,
            doc,
            saved,
            phase: Phase::Ready,
            pending: None,
        })
    }

    fn read(&self) -> Result<String> {
        if self.phase != Phase::Ready {
            return Err("publication blocked".into());
        }
        Ok(self.doc.get_text("body").to_string())
    }

    fn edit(&mut self, id: &str, body: &str, fault: Fault) -> Result<()> {
        if self.phase != Phase::Ready {
            return Err("writer blocked".into());
        }
        if let Some(previous) = self.store.request(id)? {
            if previous != body {
                return Err("request ID reused with different payload".into());
            }
            return Ok(());
        }
        self.phase = Phase::RecoveryRequired;
        self.doc.get_text("body").update(body, Default::default())?;
        if fault == Fault::Partial {
            return Err("injected failure midway through compound mutation".into());
        }
        self.doc.get_map("metadata").insert("last_request", id)?;
        self.doc.commit();
        self.pending = Some((id.into(), body.into()));
        self.phase = Phase::Dirty;
        self.retry(fault)
    }

    fn retry(&mut self, fault: Fault) -> Result<()> {
        if self.phase != Phase::Dirty {
            return Err("no complete mutation to retry".into());
        }
        let (id, body) = self.pending.as_ref().ok_or("missing pending request")?;
        if let Some(previous) = self.store.request(id)? {
            if previous != *body {
                return Err("receipt payload mismatch".into());
            }
            self.saved = self.doc.oplog_vv();
        } else {
            self.saved = self
                .store
                .save_request(&self.doc, &self.saved, id, body, fault)?;
        }
        self.pending = None;
        self.phase = Phase::Ready;
        Ok(())
    }
}

#[test]
fn failures_preserve_saved_vv_block_publication_and_retry() -> Result<()> {
    for fault in [Fault::Export, Fault::Commit] {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("fixture.db");
        let mut fixture = Fixture::open(&path)?;
        let saved = fixture.saved.clone();
        assert!(fixture.edit("r1", "日本語🙂", fault).is_err());
        assert_eq!(fixture.saved, saved);
        assert_ne!(fixture.doc.oplog_vv(), saved);
        assert_eq!(fixture.phase, Phase::Dirty);
        assert!(fixture.read().is_err());
        assert!(fixture.edit("r2", "blocked", Fault::None).is_err());
        assert_eq!(Fixture::open(&path)?.read()?, "before");
        assert_eq!(fixture.store.update_count()?, 0);
        assert_eq!(fixture.store.request("r1")?, None);
        fixture.retry(Fault::None)?;
        assert_eq!(fixture.saved, fixture.doc.oplog_vv());
        assert_eq!(Fixture::open(&path)?.read()?, "日本語🙂");
    }
    Ok(())
}

#[test]
fn sqlite_write_failure_uses_existing_store_injection() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("fixture.db");
    let mut fixture = Fixture::open(&path)?;
    fixture.store.inject_write_failure(true)?;
    let saved = fixture.saved.clone();
    assert!(fixture.edit("r1", "edited", Fault::None).is_err());
    assert_eq!(fixture.saved, saved);
    assert_eq!(fixture.phase, Phase::Dirty);
    assert!(fixture.read().is_err());
    assert_eq!(Fixture::open(&path)?.read()?, "before");
    fixture.store.inject_write_failure(false)?;
    fixture.retry(Fault::None)?;
    assert_eq!(Fixture::open(&path)?.read()?, "edited");
    Ok(())
}

#[test]
fn partial_mutation_requires_reopen_not_retry() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("fixture.db");
    let mut fixture = Fixture::open(&path)?;
    let saved = fixture.saved.clone();
    assert!(fixture.edit("r1", "partial", Fault::Partial).is_err());
    assert_eq!(fixture.phase, Phase::RecoveryRequired);
    assert_eq!(fixture.saved, saved);
    assert!(fixture.read().is_err());
    assert!(fixture.retry(Fault::None).is_err());
    assert_eq!(Fixture::open(&path)?.read()?, "before");
    Ok(())
}

#[test]
fn lost_response_and_request_replay_do_not_duplicate_updates() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("fixture.db");
    let mut fixture = Fixture::open(&path)?;
    let saved = fixture.saved.clone();
    assert!(fixture.edit("r1", "once", Fault::LostResponse).is_err());
    assert_eq!(fixture.saved, saved);
    assert_eq!(fixture.phase, Phase::Dirty);
    assert!(fixture.read().is_err());
    assert_eq!(Fixture::open(&path)?.read()?, "once");
    fixture.retry(Fault::None)?;
    assert_eq!(fixture.store.update_count()?, 1);
    let mut reopened = Fixture::open(&path)?;
    let vv = reopened.saved.clone();
    reopened.edit("r1", "once", Fault::None)?;
    assert_eq!(reopened.saved, vv);
    assert!(reopened.edit("r1", "different", Fault::None).is_err());
    reopened.store.compact(Fault::None)?;
    assert_eq!(reopened.store.update_count()?, 0);
    let mut reopened = Fixture::open(&path)?;
    reopened.edit("r1", "once", Fault::None)?;
    assert_eq!(
        reopened.store.update_count()?,
        0,
        "receipt survives compaction"
    );
    Ok(())
}

#[test]
fn snapshot_failure_rolls_back_and_pending_import_refuses_compaction() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("fixture.db");
    let mut fixture = Fixture::open(&path)?;
    fixture
        .doc
        .get_text("body")
        .update("durable", Default::default())?;
    fixture.doc.commit();
    fixture.saved = fixture.store.append(&fixture.doc, &fixture.saved)?;
    assert!(fixture.store.compact(Fault::CompactError).is_err());
    assert_eq!(fixture.store.update_count()?, 1);
    assert_eq!(Fixture::open(&path)?.read()?, "durable");
    fixture.store.compact(Fault::None)?;
    assert_eq!(Fixture::open(&path)?.read()?, "durable");
    assert_eq!(fixture.store.update_count()?, 0);

    let remote = LoroDoc::new();
    remote.get_text("remote").insert(0, "dependency")?;
    remote.commit();
    let missing = remote.oplog_vv();
    remote.get_text("remote").insert(10, "later")?;
    remote.commit();
    let pending = remote.export(ExportMode::updates(&missing))?;
    assert!(fixture.doc.import(&pending)?.pending.is_some());
    // Persist the pending bytes directly to model an incomplete import log.
    let db = rusqlite::Connection::open(&path)?;
    db.execute("INSERT INTO updates(bytes) VALUES(?1)", [pending])?;
    assert!(fixture.store.compact(Fault::None).is_err());
    assert_eq!(fixture.store.update_count()?, 1);
    assert!(Fixture::open(&path).is_err());
    Ok(())
}

fn kill_gate() {
    use std::io::Write;
    println!("KILL_GATE");
    std::io::stdout().flush().expect("flush gate");
    // Parent kills this process while its transaction is at the named boundary.
    loop {
        std::thread::park();
    }
}

#[test]
fn process_worker() -> Result<()> {
    let Some(path) = std::env::var_os("RADIORA_STORAGE_FIXTURE") else {
        return Ok(());
    };
    let mut fixture = Fixture::open(Path::new(&path))?;
    match std::env::var("RADIORA_STORAGE_STEP")?.as_str() {
        "before" => fixture.edit("r1", "after", Fault::BeforeCommit)?,
        "after" => fixture.edit("r1", "after", Fault::AfterCommit)?,
        "compact" => fixture.store.compact(Fault::CompactKill)?,
        "verify-before" => assert_eq!(fixture.read()?, "before"),
        "verify-after" => {
            assert_eq!(fixture.read()?, "after");
            let vv = fixture.saved.clone();
            fixture.edit("r1", "after", Fault::None)?;
            assert_eq!(fixture.saved, vv);
        }
        _ => return Err("unknown worker step".into()),
    }
    Ok(())
}

fn child(path: &Path, step: &str, kill: bool) -> Result<()> {
    use std::io::{BufRead, BufReader};
    let mut child = Command::new(std::env::current_exe()?)
        .args(["--exact", "process_worker", "--nocapture"])
        .env("RADIORA_STORAGE_FIXTURE", path)
        .env("RADIORA_STORAGE_STEP", step)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;
    if kill {
        let stdout = child.stdout.take().ok_or("missing child stdout")?;
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let found = BufReader::new(stdout)
                .lines()
                .any(|line| line.is_ok_and(|line| line.contains("KILL_GATE")));
            let _ = sender.send(found);
        });
        let reached = receiver.recv_timeout(std::time::Duration::from_secs(30));
        child.kill()?;
        child.wait()?;
        assert!(matches!(reached, Ok(true)), "child did not reach boundary");
    } else {
        let output = child.wait_with_output()?;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
    Ok(())
}

#[test]
fn process_kill_before_after_commit_and_during_compaction() -> Result<()> {
    for (step, expected) in [
        ("before", "before"),
        ("after", "after"),
        ("compact", "after"),
        ("saved", "after"),
    ] {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("fixture.db");
        let mut fixture = Fixture::open(&path)?;
        if step == "compact" || step == "saved" {
            fixture.edit("r1", "after", Fault::None)?;
        }
        drop(fixture);
        if step != "saved" {
            child(&path, step, true)?;
        }
        // Restore in a different OS process, not just a second connection.
        child(&path, &format!("verify-{expected}"), false)?;
        let mut fixture = Fixture::open(&path)?;
        assert_eq!(fixture.read()?, expected);
        fixture.store.compact(Fault::None)?;
        assert_eq!(Fixture::open(&path)?.read()?, expected);
        drop(fixture);
        child(&path, &format!("verify-{expected}"), false)?;
    }
    Ok(())
}
