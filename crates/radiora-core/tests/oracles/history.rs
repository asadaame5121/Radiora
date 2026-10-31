//! V11 oracle: one workspace-shared Undo/Redo history.
//!
//! Contract: v3-model-decisions.md「共通Undoの操作単位・寿命の採用契約」.
//! Reading of "入力間隔1秒以内": a gap of exactly 1000 ms still merges; 1001 ms splits.
//! The document snapshot is rewound by Undo, the ID ledger never is.

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;
use serde::Deserialize;

use crate::support::{Coverage, max_ops, read_fixture, runner};

pub type BlockId = u32;
pub type Pane = u8;

pub const MERGE_WINDOW_MS: u64 = 1000;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Op {
    Type {
        pane: Pane,
        block: BlockId,
        at_ms: u64,
        text: String,
    },
    ImeStart {
        pane: Pane,
    },
    ImeCommit {
        pane: Pane,
        block: BlockId,
        at_ms: u64,
        text: String,
    },
    Paste {
        pane: Pane,
        block: BlockId,
        at_ms: u64,
        text: String,
    },
    Create {
        pane: Pane,
        at_ms: u64,
    },
    Remove {
        pane: Pane,
        block: BlockId,
        at_ms: u64,
    },
    CaretMove {
        pane: Pane,
        block: BlockId,
    },
    Autosave,
    Undo {
        pane: Pane,
        flush_ok: bool,
    },
    Redo {
        pane: Pane,
        flush_ok: bool,
    },
    Restart,
    PurgeCommitted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Typing,
    Ime,
    Paste,
    Structural,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    NewGroup,
    Merged,
    Rejected(&'static str),
    Undone { notify: bool },
    Redone { notify: bool },
    Boundary,
    Ignored,
    Cleared,
}

impl Outcome {
    pub fn label(&self) -> String {
        match self {
            Self::NewGroup => "new_group".into(),
            Self::Merged => "merged".into(),
            Self::Rejected(reason) => format!("rejected:{reason}"),
            Self::Undone { notify } => format!("undone:notify={notify}"),
            Self::Redone { notify } => format!("redone:notify={notify}"),
            Self::Boundary => "boundary".into(),
            Self::Ignored => "ignored".into(),
            Self::Cleared => "cleared".into(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Doc {
    pub live: BTreeMap<BlockId, String>,
    pub tombstones: BTreeMap<BlockId, String>,
}

#[derive(Clone, Debug)]
pub struct Group {
    pub kind: Kind,
    pub pane: Pane,
    pub block: BlockId,
    pub stamps: Vec<u64>,
    before: Doc,
    after: Doc,
}

#[derive(Clone, Debug)]
pub struct Model {
    pub doc: Doc,
    pub issued: BTreeSet<BlockId>,
    next_id: BlockId,
    pub undo: Vec<Group>,
    pub redo: Vec<Group>,
    /// The top Undo group may still absorb typing until a boundary closes it.
    open_run: bool,
    composing: BTreeSet<Pane>,
    focus: BTreeMap<Pane, BlockId>,
    last_pane: Option<Pane>,
}

impl Model {
    /// Blocks `1..=initial_blocks` exist before the sequence, already durable.
    pub fn new(initial_blocks: BlockId) -> Self {
        let live = (1..=initial_blocks).map(|id| (id, String::new())).collect();
        Self {
            doc: Doc {
                live,
                tombstones: BTreeMap::new(),
            },
            issued: (1..=initial_blocks).collect(),
            next_id: initial_blocks + 1,
            undo: Vec::new(),
            redo: Vec::new(),
            open_run: false,
            composing: BTreeSet::new(),
            focus: BTreeMap::new(),
            last_pane: None,
        }
    }

    pub fn apply(&mut self, op: &Op) -> Outcome {
        if let Some(pane) = op_pane(op) {
            // Another pane's operation ends the previous run.
            if self.last_pane.is_some_and(|last| last != pane) {
                self.open_run = false;
            }
            self.last_pane = Some(pane);
        }
        match op {
            Op::Type {
                pane,
                block,
                at_ms,
                text,
            } => self.type_text(*pane, *block, *at_ms, text),
            Op::ImeStart { pane } => {
                self.open_run = false;
                self.composing.insert(*pane);
                Outcome::Boundary
            }
            Op::ImeCommit {
                pane,
                block,
                at_ms,
                text,
            } => {
                if !self.composing.remove(pane) {
                    return Outcome::Rejected("not_composing");
                }
                self.edit_group(Kind::Ime, *pane, *block, *at_ms, |doc| {
                    append(doc, *block, text)
                })
            }
            Op::Paste {
                pane,
                block,
                at_ms,
                text,
            } => self.edit_group(Kind::Paste, *pane, *block, *at_ms, |doc| {
                append(doc, *block, text)
            }),
            Op::Create { pane, at_ms } => {
                let id = self.next_id;
                self.next_id += 1;
                self.issued.insert(id);
                self.edit_group(Kind::Structural, *pane, id, *at_ms, |doc| {
                    doc.live.insert(id, String::new());
                    true
                })
            }
            Op::Remove { pane, block, at_ms } => {
                self.edit_group(Kind::Structural, *pane, *block, *at_ms, |doc| {
                    match doc.live.remove(block) {
                        Some(text) => {
                            doc.tombstones.insert(*block, text);
                            true
                        }
                        None => false,
                    }
                })
            }
            Op::CaretMove { pane, block } => {
                self.open_run = false;
                self.focus.insert(*pane, *block);
                Outcome::Boundary
            }
            // Saving is independent of the user's Undo units.
            Op::Autosave => Outcome::Ignored,
            Op::Undo { pane, flush_ok } => self.replay(*pane, *flush_ok, true),
            Op::Redo { pane, flush_ok } => self.replay(*pane, *flush_ok, false),
            Op::Restart => {
                self.clear_history();
                self.composing.clear();
                self.focus.clear();
                self.last_pane = None;
                Outcome::Cleared
            }
            Op::PurgeCommitted => {
                self.clear_history();
                Outcome::Cleared
            }
        }
    }

    fn type_text(&mut self, pane: Pane, block: BlockId, at_ms: u64, text: &str) -> Outcome {
        if self.composing.contains(&pane) {
            return Outcome::Rejected("ime_composing");
        }
        let mergeable = self.open_run
            && self.undo.last().is_some_and(|top| {
                top.kind == Kind::Typing
                    && top.pane == pane
                    && top.block == block
                    && top
                        .stamps
                        .last()
                        .is_some_and(|last| at_ms >= *last && at_ms - *last <= MERGE_WINDOW_MS)
            });
        if !mergeable {
            let outcome = self.edit_group(Kind::Typing, pane, block, at_ms, |doc| {
                append(doc, block, text)
            });
            self.open_run = outcome == Outcome::NewGroup;
            return outcome;
        }
        let mut doc = self.doc.clone();
        if !append(&mut doc, block, text) {
            return Outcome::Rejected("not_live");
        }
        let top = self.undo.last_mut().expect("mergeable implies a top group");
        top.stamps.push(at_ms);
        top.after = doc.clone();
        self.doc = doc;
        self.redo.clear();
        self.focus.insert(pane, block);
        Outcome::Merged
    }

    fn edit_group(
        &mut self,
        kind: Kind,
        pane: Pane,
        block: BlockId,
        at_ms: u64,
        change: impl FnOnce(&mut Doc) -> bool,
    ) -> Outcome {
        let mut doc = self.doc.clone();
        if !change(&mut doc) {
            return Outcome::Rejected("not_live");
        }
        self.undo.push(Group {
            kind,
            pane,
            block,
            stamps: vec![at_ms],
            before: self.doc.clone(),
            after: doc.clone(),
        });
        self.doc = doc;
        self.redo.clear();
        self.open_run = false;
        self.focus.insert(pane, block);
        Outcome::NewGroup
    }

    fn replay(&mut self, pane: Pane, flush_ok: bool, undo: bool) -> Outcome {
        self.open_run = false;
        if self.composing.contains(&pane) {
            return Outcome::Rejected("ime_composing");
        }
        if !flush_ok {
            return Outcome::Rejected("flush_failed");
        }
        let (from, to) = if undo {
            (&mut self.undo, &mut self.redo)
        } else {
            (&mut self.redo, &mut self.undo)
        };
        let Some(group) = from.pop() else {
            return Outcome::Rejected("empty");
        };
        // The screen does not move; another pane or card only gets a notice.
        let notify = group.pane != pane || self.focus.get(&pane) != Some(&group.block);
        self.doc = if undo {
            group.before.clone()
        } else {
            group.after.clone()
        };
        to.push(group);
        if undo {
            Outcome::Undone { notify }
        } else {
            Outcome::Redone { notify }
        }
    }

    fn clear_history(&mut self) {
        self.undo.clear();
        self.redo.clear();
        self.open_run = false;
    }
}

fn op_pane(op: &Op) -> Option<Pane> {
    match op {
        Op::Type { pane, .. }
        | Op::ImeStart { pane }
        | Op::ImeCommit { pane, .. }
        | Op::Paste { pane, .. }
        | Op::Create { pane, .. }
        | Op::Remove { pane, .. }
        | Op::CaretMove { pane, .. }
        | Op::Undo { pane, .. }
        | Op::Redo { pane, .. } => Some(*pane),
        Op::Autosave | Op::Restart | Op::PurgeCommitted => None,
    }
}

fn append(doc: &mut Doc, block: BlockId, text: &str) -> bool {
    match doc.live.get_mut(&block) {
        Some(body) => {
            body.push_str(text);
            true
        }
        None => false,
    }
}

// ---- Generators ----

const INITIAL_BLOCKS: BlockId = 3;

/// Gaps cluster around the 1 s boundary so both merge and split are reached.
fn gap() -> impl Strategy<Value = u64> {
    prop_oneof![0u64..=300, 999u64..=1001, 1002u64..=3000]
}

#[derive(Clone, Debug)]
enum Draft {
    Type(Pane, BlockId, u64, char),
    /// Continues the previous typing target so merge windows are actually exercised.
    TypeAgain(u64, char),
    ImeStart(Pane),
    ImeCommit(Pane, BlockId, u64),
    Paste(Pane, BlockId, u64),
    Create(Pane, u64),
    Remove(Pane, BlockId, u64),
    Caret(Pane, BlockId),
    Autosave,
    Undo(Pane, bool),
    Redo(Pane, bool),
    Restart,
    Purge,
}

fn draft() -> impl Strategy<Value = Draft> {
    let pane = 1u8..=2;
    let block = 1u32..=5;
    prop_oneof![
        4 => (pane.clone(), block.clone(), gap(), prop::char::range('a', 'e'))
            .prop_map(|(p, b, g, c)| Draft::Type(p, b, g, c)),
        6 => (gap(), prop::char::range('a', 'e')).prop_map(|(g, c)| Draft::TypeAgain(g, c)),
        1 => pane.clone().prop_map(Draft::ImeStart),
        1 => (pane.clone(), block.clone(), gap()).prop_map(|(p, b, g)| Draft::ImeCommit(p, b, g)),
        1 => (pane.clone(), block.clone(), gap()).prop_map(|(p, b, g)| Draft::Paste(p, b, g)),
        1 => (pane.clone(), gap()).prop_map(|(p, g)| Draft::Create(p, g)),
        1 => (pane.clone(), block.clone(), gap()).prop_map(|(p, b, g)| Draft::Remove(p, b, g)),
        1 => (pane.clone(), block.clone()).prop_map(|(p, b)| Draft::Caret(p, b)),
        1 => Just(Draft::Autosave),
        4 => (pane.clone(), prop::bool::weighted(0.9)).prop_map(|(p, f)| Draft::Undo(p, f)),
        2 => (pane, prop::bool::weighted(0.9)).prop_map(|(p, f)| Draft::Redo(p, f)),
        1 => Just(Draft::Restart),
        1 => Just(Draft::Purge),
    ]
}

/// Converts gaps into a monotone virtual clock; no real sleep is involved.
fn ops() -> impl Strategy<Value = Vec<Op>> {
    prop::collection::vec(draft(), 0..=max_ops()).prop_map(|drafts| {
        let mut now = 0;
        let mut tick = |gap: u64| {
            now += gap;
            now
        };
        let mut target = (1, 1);
        drafts
            .into_iter()
            .map(|draft| match draft {
                Draft::Type(pane, block, gap, c) => {
                    target = (pane, block);
                    Op::Type {
                        pane,
                        block,
                        at_ms: tick(gap),
                        text: c.to_string(),
                    }
                }
                Draft::TypeAgain(gap, c) => {
                    let (pane, block) = target;
                    Op::Type {
                        pane,
                        block,
                        at_ms: tick(gap),
                        text: c.to_string(),
                    }
                }
                Draft::ImeStart(pane) => Op::ImeStart { pane },
                Draft::ImeCommit(pane, block, gap) => Op::ImeCommit {
                    pane,
                    block,
                    at_ms: tick(gap),
                    text: "変換".into(),
                },
                Draft::Paste(pane, block, gap) => Op::Paste {
                    pane,
                    block,
                    at_ms: tick(gap),
                    text: "<p>".into(),
                },
                Draft::Create(pane, gap) => Op::Create {
                    pane,
                    at_ms: tick(gap),
                },
                Draft::Remove(pane, block, gap) => Op::Remove {
                    pane,
                    block,
                    at_ms: tick(gap),
                },
                Draft::Caret(pane, block) => Op::CaretMove { pane, block },
                Draft::Autosave => Op::Autosave,
                Draft::Undo(pane, flush_ok) => Op::Undo { pane, flush_ok },
                Draft::Redo(pane, flush_ok) => Op::Redo { pane, flush_ok },
                Draft::Restart => Op::Restart,
                Draft::Purge => Op::PurgeCommitted,
            })
            .collect()
    })
}

fn is_clear(op: &Op) -> bool {
    matches!(op, Op::Restart | Op::PurgeCommitted)
}

// ---- Properties ----

#[test]
fn oracle_invariants_hold_for_every_step() {
    let coverage = Coverage::default();
    runner(file!())
        .run(&ops(), |ops| {
            let mut model = Model::new(INITIAL_BLOCKS);
            for op in &ops {
                let issued_before = model.issued.clone();
                let undo_before = model.undo.len();
                let doc_before = model.doc.clone();
                let outcome = model.apply(op);
                record(&coverage, op, &outcome);
                // The ledger is monotone: Undo never releases an issued ID.
                prop_assert!(issued_before.is_subset(&model.issued));
                if matches!(op, Op::Create { .. }) {
                    prop_assert_eq!(model.issued.len(), issued_before.len() + 1);
                }
                let doc_ids: BTreeSet<_> = model
                    .doc
                    .live
                    .keys()
                    .chain(model.doc.tombstones.keys())
                    .copied()
                    .collect();
                prop_assert!(doc_ids.is_subset(&model.issued));
                match &outcome {
                    Outcome::Rejected(_) => {
                        prop_assert_eq!(&model.doc, &doc_before);
                        prop_assert!(model.undo.len() <= undo_before);
                    }
                    Outcome::NewGroup | Outcome::Merged => prop_assert!(model.redo.is_empty()),
                    Outcome::Cleared => {
                        prop_assert!(model.undo.is_empty() && model.redo.is_empty());
                        prop_assert_eq!(&model.doc, &doc_before);
                    }
                    _ => {}
                }
                for group in &model.undo {
                    // Typing groups never span more than the merge window per gap.
                    for pair in group.stamps.windows(2) {
                        prop_assert!(pair[1] - pair[0] <= MERGE_WINDOW_MS);
                    }
                    if group.kind != Kind::Typing {
                        prop_assert_eq!(group.stamps.len(), 1);
                    }
                }
            }
            Ok(())
        })
        .unwrap();
    coverage.require(
        "V11 invariants",
        &[
            "merged",
            "new_group",
            "undone",
            "undo_empty",
            "undo_ime",
            "undo_flush",
            "redone",
            "notify_other",
            "cleared",
            "create",
        ],
    );
}

#[test]
fn undo_all_returns_to_the_last_cleared_document() {
    runner(file!())
        .run(&ops(), |ops| {
            let mut model = Model::new(INITIAL_BLOCKS);
            for op in &ops {
                model.apply(op);
            }
            // Independent baseline: replay only up to the last restart/purge.
            let cut = ops.iter().rposition(is_clear).map_or(0, |index| index + 1);
            let mut baseline = Model::new(INITIAL_BLOCKS);
            for op in &ops[..cut] {
                baseline.apply(op);
            }
            let pane = 1;
            model.composing.clear();
            while let Outcome::Undone { .. } = model.apply(&Op::Undo {
                pane,
                flush_ok: true,
            }) {}
            prop_assert_eq!(&model.doc, &baseline.doc);
            Ok(())
        })
        .unwrap();
}

#[test]
fn undo_then_redo_is_identity_on_the_document() {
    runner(file!())
        .run(&ops(), |ops| {
            let mut model = Model::new(INITIAL_BLOCKS);
            for op in &ops {
                model.apply(op);
            }
            model.composing.clear();
            let before = model.doc.clone();
            if let Outcome::Undone { .. } = model.apply(&Op::Undo {
                pane: 1,
                flush_ok: true,
            }) {
                let redone = model.apply(&Op::Redo {
                    pane: 1,
                    flush_ok: true,
                });
                let was_redone = matches!(redone, Outcome::Redone { .. });
                prop_assert!(was_redone, "Redo after Undo must apply: {:?}", redone);
                prop_assert_eq!(&model.doc, &before);
            }
            Ok(())
        })
        .unwrap();
}

#[test]
fn autosave_never_changes_undo_units() {
    let with_saves = (
        ops(),
        prop::collection::vec(any::<prop::sample::Index>(), 0..5),
    );
    runner(file!())
        .run(&with_saves, |(ops, positions)| {
            let mut saved = ops.clone();
            for position in positions {
                saved.insert(position.index(saved.len() + 1), Op::Autosave);
            }
            prop_assert_eq!(run_labels(&ops), run_labels(&saved));
            Ok(())
        })
        .unwrap();
}

/// Outcome labels of every non-autosave operation.
fn run_labels(ops: &[Op]) -> Vec<String> {
    let mut model = Model::new(INITIAL_BLOCKS);
    ops.iter()
        .map(|op| (op, model.apply(op).label()))
        .filter(|(op, _)| **op != Op::Autosave)
        .map(|(_, label)| label)
        .collect()
}

fn record(coverage: &Coverage, op: &Op, outcome: &Outcome) {
    match outcome {
        Outcome::Merged => coverage.hit("merged"),
        Outcome::NewGroup => coverage.hit("new_group"),
        Outcome::Undone { notify } => {
            coverage.hit("undone");
            if *notify {
                coverage.hit("notify_other");
            }
        }
        Outcome::Redone { .. } => coverage.hit("redone"),
        Outcome::Rejected("empty") => coverage.hit("undo_empty"),
        Outcome::Rejected("ime_composing") if matches!(op, Op::Undo { .. } | Op::Redo { .. }) => {
            coverage.hit("undo_ime")
        }
        Outcome::Rejected("flush_failed") => coverage.hit("undo_flush"),
        Outcome::Cleared => coverage.hit("cleared"),
        _ => {}
    }
    if matches!(op, Op::Create { .. }) && *outcome == Outcome::NewGroup {
        coverage.hit("create");
    }
}

// ---- Shared JSON fixtures (Rust/TS) ----

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fixture {
    id: String,
    contract: String,
    initial_blocks: BlockId,
    ops: Vec<Op>,
    outcomes: Vec<String>,
    live: BTreeMap<BlockId, String>,
    #[serde(default)]
    tombstones: BTreeMap<BlockId, String>,
    undo_len: usize,
    redo_len: usize,
    #[serde(default)]
    issued: Option<Vec<BlockId>>,
}

#[test]
fn shared_fixtures_match_the_contract() {
    let fixtures: Vec<Fixture> =
        serde_json::from_str(&read_fixture("v11_history.json")).expect("valid V11 fixture JSON");
    assert!(!fixtures.is_empty());
    for fixture in fixtures {
        let mut model = Model::new(fixture.initial_blocks);
        let outcomes: Vec<_> = fixture
            .ops
            .iter()
            .map(|op| model.apply(op).label())
            .collect();
        let context = format!("{} ({})", fixture.id, fixture.contract);
        assert_eq!(outcomes, fixture.outcomes, "{context}: outcomes");
        assert_eq!(model.doc.live, fixture.live, "{context}: live");
        assert_eq!(
            model.doc.tombstones, fixture.tombstones,
            "{context}: tombstones"
        );
        assert_eq!(model.undo.len(), fixture.undo_len, "{context}: undo_len");
        assert_eq!(model.redo.len(), fixture.redo_len, "{context}: redo_len");
        if let Some(issued) = fixture.issued {
            assert_eq!(
                model.issued.into_iter().collect::<Vec<_>>(),
                issued,
                "{context}: issued"
            );
        }
    }
}
