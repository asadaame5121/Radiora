//! Isolated, fixture-only PoC for the adopted purge/Undo boundary.
//!
//! `Workspace` is the historical two-session-manager fixture kept for its
//! known-failure reproduction. `SharedWorkspace` is the fixture for the adopted
//! v3 direction (one workspace, one shared history).

mod shared;
mod storage;

pub use shared::{BlockView, SharedWorkspace, TreeProbe};

use loro::{CommitOptions, LoroDoc, UndoManager, VersionVector};
use std::path::Path;
use storage::Store;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Ready,
    Dirty,
    RecoveryRequired,
}

/// Synchronous owner: doc and managers never escape this boundary.
/// Two named fixture blocks are NOT a proposed v3 schema or UUID generator.
pub struct Workspace {
    doc: LoroDoc,
    sessions: [UndoManager; 2],
    store: Store,
    saved: VersionVector,
    phase: Phase,
    clear_on_save: bool,
}

impl Workspace {
    pub fn open(path: &Path) -> Result<Self> {
        let store = Store::open(path)?;
        let doc = match store.restore()? {
            Some(doc) => doc,
            None => {
                let doc = LoroDoc::new();
                doc.get_text("target").insert(0, "before")?;
                doc.get_text("keep").insert(0, "other")?;
                doc.commit();
                store.initialize(&doc)?;
                doc
            }
        };
        let sessions = [Self::manager(&doc, 0), Self::manager(&doc, 1)];
        let saved = doc.oplog_vv();
        Ok(Self {
            doc,
            sessions,
            store,
            saved,
            phase: Phase::Ready,
            clear_on_save: false,
        })
    }

    fn manager(doc: &LoroDoc, session: usize) -> UndoManager {
        let mut manager = UndoManager::new(doc);
        manager.set_merge_interval(0);
        manager.add_exclude_origin_prefix("system:");
        manager.add_exclude_origin_prefix(if session == 0 {
            "session:1"
        } else {
            "session:0"
        });
        manager
    }

    fn ready(&self) -> Result<()> {
        if self.phase != Phase::Ready {
            return Err("workspace blocked: retry persistence or reopen for recovery".into());
        }
        Ok(())
    }

    fn known(id: &str) -> Result<()> {
        if !["target", "keep"].contains(&id) {
            return Err("unknown fixture block".into());
        }
        Ok(())
    }

    fn session(session: usize) -> Result<()> {
        if session >= 2 {
            return Err("unknown fixture session".into());
        }
        Ok(())
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn histories(&self) -> [(usize, usize); 2] {
        self.sessions
            .each_ref()
            .map(|manager| (manager.undo_count(), manager.redo_count()))
    }

    /// PoC-only fault control at the real SQLite boundary, not a mock writer.
    pub fn inject_write_failure(&self, enabled: bool) -> Result<()> {
        self.store.inject_write_failure(enabled)
    }

    pub fn is_purged(&self, id: &str) -> Result<bool> {
        self.ready()?;
        Self::known(id)?;
        Ok(self.doc.get_map("purged").get(id).is_some())
    }

    pub fn text(&self, id: &str) -> Result<Option<String>> {
        self.ready()?;
        if self.is_purged(id)? || self.doc.get_map("trash").get(id).is_some() {
            return Ok(None);
        }
        Ok(Some(self.doc.get_text(id).to_string()))
    }

    pub fn edit(&mut self, session: usize, id: &str, text: &str) -> Result<()> {
        self.ready()?;
        Self::session(session)?;
        Self::known(id)?;
        if self.is_purged(id)? || self.doc.get_map("trash").get(id).is_some() {
            return Err("cannot edit a deleted block".into());
        }
        // A Loro error may follow partial application; never persist it via retry.
        self.phase = Phase::RecoveryRequired;
        self.doc.get_text(id).update(text, Default::default())?;
        self.commit_and_save(&format!("session:{session}"), false)
    }

    pub fn trash(&mut self, session: usize, id: &str) -> Result<()> {
        self.ready()?;
        Self::session(session)?;
        Self::known(id)?;
        if self.is_purged(id)? || self.doc.get_map("trash").get(id).is_some() {
            return Err("block is already deleted".into());
        }
        self.phase = Phase::RecoveryRequired;
        self.doc.get_map("trash").insert(id, true)?;
        self.commit_and_save(&format!("session:{session}"), false)
    }

    pub fn purge(&mut self, id: &str, confirmed_history_reset: bool) -> Result<()> {
        self.ready()?;
        Self::known(id)?;
        if !confirmed_history_reset || self.doc.get_map("trash").get(id).is_none() {
            return Err("purge requires a trash target and history-reset confirmation".into());
        }
        if self.is_purged(id)? {
            return Err("block is already purged".into());
        }
        self.phase = Phase::RecoveryRequired;
        let text = self.doc.get_text(id);
        text.delete(0, text.len_unicode())?;
        self.doc.get_map("purged").insert(id, true)?;
        self.commit_and_save("system:purge", true)
    }

    fn commit_and_save(&mut self, origin: &str, clear: bool) -> Result<()> {
        self.doc.commit_with(CommitOptions::new().origin(origin));
        self.clear_on_save = clear;
        self.phase = Phase::Dirty;
        self.retry()
    }

    pub fn retry(&mut self) -> Result<()> {
        if self.phase != Phase::Dirty {
            return Err("no complete mutation awaiting persistence".into());
        }
        // Leave Dirty and all remaining history intact if SQLite fails.
        self.saved = self.store.append(&self.doc, &self.saved)?;
        if self.clear_on_save {
            for manager in &self.sessions {
                manager.clear();
            }
            self.clear_on_save = false;
        }
        self.phase = Phase::Ready;
        Ok(())
    }

    pub fn undo(&mut self, session: usize) -> Result<bool> {
        self.replay(session, false)
    }

    pub fn redo(&mut self, session: usize) -> Result<bool> {
        self.replay(session, true)
    }

    fn replay(&mut self, session: usize, redo: bool) -> Result<bool> {
        self.ready()?;
        Self::session(session)?;
        self.phase = Phase::RecoveryRequired;
        // Replay is a local edit too. Other managers must transform against it
        // without recording it as their own step. Loro pause does both.
        for (index, manager) in self.sessions.iter().enumerate() {
            if index != session {
                manager.pause();
            }
        }
        let result = if redo {
            self.sessions[session].redo()
        } else {
            self.sessions[session].undo()
        };
        // Resume even on a returned Loro error; the workspace stays blocked.
        for (index, manager) in self.sessions.iter().enumerate() {
            if index != session {
                manager.resume();
            }
        }
        let changed = result?;
        if !changed {
            self.phase = Phase::Ready;
            return Ok(false);
        }
        self.clear_on_save = false;
        self.phase = Phase::Dirty;
        self.retry()?;
        Ok(true)
    }
}
