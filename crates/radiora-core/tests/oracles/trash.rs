//! V12 oracle: independent trash items, restore placement and purge sets.
//!
//! Contract: v3-model-decisions.md「通常削除・復元・参照先削除の採用契約」.
//! Same rules as spikes/document-model-alloy/delete_sets.als, plus sibling order.
//! Reading of "位置の目印となる兄弟": the nearest preceding sibling at delete time
//! (or the start of the parent); if it is no longer a live child there, append.

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;
use serde::Deserialize;

use crate::support::{Coverage, max_ops, read_fixture, runner};

pub type BlockId = u32;
pub type ItemId = u32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Live,
    Trash(ItemId),
    Purged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Anchor {
    Start,
    After(BlockId),
}

#[derive(Clone, Debug)]
pub struct Item {
    pub root: BlockId,
    pub members: BTreeSet<BlockId>,
    parent: Option<BlockId>,
    anchor: Anchor,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefView {
    Live,
    TargetInTrash,
    Missing,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Deleted(ItemId),
    RestoredOriginal,
    RestoredAtEnd,
    RestoredAsRoot,
    RestoredIndependent,
    Purged,
    Rejected(&'static str),
}

#[derive(Clone, Debug)]
pub struct Model {
    /// Ordered children per parent; `None` is the list of document roots.
    pub children: BTreeMap<Option<BlockId>, Vec<BlockId>>,
    /// Current parent; a trashed root keeps its last parent for restore.
    pub parent: BTreeMap<BlockId, Option<BlockId>>,
    pub status: BTreeMap<BlockId, Status>,
    pub text: BTreeMap<BlockId, String>,
    pub references: BTreeMap<BlockId, BlockId>,
    pub items: BTreeMap<ItemId, Item>,
    next_item: ItemId,
}

impl Model {
    /// `placements` are `(block, parent)` in sibling order; `references` map a
    /// reference block to the owner it displays.
    pub fn new(
        placements: &[(BlockId, Option<BlockId>)],
        references: &[(BlockId, BlockId)],
    ) -> Self {
        let mut children: BTreeMap<Option<BlockId>, Vec<BlockId>> = BTreeMap::new();
        let mut parent = BTreeMap::new();
        for (block, block_parent) in placements {
            children.entry(*block_parent).or_default().push(*block);
            parent.insert(*block, *block_parent);
        }
        let status = parent.keys().map(|block| (*block, Status::Live)).collect();
        let text = parent
            .keys()
            .map(|block| (*block, format!("body-{block}")))
            .collect();
        Self {
            children,
            parent,
            status,
            text,
            references: references.iter().copied().collect(),
            items: BTreeMap::new(),
            next_item: 1,
        }
    }

    pub fn is_live(&self, block: BlockId) -> bool {
        self.status.get(&block) == Some(&Status::Live)
    }

    fn kids(&self, block: Option<BlockId>) -> &[BlockId] {
        self.children.get(&block).map_or(&[], Vec::as_slice)
    }

    fn live_subtree(&self, root: BlockId) -> BTreeSet<BlockId> {
        let mut found = BTreeSet::new();
        let mut stack = vec![root];
        while let Some(block) = stack.pop() {
            if self.is_live(block) && found.insert(block) {
                stack.extend_from_slice(self.kids(Some(block)));
            }
        }
        found
    }

    pub fn delete(&mut self, block: BlockId) -> Outcome {
        if !self.is_live(block) {
            return Outcome::Rejected("not_live");
        }
        let members = self.live_subtree(block);
        let block_parent = self.parent[&block];
        let siblings = self.children.entry(block_parent).or_default();
        let index = siblings
            .iter()
            .position(|b| *b == block)
            .expect("live block is placed");
        let anchor = if index == 0 {
            Anchor::Start
        } else {
            Anchor::After(siblings[index - 1])
        };
        siblings.remove(index);
        let item = self.next_item;
        self.next_item += 1;
        for member in &members {
            self.status.insert(*member, Status::Trash(item));
        }
        self.items.insert(
            item,
            Item {
                root: block,
                members,
                parent: block_parent,
                anchor,
            },
        );
        Outcome::Deleted(item)
    }

    pub fn restore(&mut self, item_id: ItemId, confirmed: bool) -> Outcome {
        let Some(item) = self.items.get(&item_id).cloned() else {
            return Outcome::Rejected("no_item");
        };
        let outcome = match item.parent {
            Some(parent) if !self.is_live(parent) => {
                if !confirmed {
                    return Outcome::Rejected("needs_confirmation");
                }
                // Never re-attach to an unavailable or unrelated parent.
                self.parent.insert(item.root, None);
                self.children.entry(None).or_default().push(item.root);
                Outcome::RestoredIndependent
            }
            parent => {
                let siblings = self.children.entry(parent).or_default();
                let position = match item.anchor {
                    Anchor::Start => Some(0),
                    Anchor::After(anchor) => siblings
                        .iter()
                        .position(|b| *b == anchor)
                        .map(|index| index + 1),
                };
                match position {
                    Some(index) => {
                        siblings.insert(index, item.root);
                        if parent.is_none() {
                            Outcome::RestoredAsRoot
                        } else {
                            Outcome::RestoredOriginal
                        }
                    }
                    None => {
                        siblings.push(item.root);
                        if parent.is_none() {
                            Outcome::RestoredAsRoot
                        } else {
                            Outcome::RestoredAtEnd
                        }
                    }
                }
            }
        };
        for member in &item.members {
            self.status.insert(*member, Status::Live);
        }
        self.items.remove(&item_id);
        outcome
    }

    pub fn purge(&mut self, item_id: ItemId) -> Outcome {
        let Some(item) = self.items.remove(&item_id) else {
            return Outcome::Rejected("no_item");
        };
        for member in &item.members {
            self.status.insert(*member, Status::Purged);
            self.text.remove(member);
        }
        Outcome::Purged
    }

    pub fn reference_view(&self, reference: BlockId) -> Option<RefView> {
        let target = self.references.get(&reference)?;
        Some(match self.status.get(target) {
            Some(Status::Live) => RefView::Live,
            Some(Status::Trash(_)) => RefView::TargetInTrash,
            Some(Status::Purged) | None => RefView::Missing,
        })
    }

    /// Ordered live outline, for order/round-trip comparisons.
    pub fn outline(&self) -> Vec<(Option<BlockId>, Vec<BlockId>)> {
        self.children
            .iter()
            .filter(|(parent, _)| parent.is_none_or(|p| self.is_live(p)))
            .map(|(parent, kids)| {
                (
                    *parent,
                    kids.iter()
                        .copied()
                        .filter(|b| self.is_live(*b))
                        .collect::<Vec<_>>(),
                )
            })
            .filter(|(_, kids)| !kids.is_empty())
            .collect()
    }

    pub fn check_invariants(&self) -> Result<(), String> {
        let mut seen = BTreeSet::new();
        for (id, item) in &self.items {
            if !item.members.contains(&item.root) {
                return Err(format!("item {id} lost its root"));
            }
            for member in &item.members {
                if !seen.insert(*member) {
                    return Err(format!("block {member} belongs to two trash items"));
                }
                if self.status.get(member) != Some(&Status::Trash(*id)) {
                    return Err(format!("block {member} status disagrees with item {id}"));
                }
            }
        }
        for (block, status) in &self.status {
            if let Status::Trash(id) = status
                && !self
                    .items
                    .get(id)
                    .is_some_and(|item| item.members.contains(block))
            {
                return Err(format!("trashed block {block} has no item"));
            }
            if *status == Status::Purged && self.text.contains_key(block) {
                return Err(format!("purged block {block} still exposes text"));
            }
            if *status == Status::Live {
                let parent = self.parent[block];
                if parent.is_some_and(|p| !self.is_live(p)) {
                    return Err(format!("live block {block} hangs under a non-live parent"));
                }
                let count = self.kids(parent).iter().filter(|b| *b == block).count();
                if count != 1 {
                    return Err(format!("live block {block} placed {count} times"));
                }
            }
        }
        Ok(())
    }
}

// ---- Generators ----

#[derive(Clone, Debug)]
pub struct Forest {
    placements: Vec<(BlockId, Option<BlockId>)>,
    references: Vec<(BlockId, BlockId)>,
}

/// Random forest: each block's parent is an earlier block or none (acyclic by construction).
fn forest() -> impl Strategy<Value = Forest> {
    (2usize..=9)
        .prop_flat_map(|n| {
            let parents: Vec<_> = (0..n)
                .map(|index| {
                    if index == 0 {
                        Just(None::<BlockId>).boxed()
                    } else {
                        prop_oneof![1 => Just(None::<BlockId>), 4 => (1..=index as BlockId).prop_map(Some)]
                            .boxed()
                    }
                })
                .collect();
            (parents, prop::collection::vec(any::<prop::sample::Index>(), 0..3), Just(n))
        })
        .prop_map(|(parents, picks, n)| {
            let placements: Vec<_> =
                parents.into_iter().enumerate().map(|(index, p)| (index as BlockId + 1, p)).collect();
            // A reference block displays some other block's body.
            let references = picks
                .chunks(2)
                .filter(|pair| pair.len() == 2)
                .map(|pair| (pair[0].index(n) as BlockId + 1, pair[1].index(n) as BlockId + 1))
                .filter(|(reference, target)| reference != target)
                .collect();
            Forest { placements, references }
        })
}

#[derive(Clone, Debug)]
enum Op {
    Delete(prop::sample::Index),
    Restore(prop::sample::Index, bool),
    /// Restores the oldest item, so anchors removed by later deletes are reached.
    RestoreOldest(bool),
    /// Deletes the sibling the newest item would be restored after.
    DeleteAnchorOfNewest,
    Purge(prop::sample::Index),
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => any::<prop::sample::Index>().prop_map(Op::Delete),
        2 => (any::<prop::sample::Index>(), prop::bool::weighted(0.7)).prop_map(|(i, c)| Op::Restore(i, c)),
        2 => prop::bool::weighted(0.7).prop_map(Op::RestoreOldest),
        1 => Just(Op::DeleteAnchorOfNewest),
        1 => any::<prop::sample::Index>().prop_map(Op::Purge),
    ]
}

fn scenario() -> impl Strategy<Value = (Forest, Vec<Op>)> {
    (forest(), prop::collection::vec(op(), 0..=max_ops()))
}

fn pick<T: Copy>(values: &[T], index: &prop::sample::Index) -> Option<T> {
    (!values.is_empty()).then(|| values[index.index(values.len())])
}

// ---- Properties ----

#[test]
fn every_operation_keeps_items_independent() {
    let coverage = Coverage::default();
    runner(file!())
        .run(&scenario(), |(forest, ops)| {
            let mut model = Model::new(&forest.placements, &forest.references);
            for op in &ops {
                let before = model.clone();
                match op {
                    Op::Delete(_) | Op::DeleteAnchorOfNewest => {
                        let block = match op {
                            Op::Delete(index) => {
                                let blocks: Vec<_> = model.status.keys().copied().collect();
                                pick(&blocks, index)
                            }
                            _ => model
                                .items
                                .values()
                                .last()
                                .and_then(|item| match item.anchor {
                                    Anchor::After(anchor) => Some(anchor),
                                    Anchor::Start => None,
                                }),
                        };
                        let Some(block) = block else { continue };
                        let subtree = model.live_subtree(block);
                        match model.delete(block) {
                            Outcome::Deleted(item) => {
                                coverage.hit("delete");
                                // Exactly the live subtree; never via references.
                                let members = &model.items[&item].members;
                                prop_assert_eq!(members, &subtree);
                                // Independent of live_subtree: only previously live blocks,
                                // never a member of an earlier trash item.
                                prop_assert!(members.iter().all(|b| before.is_live(*b)));
                                for earlier in before.items.values() {
                                    prop_assert!(earlier.members.is_disjoint(members));
                                }
                                for (reference, _) in &forest.references {
                                    if before.is_live(*reference) && !subtree.contains(reference) {
                                        prop_assert!(model.is_live(*reference));
                                    }
                                }
                                if before
                                    .items
                                    .values()
                                    .any(|i| i.parent.is_some_and(|p| subtree.contains(&p)))
                                {
                                    coverage.hit("delete_over_earlier_item");
                                }
                            }
                            other => {
                                coverage.hit("delete_rejected");
                                prop_assert_eq!(other, Outcome::Rejected("not_live"));
                            }
                        }
                    }
                    Op::Restore(_, confirmed) | Op::RestoreOldest(confirmed) => {
                        let items: Vec<_> = model.items.keys().copied().collect();
                        let chosen = match op {
                            Op::Restore(index, _) => pick(&items, index),
                            _ => items.first().copied(),
                        };
                        let Some(item) = chosen else { continue };
                        let members = model.items[&item].members.clone();
                        let outcome = model.restore(item, *confirmed);
                        coverage.hit(match outcome {
                            Outcome::RestoredOriginal => "restore_original",
                            Outcome::RestoredAtEnd => "restore_end",
                            Outcome::RestoredAsRoot => "restore_root",
                            Outcome::RestoredIndependent => "restore_independent",
                            _ => "restore_unconfirmed",
                        });
                        if outcome == Outcome::Rejected("needs_confirmation") {
                            prop_assert!(!confirmed);
                            continue;
                        }
                        // Only this item's members come back; other items stay in trash.
                        for (block, status) in &before.status {
                            let expected = if members.contains(block) {
                                Status::Live
                            } else {
                                *status
                            };
                            prop_assert_eq!(model.status[block], expected);
                        }
                    }
                    Op::Purge(index) => {
                        let items: Vec<_> = model.items.keys().copied().collect();
                        let Some(item) = pick(&items, index) else {
                            continue;
                        };
                        let members = model.items[&item].members.clone();
                        prop_assert_eq!(model.purge(item), Outcome::Purged);
                        coverage.hit("purge");
                        let purged_now: BTreeSet<_> = model
                            .status
                            .iter()
                            .filter(|(b, s)| {
                                **s == Status::Purged && before.status[*b] != Status::Purged
                            })
                            .map(|(b, _)| *b)
                            .collect();
                        prop_assert_eq!(purged_now, members);
                        prop_assert_eq!(model.items.len(), before.items.len() - 1);
                    }
                }
                if let Err(message) = model.check_invariants() {
                    return Err(TestCaseError::fail(message));
                }
                for (reference, _) in &forest.references {
                    match model.reference_view(*reference) {
                        Some(RefView::TargetInTrash) => coverage.hit("ref_target_in_trash"),
                        Some(RefView::Missing) => coverage.hit("ref_missing"),
                        _ => {}
                    }
                }
            }
            Ok(())
        })
        .unwrap();
    coverage.require(
        "V12 items",
        &[
            "delete",
            "delete_rejected",
            "delete_over_earlier_item",
            "restore_original",
            "restore_end",
            "restore_root",
            "restore_independent",
            "restore_unconfirmed",
            "purge",
            "ref_target_in_trash",
            "ref_missing",
        ],
    );
}

#[test]
fn delete_then_restore_round_trips_order_and_structure() {
    let case = (forest(), any::<prop::sample::Index>());
    runner(file!())
        .run(&case, |(forest, index)| {
            let mut model = Model::new(&forest.placements, &forest.references);
            let blocks: Vec<_> = model.status.keys().copied().collect();
            let block = blocks[index.index(blocks.len())];
            let outline = model.outline();
            let Outcome::Deleted(item) = model.delete(block) else {
                return Err(TestCaseError::fail("live block must be deletable"));
            };
            let restored = model.restore(item, false);
            prop_assert!(matches!(
                restored,
                Outcome::RestoredOriginal | Outcome::RestoredAsRoot
            ));
            prop_assert_eq!(model.outline(), outline);
            prop_assert!(model.items.is_empty());
            Ok(())
        })
        .unwrap();
}

// ---- Shared JSON fixtures (Rust/TS) ----

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum FixtureOp {
    Delete { block: BlockId },
    Restore { item: ItemId, confirmed: bool },
    Purge { item: ItemId },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fixture {
    id: String,
    contract: String,
    placements: Vec<(BlockId, Option<BlockId>)>,
    #[serde(default)]
    references: Vec<(BlockId, BlockId)>,
    ops: Vec<FixtureOp>,
    outcomes: Vec<String>,
    outline: Vec<(Option<BlockId>, Vec<BlockId>)>,
    trash: BTreeMap<ItemId, Vec<BlockId>>,
    purged: Vec<BlockId>,
    #[serde(default)]
    reference_views: BTreeMap<BlockId, String>,
}

fn label(outcome: &Outcome) -> String {
    match outcome {
        Outcome::Deleted(item) => format!("deleted:{item}"),
        Outcome::RestoredOriginal => "restored_original".into(),
        Outcome::RestoredAtEnd => "restored_at_end".into(),
        Outcome::RestoredAsRoot => "restored_as_root".into(),
        Outcome::RestoredIndependent => "restored_independent".into(),
        Outcome::Purged => "purged".into(),
        Outcome::Rejected(reason) => format!("rejected:{reason}"),
    }
}

#[test]
fn shared_fixtures_match_the_contract() {
    let fixtures: Vec<Fixture> =
        serde_json::from_str(&read_fixture("v12_trash.json")).expect("valid V12 fixture JSON");
    assert!(!fixtures.is_empty());
    for fixture in fixtures {
        let context = format!("{} ({})", fixture.id, fixture.contract);
        let mut model = Model::new(&fixture.placements, &fixture.references);
        let outcomes: Vec<_> = fixture
            .ops
            .iter()
            .map(|op| {
                let outcome = match op {
                    FixtureOp::Delete { block } => model.delete(*block),
                    FixtureOp::Restore { item, confirmed } => model.restore(*item, *confirmed),
                    FixtureOp::Purge { item } => model.purge(*item),
                };
                model
                    .check_invariants()
                    .unwrap_or_else(|e| panic!("{context}: {e}"));
                label(&outcome)
            })
            .collect();
        assert_eq!(outcomes, fixture.outcomes, "{context}: outcomes");
        assert_eq!(model.outline(), fixture.outline, "{context}: outline");
        let trash: BTreeMap<_, _> = model
            .items
            .iter()
            .map(|(id, item)| (*id, item.members.iter().copied().collect::<Vec<_>>()))
            .collect();
        assert_eq!(trash, fixture.trash, "{context}: trash items");
        let purged: Vec<_> = model
            .status
            .iter()
            .filter(|(_, s)| **s == Status::Purged)
            .map(|(b, _)| *b)
            .collect();
        assert_eq!(purged, fixture.purged, "{context}: purged");
        for (reference, expected) in &fixture.reference_views {
            let view = format!(
                "{:?}",
                model.reference_view(*reference).expect("known reference")
            );
            assert_eq!(&view, expected, "{context}: reference {reference}");
        }
    }
}
