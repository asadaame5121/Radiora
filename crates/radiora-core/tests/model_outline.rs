//! Outline structure contracts (#381): membership, boundary-preserving edits, extract/move,
//! duplicate, and the trash lifecycle.
use proptest::prelude::*;
use radiora_core::model::*;
use std::collections::{BTreeMap, BTreeSet};
use uuid::{Builder, Variant, Version};

fn v7_bytes(seed: u32, tag: u8) -> [u8; 16] {
    let mut bytes = [tag; 16];
    bytes[..4].copy_from_slice(&seed.to_be_bytes());
    bytes
}
fn id(seed: u32) -> BlockId {
    let uuid = Builder::from_random_bytes(v7_bytes(seed, 0xB0))
        .with_version(Version::SortRand)
        .with_variant(Variant::RFC4122)
        .into_uuid();
    BlockId::from_uuid(uuid).unwrap()
}
fn entry(seed: u32) -> TrashEntryId {
    let uuid = Builder::from_random_bytes(v7_bytes(seed, 0xE0))
        .with_version(Version::SortRand)
        .with_variant(Variant::RFC4122)
        .into_uuid();
    TrashEntryId::from_uuid(uuid).unwrap()
}
fn topic(root: u32) -> Option<Membership> {
    Some(Membership::Topic { root: id(root) })
}
fn ids(seeds: &[u32]) -> Vec<BlockId> {
    seeds.iter().map(|seed| id(*seed)).collect()
}

/// Document 1 with children 2, 3 (3 has child 4) and document 10 with child 11.
fn sample() -> Outline {
    let mut outline = Outline::new();
    outline.create_document(id(1)).unwrap();
    outline.create_first_child(id(1), id(2)).unwrap();
    outline.insert_after(id(2), id(3)).unwrap();
    outline.create_first_child(id(1), id(99)).unwrap();
    outline.move_block(id(99), id(3), 0).unwrap();
    outline.extract_as_document(id(99)).unwrap();
    outline.create_document(id(10)).unwrap();
    outline.create_first_child(id(10), id(11)).unwrap();
    outline.create_first_child(id(1), id(4)).unwrap();
    outline.move_block(id(4), id(3), 0).unwrap();
    outline.validate().unwrap();
    outline
}

#[test]
fn root_enter_creates_the_first_child() {
    let mut outline = sample();
    outline.create_first_child(id(1), id(5)).unwrap();
    assert_eq!(outline.children(id(1)), ids(&[5, 2, 3]));
    assert_eq!(outline.membership(id(5)), topic(1));
    assert_eq!(
        outline.create_first_child(id(2), id(6)),
        Err(StructureError::NotDocumentRoot { id: id(2) })
    );
    assert_eq!(
        outline.insert_after(id(1), id(6)),
        Err(StructureError::IsDocumentRoot { id: id(1) })
    );
}

#[test]
fn indent_and_outdent_stay_inside_the_document() {
    let mut outline = sample();
    assert_eq!(
        outline.indent(id(2)),
        Err(StructureError::NoPreviousSibling { id: id(2) })
    );
    outline.indent(id(3)).unwrap();
    assert_eq!(outline.children(id(2)), ids(&[3]));
    outline.outdent(id(3)).unwrap();
    assert_eq!(outline.children(id(1)), ids(&[2, 3]));
    assert_eq!(
        outline.outdent(id(3)),
        Err(StructureError::ParentIsDocumentRoot { id: id(3) })
    );
    assert_eq!(
        outline.indent(id(10)),
        Err(StructureError::IsDocumentRoot { id: id(10) })
    );
}

#[test]
fn extract_and_cross_document_move_keep_ids_and_descendants() {
    let mut outline = sample();
    outline.move_block(id(3), id(11), 0).unwrap();
    assert_eq!(outline.membership(id(4)), topic(10));
    assert_eq!(outline.children(id(3)), ids(&[4]));
    outline.extract_as_document(id(3)).unwrap();
    assert_eq!(outline.membership(id(4)), topic(3));
    assert!(outline.documents().contains(&id(3)));
    assert_eq!(
        outline.move_block(id(3), id(4), 0),
        Err(StructureError::IsDocumentRoot { id: id(3) })
    );
    assert_eq!(
        outline.move_block(id(2), id(2), 0),
        Err(StructureError::IntoOwnSubtree {
            moved: id(2),
            target: id(2)
        })
    );
}

#[test]
fn duplicate_issues_new_ids_and_remaps_references() {
    let mut outline = sample();
    let mut next = 500;
    let mapping = outline
        .duplicate(id(3), || {
            next += 1;
            id(next)
        })
        .unwrap();
    assert_eq!(
        mapping,
        BTreeMap::from([(id(3), id(501)), (id(4), id(502))])
    );
    assert_eq!(outline.children(id(1)), ids(&[2, 3, 501]));
    assert_eq!(outline.children(id(501)), ids(&[502]));
    outline.validate().unwrap();
    // B→C copied together becomes B'→C'; a target outside the copy is kept.
    let inside = BlockContent::Reference(ReferenceItem::from_persisted(id(4), None));
    let outside = BlockContent::Reference(ReferenceItem::from_persisted(id(2), None));
    let copied_target = |content: BlockContent| match content.copied(&mapping) {
        BlockContent::Reference(reference) => reference.target(),
        BlockContent::Owned(_) => unreachable!(),
    };
    assert_eq!(copied_target(inside), id(502));
    assert_eq!(copied_target(outside), id(2));
    // Issuing an existing ID is rejected without changing the outline.
    let before = outline.clone();
    assert_eq!(
        outline.duplicate(id(2), || id(1)),
        Err(StructureError::AlreadyIssued { id: id(1) })
    );
    assert_eq!(outline, before);
}

/// Delete C (4), then its parent B (3): B's entry holds B only, C keeps its own entry.
#[test]
fn trash_restore_and_purge_follow_entry_boundaries() {
    let mut outline = sample();
    outline.trash(id(4), entry(1)).unwrap();
    let b_entry = outline.trash(id(3), entry(2)).unwrap().clone();
    assert_eq!(b_entry.newly_deleted(), &BTreeSet::from([id(3)]));
    assert_eq!(outline.presence(id(4)), Some(Presence::Trashed(entry(1))));
    assert_eq!(
        outline.move_block(id(4), id(2), 0),
        Err(StructureError::InTrash { id: id(4) })
    );
    // Restoring C while B is in the trash needs confirmation and never restores B.
    let before = outline.clone();
    assert_eq!(
        outline.restore(entry(1), false),
        Err(StructureError::NeedsConfirmation { entry: entry(1) })
    );
    assert_eq!(outline, before);
    // Purge B only; C survives and its original parent is gone.
    assert_eq!(outline.purge(&[entry(2)]).unwrap(), BTreeSet::from([id(3)]));
    assert!(outline.is_retired(id(3)));
    assert_eq!(
        outline.create_document(id(3)),
        Err(StructureError::AlreadyIssued { id: id(3) })
    );
    assert_eq!(
        outline.restore(entry(1), true).unwrap(),
        RestorePlan::AsNewDocumentAfterConfirmation
    );
    assert_eq!(outline.membership(id(4)), topic(4));
    outline.validate().unwrap();
}

#[test]
fn restore_falls_back_to_the_end_of_the_parent_when_the_anchor_moved() {
    let mut outline = sample();
    outline.create_first_child(id(1), id(5)).unwrap(); // children: 5, 2, 3
    outline.trash(id(2), entry(1)).unwrap();
    outline.move_block(id(5), id(11), 0).unwrap();
    assert_eq!(
        outline.restore(entry(1), false).unwrap(),
        RestorePlan::AtEndOfParent { parent: id(1) }
    );
    assert_eq!(outline.children(id(1)), ids(&[3, 2]));
}

#[derive(Debug, Clone)]
enum Op {
    CreateDocument,
    CreateFirstChild(usize),
    InsertAfter(usize),
    Indent(usize),
    Outdent(usize),
    Extract(usize),
    Move(usize, usize, usize),
    Duplicate(usize),
    Trash(usize),
    Restore(usize, bool),
    Purge(usize),
}

fn op() -> impl Strategy<Value = Op> {
    let pick = 0usize..64;
    prop_oneof![
        Just(Op::CreateDocument),
        pick.clone().prop_map(Op::CreateFirstChild),
        pick.clone().prop_map(Op::InsertAfter),
        pick.clone().prop_map(Op::Indent),
        pick.clone().prop_map(Op::Outdent),
        pick.clone().prop_map(Op::Extract),
        (pick.clone(), pick.clone(), 0usize..4).prop_map(|(a, b, i)| Op::Move(a, b, i)),
        pick.clone().prop_map(Op::Duplicate),
        pick.clone().prop_map(Op::Trash),
        (pick.clone(), any::<bool>()).prop_map(|(e, c)| Op::Restore(e, c)),
        pick.prop_map(Op::Purge),
    ]
}

fn memberships(outline: &Outline) -> BTreeMap<BlockId, Option<Membership>> {
    outline
        .block_ids()
        .map(|block| (block, outline.membership(block)))
        .collect()
}

/// Structure without document order, which is not a product decision.
fn shape(outline: &Outline) -> BTreeMap<BlockId, (Option<Slot>, Vec<BlockId>)> {
    outline
        .block_ids()
        .map(|block| {
            (
                block,
                (outline.slot(block), outline.children(block).to_vec()),
            )
        })
        .collect()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]
    #[test]
    fn random_edit_sequences_keep_outline_invariants(ops in prop::collection::vec(op(), 1..60)) {
        let mut outline = Outline::new();
        let mut issued: Vec<BlockId> = Vec::new();
        let mut entries: Vec<TrashEntryId> = Vec::new();
        let mut counter = 0u32;
        let mut fresh = || { counter += 1; id(counter) };
        for op in ops {
            let pick = |i: usize| (!issued.is_empty()).then(|| issued[i % issued.len()]);
            let before = outline.clone();
            let before_membership = memberships(&outline);
            let mut boundary_preserving = false;
            let mut keeps_ids = false;
            let result: Result<(), StructureError> = match op {
                Op::CreateDocument => {
                    let new = fresh();
                    issued.push(new);
                    outline.create_document(new)
                }
                Op::CreateFirstChild(i) | Op::InsertAfter(i) => {
                    let Some(target) = pick(i) else { continue };
                    let new = fresh();
                    issued.push(new);
                    boundary_preserving = true;
                    if matches!(op, Op::CreateFirstChild(_)) {
                        outline.create_first_child(target, new)
                    } else {
                        outline.insert_after(target, new)
                    }
                }
                Op::Indent(i) | Op::Outdent(i) => {
                    let Some(target) = pick(i) else { continue };
                    boundary_preserving = true;
                    keeps_ids = true;
                    if matches!(op, Op::Indent(_)) { outline.indent(target) } else { outline.outdent(target) }
                }
                Op::Extract(i) => {
                    let Some(target) = pick(i) else { continue };
                    keeps_ids = true;
                    outline.extract_as_document(target)
                }
                Op::Move(a, b, index) => {
                    let (Some(moved), Some(parent)) = (pick(a), pick(b)) else { continue };
                    keeps_ids = true;
                    outline.move_block(moved, parent, index)
                }
                Op::Duplicate(i) => {
                    let Some(target) = pick(i) else { continue };
                    let size = outline.subtree(target).len();
                    let copies: Vec<BlockId> = (0..size).map(|_| fresh()).collect();
                    issued.extend(&copies);
                    let mut supply = copies.into_iter();
                    outline.duplicate(target, || supply.next().unwrap_or_else(|| id(0))).map(|mapping| {
                        assert_eq!(mapping.len(), size);
                    })
                }
                Op::Trash(i) => {
                    let Some(target) = pick(i) else { continue };
                    let new_entry = entry(u32::try_from(entries.len()).unwrap());
                    entries.push(new_entry);
                    let previous_subtree: BTreeSet<BlockId> = outline.subtree(target).into_iter().collect();
                    outline.trash(target, new_entry).map(|created| {
                        assert_eq!(created.newly_deleted(), &previous_subtree);
                    })
                }
                Op::Restore(i, confirm) => {
                    let Some(chosen) = (!entries.is_empty()).then(|| entries[i % entries.len()]) else { continue };
                    let members = outline.trash_entry(chosen).map(|e| e.newly_deleted().clone());
                    outline.restore(chosen, confirm).map(|_| {
                        for member in members.unwrap_or_default() {
                            assert_eq!(outline.presence(member), Some(Presence::Live));
                        }
                    })
                }
                Op::Purge(i) => {
                    let Some(chosen) = (!entries.is_empty()).then(|| entries[i % entries.len()]) else { continue };
                    let members = outline.trash_entry(chosen).map(|e| e.newly_deleted().clone());
                    outline.purge(&[chosen]).map(|purged| {
                        assert_eq!(Some(purged), members);
                    })
                }
            };
            prop_assert!(outline.validate().is_ok(), "{:?}: {:?}", op, outline.validate());
            match result {
                Err(_) => prop_assert_eq!(&outline, &before, "rejected {:?} mutated the outline", op),
                Ok(()) => {
                    if boundary_preserving {
                        for (block, membership) in &before_membership {
                            prop_assert_eq!(outline.membership(*block), *membership, "{:?} crossed a boundary", op);
                        }
                    }
                    if keeps_ids {
                        let after: BTreeSet<BlockId> = outline.block_ids().collect();
                        let previous: BTreeSet<BlockId> = before.block_ids().collect();
                        prop_assert_eq!(after, previous);
                    }
                }
            }
            for retired in issued.iter().filter(|block| outline.is_retired(**block)) {
                prop_assert!(!outline.contains(*retired));
            }
        }
    }

    /// Trashing a live Block and restoring it right away restores the exact structure.
    #[test]
    fn trash_then_restore_round_trips(ops in prop::collection::vec(op(), 1..40), target in 0usize..64) {
        let mut outline = Outline::new();
        let mut counter = 0u32;
        let mut issued = Vec::new();
        for op in ops {
            counter += 1;
            let new = id(counter);
            let parent = (!issued.is_empty()).then(|| issued[counter as usize % issued.len()]);
            let created = match (op, parent) {
                (Op::CreateDocument, _) | (_, None) => outline.create_document(new),
                (Op::InsertAfter(_), Some(sibling)) => outline.insert_after(sibling, new),
                (_, Some(parent)) => outline.create_first_child(parent, new),
            };
            if created.is_ok() { issued.push(new); }
        }
        let Some(chosen) = (!issued.is_empty()).then(|| issued[target % issued.len()]) else { return Ok(()) };
        let before = shape(&outline);
        outline.trash(chosen, entry(1)).unwrap();
        outline.restore(entry(1), false).unwrap();
        prop_assert_eq!(shape(&outline), before);
    }
}
