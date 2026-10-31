//! V03 oracle: duplicate issues new IDs and remaps only references inside the copy set.
//!
//! Contract: v3-model-decisions.md「参照chain・コピー時の参照対応の採用契約」.
//! Move/cut keep logical IDs; they are covered by the trash/history oracles' ID checks.

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;
use serde::Deserialize;

use crate::support::{read_fixture, runner};

pub type BlockId = u32;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outline {
    pub children: BTreeMap<Option<BlockId>, Vec<BlockId>>,
    /// Reference item → the owner block whose body it displays.
    pub references: BTreeMap<BlockId, BlockId>,
    /// Internal links written in a block's body.
    pub links: BTreeMap<BlockId, BTreeSet<BlockId>>,
    pub issued: BTreeSet<BlockId>,
}

impl Outline {
    pub fn new(
        placements: &[(BlockId, Option<BlockId>)],
        references: &[(BlockId, BlockId)],
        links: &[(BlockId, BlockId)],
    ) -> Self {
        let mut children: BTreeMap<Option<BlockId>, Vec<BlockId>> = BTreeMap::new();
        for (block, parent) in placements {
            children.entry(*parent).or_default().push(*block);
        }
        let mut link_map: BTreeMap<BlockId, BTreeSet<BlockId>> = BTreeMap::new();
        for (from, to) in links {
            link_map.entry(*from).or_default().insert(*to);
        }
        Self {
            children,
            references: references.iter().copied().collect(),
            links: link_map,
            issued: placements.iter().map(|(block, _)| *block).collect(),
        }
    }

    fn subtree(&self, root: BlockId) -> Vec<BlockId> {
        let mut order = vec![root];
        let mut index = 0;
        while index < order.len() {
            if let Some(kids) = self.children.get(&Some(order[index])) {
                order.extend(kids.iter().copied());
            }
            index += 1;
        }
        order
    }

    /// Copies the subtrees of `roots` (in order) to the end of `target`.
    /// Returns the original → copy mapping.
    pub fn duplicate(
        &mut self,
        roots: &[BlockId],
        target: Option<BlockId>,
    ) -> BTreeMap<BlockId, BlockId> {
        let copy_set: Vec<BlockId> = {
            let mut seen = BTreeSet::new();
            roots
                .iter()
                .flat_map(|r| self.subtree(*r))
                .filter(|b| seen.insert(*b))
                .collect()
        };
        // Fresh IDs come after every issued ID, so a released ID is never reused.
        let first = self.issued.last().copied().unwrap_or(0) + 1;
        let mapping: BTreeMap<_, _> = copy_set.iter().copied().zip(first..).collect();
        self.issued.extend(mapping.values().copied());
        let remap = |block: BlockId| mapping.get(&block).copied().unwrap_or(block);
        let top: BTreeSet<_> = roots
            .iter()
            .filter(|r| {
                !roots
                    .iter()
                    .any(|o| o != *r && self.subtree(*o).contains(r))
            })
            .collect();
        let mut new_children: Vec<(Option<BlockId>, Vec<BlockId>)> = Vec::new();
        new_children.push((
            target,
            roots
                .iter()
                .filter(|r| top.contains(r))
                .map(|r| remap(*r))
                .collect(),
        ));
        for block in &copy_set {
            if let Some(kids) = self.children.get(&Some(*block)) {
                new_children.push((
                    Some(remap(*block)),
                    kids.iter().map(|k| remap(*k)).collect(),
                ));
            }
        }
        for (parent, kids) in new_children {
            self.children.entry(parent).or_default().extend(kids);
        }
        for block in &copy_set {
            if let Some(owner) = self.references.get(block).copied() {
                self.references.insert(remap(*block), remap(owner));
            }
            if let Some(targets) = self.links.get(block).cloned() {
                self.links
                    .insert(remap(*block), targets.into_iter().map(remap).collect());
            }
        }
        mapping
    }
}

// ---- Properties ----

fn scenario() -> impl Strategy<Value = (Outline, Vec<BlockId>)> {
    (2usize..=8)
        .prop_flat_map(|n| {
            let parents: Vec<_> = (0..n)
                .map(|i| {
                    if i == 0 {
                        Just(None::<BlockId>).boxed()
                    } else {
                        prop_oneof![1 => Just(None::<BlockId>), 3 => (1..=i as BlockId).prop_map(Some)].boxed()
                    }
                })
                .collect();
            let pairs = prop::collection::vec((1..=n as BlockId, 1..=n as BlockId), 0..4);
            let roots = prop::collection::vec(1..=n as BlockId, 1..3);
            (parents, pairs.clone(), pairs, roots)
        })
        .prop_map(|(parents, references, links, roots)| {
            let placements: Vec<_> =
                parents.into_iter().enumerate().map(|(i, p)| (i as BlockId + 1, p)).collect();
            let references: Vec<_> = references.into_iter().filter(|(r, o)| r != o).collect();
            (Outline::new(&placements, &references, &links), roots)
        })
}

#[test]
fn duplicate_keeps_originals_and_remaps_only_inside_the_copy_set() {
    runner(file!())
        .run(&scenario(), |(outline, roots)| {
            let before = outline.clone();
            let mut after = outline;
            let mapping = after.duplicate(&roots, None);
            // New IDs are fresh and never collide with an issued ID.
            let copies: BTreeSet<_> = mapping.values().copied().collect();
            prop_assert_eq!(copies.len(), mapping.len());
            prop_assert!(copies.is_disjoint(&before.issued));
            // Originals keep their placement, references and links.
            for (parent, kids) in &before.children {
                prop_assert!(after.children[parent].starts_with(kids));
            }
            for (reference, owner) in &before.references {
                prop_assert_eq!(after.references.get(reference), Some(owner));
            }
            // Inside → copy, outside → original target (independent recomputation).
            for (original, copy) in &mapping {
                if let Some(owner) = before.references.get(original) {
                    let expected = mapping.get(owner).unwrap_or(owner);
                    prop_assert_eq!(after.references.get(copy), Some(expected));
                }
                let expected_links: BTreeSet<_> = before
                    .links
                    .get(original)
                    .into_iter()
                    .flatten()
                    .map(|t| *mapping.get(t).unwrap_or(t))
                    .collect();
                let actual_links = after.links.get(copy).cloned().unwrap_or_default();
                prop_assert_eq!(actual_links, expected_links);
                // The copy mirrors the original child order.
                let kids: Vec<_> = before
                    .children
                    .get(&Some(*original))
                    .into_iter()
                    .flatten()
                    .map(|k| mapping[k])
                    .collect();
                let copy_kids = after
                    .children
                    .get(&Some(*copy))
                    .cloned()
                    .unwrap_or_default();
                prop_assert_eq!(copy_kids, kids);
            }
            Ok(())
        })
        .unwrap();
}

// ---- Shared JSON fixtures (Rust/TS) ----

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fixture {
    id: String,
    contract: String,
    placements: Vec<(BlockId, Option<BlockId>)>,
    #[serde(default)]
    references: Vec<(BlockId, BlockId)>,
    #[serde(default)]
    links: Vec<(BlockId, BlockId)>,
    duplicate: Vec<BlockId>,
    target: Option<BlockId>,
    mapping: BTreeMap<BlockId, BlockId>,
    expected_references: BTreeMap<BlockId, BlockId>,
    #[serde(default)]
    expected_links: BTreeMap<BlockId, Vec<BlockId>>,
}

#[test]
fn shared_fixtures_match_the_contract() {
    let fixtures: Vec<Fixture> =
        serde_json::from_str(&read_fixture("v03_duplicate.json")).expect("valid V03 fixture JSON");
    assert!(!fixtures.is_empty());
    for fixture in fixtures {
        let context = format!("{} ({})", fixture.id, fixture.contract);
        let mut outline = Outline::new(&fixture.placements, &fixture.references, &fixture.links);
        let mapping = outline.duplicate(&fixture.duplicate, fixture.target);
        assert_eq!(mapping, fixture.mapping, "{context}: mapping");
        assert_eq!(
            outline.references, fixture.expected_references,
            "{context}: references"
        );
        let links: BTreeMap<_, _> = outline
            .links
            .iter()
            .map(|(from, targets)| (*from, targets.iter().copied().collect::<Vec<_>>()))
            .collect();
        assert_eq!(links, fixture.expected_links, "{context}: links");
    }
}
