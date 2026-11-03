//! V13 oracle: legacy import share groups, representatives and reference resolution.
//!
//! Contract: docs/design/v3-legacy-import-mapping.md §5 (share groups), §6 (references)
//! and §7 Q1 (one trash item per deleted legacy Work).
//! Body text and Markdown link rewriting are covered by example fixtures, not by this model.

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;

use crate::support::{Coverage, runner};

type WorkId = u8;
type BranchId = u8;
type RevisionId = u8;
type OccurrenceId = u8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Selector {
    Branch(BranchId),
    Pinned(RevisionId),
}

#[derive(Clone, Debug)]
struct Work {
    id: WorkId,
    deleted: bool,
}

#[derive(Clone, Debug)]
struct Branch {
    id: BranchId,
    work: WorkId,
    archived: bool,
    promoted: Option<u8>,
    created: u8,
}

#[derive(Clone, Debug)]
struct Revision {
    id: RevisionId,
    work: WorkId,
}

#[derive(Clone, Debug)]
struct Occurrence {
    id: OccurrenceId,
    work: WorkId,
    parent: Option<OccurrenceId>,
    order: u8,
    selector: Selector,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Endpoint {
    Work(WorkId),
    Revision(RevisionId),
}

#[derive(Clone, Debug)]
struct Legacy {
    works: Vec<Work>,
    branches: Vec<Branch>,
    revisions: Vec<Revision>,
    occurrences: Vec<Occurrence>,
    endpoints: Vec<Endpoint>,
}

/// Output identity keyed by legacy IDs, so permuted inputs are comparable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum NodeKey {
    Occurrence(OccurrenceId),
    WorkRoot(WorkId),
    RevisionRoot(RevisionId),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Block,
    Reference(NodeKey),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Resolution {
    Node(NodeKey),
    Missing,
}

#[derive(Debug, PartialEq, Eq)]
struct Imported {
    kind: BTreeMap<NodeKey, Kind>,
    parent: BTreeMap<NodeKey, Option<NodeKey>>,
    /// Deleted legacy Work → its own trash item (§7 Q1).
    trash: BTreeMap<NodeKey, WorkId>,
    resolved: Vec<Resolution>,
    ambiguous: BTreeSet<WorkId>,
}

type GroupKey = (WorkId, Selector);

fn groups(legacy: &Legacy) -> BTreeMap<GroupKey, Vec<&Occurrence>> {
    let mut groups: BTreeMap<GroupKey, Vec<&Occurrence>> = BTreeMap::new();
    for occurrence in &legacy.occurrences {
        groups
            .entry((occurrence.work, occurrence.selector))
            .or_default()
            .push(occurrence);
    }
    for members in groups.values_mut() {
        // Representative: parentless placement first, then orderKey, then occurrence id.
        members.sort_by_key(|o| (o.parent.is_some(), o.order, o.id));
    }
    groups
}

/// Branch priority for the primary group: unarchived, newest promotedAt (absent last),
/// createdAt, id. Pinned groups only when the Work has no Branch group, by revision id.
fn primary_group(legacy: &Legacy, keys: &[GroupKey]) -> Option<GroupKey> {
    let branch = |id: BranchId| legacy.branches.iter().find(|b| b.id == id);
    let branch_rank = |key: &GroupKey| match key.1 {
        Selector::Branch(id) => branch(id).map(|b| {
            (
                b.archived,
                b.promoted.is_none(),
                std::cmp::Reverse(b.promoted),
                b.created,
                b.id,
            )
        }),
        Selector::Pinned(_) => None,
    };
    let branch_groups = keys.iter().filter_map(|k| branch_rank(k).map(|r| (r, *k)));
    if let Some((_, key)) = branch_groups.min() {
        return Some(key);
    }
    keys.iter().copied().min_by_key(|k| match k.1 {
        Selector::Pinned(revision) => revision,
        Selector::Branch(id) => id,
    })
}

fn import(legacy: &Legacy, coverage: &Coverage) -> Imported {
    let groups = groups(legacy);
    let mut kind = BTreeMap::new();
    let mut parent = BTreeMap::new();
    let mut representative: BTreeMap<GroupKey, NodeKey> = BTreeMap::new();

    for (key, members) in &groups {
        let owner = NodeKey::Occurrence(members[0].id);
        representative.insert(*key, owner);
        if matches!(key.1, Selector::Pinned(_)) {
            coverage.hit("pinned-group");
        }
        for (index, occurrence) in members.iter().enumerate() {
            let node = NodeKey::Occurrence(occurrence.id);
            kind.insert(
                node,
                if index == 0 {
                    Kind::Block
                } else {
                    Kind::Reference(owner)
                },
            );
            if index > 0 {
                coverage.hit("reference");
            }
            parent.insert(node, occurrence.parent.map(NodeKey::Occurrence));
        }
    }

    for work in &legacy.works {
        if !legacy.occurrences.iter().any(|o| o.work == work.id) {
            coverage.hit("work-root");
            kind.insert(NodeKey::WorkRoot(work.id), Kind::Block);
            parent.insert(NodeKey::WorkRoot(work.id), None);
        }
    }

    let mut resolved = Vec::new();
    let mut ambiguous = BTreeSet::new();
    for endpoint in &legacy.endpoints {
        resolved.push(match *endpoint {
            Endpoint::Work(work) if legacy.works.iter().any(|w| w.id == work) => {
                let keys: Vec<GroupKey> = groups.keys().filter(|k| k.0 == work).copied().collect();
                if keys.len() > 1 {
                    coverage.hit("ambiguous");
                    ambiguous.insert(work);
                }
                match primary_group(legacy, &keys) {
                    Some(key) => Resolution::Node(representative[&key]),
                    None => Resolution::Node(NodeKey::WorkRoot(work)),
                }
            }
            Endpoint::Revision(revision) => {
                match legacy.revisions.iter().find(|r| r.id == revision) {
                    Some(found) => {
                        match representative.get(&(found.work, Selector::Pinned(revision))) {
                            Some(owner) => Resolution::Node(*owner),
                            None => {
                                coverage.hit("revision-root");
                                let root = NodeKey::RevisionRoot(revision);
                                kind.insert(root, Kind::Block);
                                parent.insert(root, None);
                                Resolution::Node(root)
                            }
                        }
                    }
                    None => {
                        coverage.hit("missing-revision");
                        Resolution::Missing
                    }
                }
            }
            Endpoint::Work(_) => {
                coverage.hit("missing-work");
                Resolution::Missing
            }
        });
    }

    let mut trash = BTreeMap::new();
    for work in legacy.works.iter().filter(|w| w.deleted) {
        coverage.hit("deleted");
        for node in kind.keys() {
            let owner = match node {
                NodeKey::Occurrence(id) => legacy
                    .occurrences
                    .iter()
                    .find(|o| o.id == *id)
                    .map(|o| o.work),
                NodeKey::WorkRoot(id) => Some(*id),
                NodeKey::RevisionRoot(id) => legacy
                    .revisions
                    .iter()
                    .find(|r| r.id == *id)
                    .map(|r| r.work),
            };
            if owner == Some(work.id) {
                trash.insert(*node, work.id);
            }
        }
    }

    Imported {
        kind,
        parent,
        trash,
        resolved,
        ambiguous,
    }
}

type RawBranch = (u8, bool, Option<u8>, u8);
type RawOccurrence = (u8, Option<u8>, u8, bool, u8);

/// Builds a consistent legacy graph: selectors belong to the occurrence's Work and
/// parents point at earlier occurrences, so the placement forest is acyclic.
fn normalize(
    works: Vec<bool>,
    branches: Vec<RawBranch>,
    revisions: Vec<u8>,
    occurrences: Vec<RawOccurrence>,
    endpoints: Vec<(bool, u8)>,
) -> Legacy {
    let count = works.len() as u8;
    let works: Vec<Work> = works
        .into_iter()
        .enumerate()
        .map(|(id, deleted)| Work {
            id: id as u8,
            deleted,
        })
        .collect();
    let branches: Vec<Branch> = branches
        .into_iter()
        .enumerate()
        .map(|(id, (work, archived, promoted, created))| Branch {
            id: id as u8,
            work: work % count,
            archived,
            promoted,
            created,
        })
        .collect();
    let revisions: Vec<Revision> = revisions
        .into_iter()
        .enumerate()
        .map(|(id, work)| Revision {
            id: id as u8,
            work: work % count,
        })
        .collect();
    let mut placed: Vec<Occurrence> = Vec::new();
    for (work, parent, order, pinned, pick) in occurrences {
        let work = work % count;
        let own_branches: Vec<u8> = branches
            .iter()
            .filter(|b| b.work == work)
            .map(|b| b.id)
            .collect();
        let own_revisions: Vec<u8> = revisions
            .iter()
            .filter(|r| r.work == work)
            .map(|r| r.id)
            .collect();
        let selector = match (pinned, own_branches.is_empty(), own_revisions.is_empty()) {
            (true, _, false) | (false, true, false) => {
                Selector::Pinned(own_revisions[usize::from(pick) % own_revisions.len()])
            }
            (_, false, _) => Selector::Branch(own_branches[usize::from(pick) % own_branches.len()]),
            (_, true, true) => continue,
        };
        let id = placed.len() as u8;
        let parent = parent.filter(|_| id > 0).map(|p| p % id);
        placed.push(Occurrence {
            id,
            work,
            parent,
            order,
            selector,
        });
    }
    // Endpoint ids range two past the real ones, so Missing references occur.
    let endpoints = endpoints
        .into_iter()
        .map(|(revision, id)| {
            if revision {
                Endpoint::Revision(id % (revisions.len() as u8 + 2))
            } else {
                Endpoint::Work(id % (count + 2))
            }
        })
        .collect();
    Legacy {
        works,
        branches,
        revisions,
        occurrences: placed,
        endpoints,
    }
}

fn legacy_strategy() -> impl Strategy<Value = Legacy> {
    (
        prop::collection::vec(any::<bool>(), 1..5),
        prop::collection::vec(
            (any::<u8>(), any::<bool>(), prop::option::of(0u8..4), 0u8..4),
            0..6,
        ),
        prop::collection::vec(any::<u8>(), 0..5),
        prop::collection::vec(
            (
                any::<u8>(),
                prop::option::of(any::<u8>()),
                0u8..3,
                any::<bool>(),
                any::<u8>(),
            ),
            0..12,
        ),
        prop::collection::vec((any::<bool>(), any::<u8>()), 0..8),
    )
        .prop_map(|(w, b, r, o, e)| normalize(w, b, r, o, e))
}

fn shuffled(legacy: Legacy) -> impl Strategy<Value = (Legacy, Legacy)> {
    let original = legacy.clone();
    (
        Just(legacy.works).prop_shuffle(),
        Just(legacy.branches).prop_shuffle(),
        Just(legacy.revisions).prop_shuffle(),
        Just(legacy.occurrences).prop_shuffle(),
    )
        .prop_map(move |(works, branches, revisions, occurrences)| {
            let permuted = Legacy {
                works,
                branches,
                revisions,
                occurrences,
                endpoints: original.endpoints.clone(),
            };
            (original.clone(), permuted)
        })
}

#[test]
fn share_groups_have_one_owner_and_references_never_chain() {
    let coverage = Coverage::default();
    runner(file!())
        .run(&legacy_strategy(), |legacy| {
            let out = import(&legacy, &coverage);
            let group_of = |id: OccurrenceId| {
                let o = legacy
                    .occurrences
                    .iter()
                    .find(|o| o.id == id)
                    .expect("occurrence");
                (o.work, o.selector)
            };
            for occurrence in &legacy.occurrences {
                let node = NodeKey::Occurrence(occurrence.id);
                // Every placement survives, with its own parent (independent child structure).
                prop_assert_eq!(
                    out.parent[&node],
                    occurrence.parent.map(NodeKey::Occurrence)
                );
                let owner = match out.kind[&node] {
                    Kind::Block => node,
                    Kind::Reference(target) => {
                        prop_assert_eq!(out.kind[&target], Kind::Block, "reference chain");
                        target
                    }
                };
                let NodeKey::Occurrence(owner_id) = owner else {
                    return Err(TestCaseError::fail("owner must be a placement"));
                };
                prop_assert_eq!(group_of(owner_id), (occurrence.work, occurrence.selector));
            }
            // Exactly one owner per group: same owner iff same (Work, selector).
            for a in &legacy.occurrences {
                for b in &legacy.occurrences {
                    let owner = |id| match out.kind[&NodeKey::Occurrence(id)] {
                        Kind::Block => NodeKey::Occurrence(id),
                        Kind::Reference(target) => target,
                    };
                    let same_group = (a.work, a.selector) == (b.work, b.selector);
                    prop_assert_eq!(owner(a.id) == owner(b.id), same_group);
                }
            }
            Ok(())
        })
        .expect("share-group property");
    coverage.require("share groups", &["reference", "pinned-group", "work-root"]);
}

#[test]
fn import_is_independent_of_legacy_row_order() {
    let coverage = Coverage::default();
    runner(file!())
        .run(
            &legacy_strategy().prop_flat_map(shuffled),
            |(original, permuted)| {
                prop_assert_eq!(import(&original, &coverage), import(&permuted, &coverage));
                Ok(())
            },
        )
        .expect("order-independence property");
    coverage.require("row order", &["reference", "ambiguous"]);
}

#[test]
fn references_resolve_or_stay_missing_without_redirection() {
    let coverage = Coverage::default();
    runner(file!())
        .run(&legacy_strategy(), |legacy| {
            let out = import(&legacy, &coverage);
            for (endpoint, resolution) in legacy.endpoints.iter().zip(&out.resolved) {
                match (*endpoint, *resolution) {
                    (Endpoint::Work(work), Resolution::Missing) => {
                        prop_assert!(!legacy.works.iter().any(|w| w.id == work));
                    }
                    (Endpoint::Revision(revision), Resolution::Missing) => {
                        prop_assert!(!legacy.revisions.iter().any(|r| r.id == revision));
                    }
                    (endpoint, Resolution::Node(node)) => {
                        // A resolved reference always lands on a body-owning Block of the same Work.
                        prop_assert_eq!(out.kind[&node], Kind::Block);
                        let work = match endpoint {
                            Endpoint::Work(work) => work,
                            Endpoint::Revision(revision) => {
                                legacy
                                    .revisions
                                    .iter()
                                    .find(|r| r.id == revision)
                                    .expect("revision")
                                    .work
                            }
                        };
                        let owner_work = match node {
                            NodeKey::Occurrence(id) => {
                                legacy
                                    .occurrences
                                    .iter()
                                    .find(|o| o.id == id)
                                    .expect("occurrence")
                                    .work
                            }
                            NodeKey::WorkRoot(id) => id,
                            NodeKey::RevisionRoot(id) => {
                                legacy
                                    .revisions
                                    .iter()
                                    .find(|r| r.id == id)
                                    .expect("revision")
                                    .work
                            }
                        };
                        prop_assert_eq!(owner_work, work, "reference redirected to another Work");
                        if let (Endpoint::Revision(revision), NodeKey::Occurrence(id)) =
                            (endpoint, node)
                        {
                            let o = legacy
                                .occurrences
                                .iter()
                                .find(|o| o.id == id)
                                .expect("occurrence");
                            prop_assert_eq!(o.selector, Selector::Pinned(revision));
                        }
                    }
                }
            }
            // ambiguous-primary is reported exactly for referenced Works with 2+ groups.
            for work in &legacy.works {
                let referenced = legacy.endpoints.contains(&Endpoint::Work(work.id));
                let group_count = groups(&legacy).keys().filter(|k| k.0 == work.id).count();
                prop_assert_eq!(
                    out.ambiguous.contains(&work.id),
                    referenced && group_count > 1
                );
            }
            Ok(())
        })
        .expect("reference-resolution property");
    coverage.require(
        "references",
        &[
            "missing-work",
            "missing-revision",
            "revision-root",
            "ambiguous",
            "work-root",
        ],
    );
}

#[test]
fn each_deleted_legacy_work_becomes_its_own_trash_item() {
    let coverage = Coverage::default();
    runner(file!())
        .run(&legacy_strategy(), |legacy| {
            let out = import(&legacy, &coverage);
            for (node, item) in &out.trash {
                prop_assert!(legacy.works.iter().any(|w| w.id == *item && w.deleted));
                prop_assert!(out.kind.contains_key(node));
            }
            for occurrence in &legacy.occurrences {
                let deleted = legacy
                    .works
                    .iter()
                    .any(|w| w.id == occurrence.work && w.deleted);
                let node = NodeKey::Occurrence(occurrence.id);
                prop_assert_eq!(
                    out.trash.get(&node).copied(),
                    deleted.then_some(occurrence.work)
                );
            }
            Ok(())
        })
        .expect("deleted-work property");
    coverage.require("deleted works", &["deleted"]);
}

#[test]
fn primary_group_prefers_unarchived_then_newest_promoted_branch() {
    let legacy = Legacy {
        works: vec![Work {
            id: 0,
            deleted: false,
        }],
        branches: vec![
            Branch {
                id: 0,
                work: 0,
                archived: true,
                promoted: Some(9),
                created: 0,
            },
            Branch {
                id: 1,
                work: 0,
                archived: false,
                promoted: None,
                created: 0,
            },
            Branch {
                id: 2,
                work: 0,
                archived: false,
                promoted: Some(1),
                created: 5,
            },
            Branch {
                id: 3,
                work: 0,
                archived: false,
                promoted: Some(3),
                created: 9,
            },
        ],
        revisions: vec![Revision { id: 0, work: 0 }],
        occurrences: (0..4)
            .map(|id| Occurrence {
                id,
                work: 0,
                parent: None,
                order: 0,
                selector: Selector::Branch(id),
            })
            .chain([Occurrence {
                id: 4,
                work: 0,
                parent: None,
                order: 0,
                selector: Selector::Pinned(0),
            }])
            .collect(),
        endpoints: vec![Endpoint::Work(0)],
    };
    let out = import(&legacy, &Coverage::default());
    assert_eq!(out.resolved, vec![Resolution::Node(NodeKey::Occurrence(3))]);
    assert!(out.ambiguous.contains(&0));
}
