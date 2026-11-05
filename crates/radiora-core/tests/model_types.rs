//! Contracts of the v3 model types (#381). Examples come from docs/design/v3-model-decisions.md.
use proptest::prelude::*;
use radiora_core::model::*;
use std::collections::{BTreeMap, BTreeSet};
use uuid::{Builder, Uuid, Variant, Version};

fn v7(random: [u8; 16]) -> Uuid {
    Builder::from_random_bytes(random)
        .with_version(Version::SortRand)
        .with_variant(Variant::RFC4122)
        .into_uuid()
}
fn block_id(seed: u8) -> BlockId {
    BlockId::from_uuid(v7([seed; 16])).unwrap()
}
fn entry_id(seed: u8) -> TrashEntryId {
    TrashEntryId::from_uuid(v7([seed; 16])).unwrap()
}
fn owned(id: BlockId, presence: Presence) -> Block {
    Block {
        id,
        content: BlockContent::Owned(OwnedContent {
            markdown: format!("body {id}"),
            aliases: vec![],
        }),
        presence,
    }
}
fn set(ids: &[BlockId]) -> BTreeSet<BlockId> {
    ids.iter().copied().collect()
}

proptest! {
    #[test]
    fn block_id_text_and_serde_round_trip(random in any::<[u8; 16]>()) {
        let id = BlockId::from_uuid(v7(random)).unwrap();
        let text = id.to_string();
        prop_assert_eq!(text.len(), 36);
        prop_assert_eq!(&text, &text.to_lowercase());
        prop_assert_eq!(text.parse::<BlockId>().unwrap(), id);
        prop_assert_eq!(text.to_uppercase().parse::<BlockId>().unwrap(), id);
        let json = serde_json::to_string(&id).unwrap();
        prop_assert_eq!(serde_json::from_str::<BlockId>(&json).unwrap(), id);
    }

    #[test]
    fn non_v7_uuids_are_rejected(random in any::<[u8; 16]>()) {
        let v4 = Builder::from_random_bytes(random).into_uuid();
        prop_assert!(
            matches!(BlockId::from_uuid(v4), Err(IdError::NotVersion7 { .. })),
            "v4 accepted"
        );
        let json = serde_json::to_string(&v4.hyphenated().to_string()).unwrap();
        prop_assert!(serde_json::from_str::<BlockId>(&json).is_err());
    }

    #[test]
    fn block_link_round_trips(random in any::<[u8; 16]>()) {
        let id = BlockId::from_uuid(v7(random)).unwrap();
        let url = block_link_url(id);
        prop_assert!(url.starts_with(BLOCK_LINK_PREFIX));
        prop_assert_eq!(parse_block_link_url(&url).unwrap(), id);
    }

    /// Purge never reaches into entries that were not selected, even if their Blocks were
    /// descendants of a selected root in the original hierarchy.
    #[test]
    fn purge_targets_are_exactly_the_selected_entries(
        groups in prop::collection::vec(prop::collection::btree_set(1u8..=200, 1..6), 1..6),
        mask in any::<u8>(),
    ) {
        // Entries own disjoint sets: a Block is trashed by at most one operation.
        let mut seen = BTreeSet::new();
        let entries: Vec<TrashEntry> = groups
            .iter()
            .enumerate()
            .filter_map(|(index, seeds)| {
                let ids: BTreeSet<BlockId> = seeds
                    .iter()
                    .filter(|seed| seen.insert(**seed))
                    .map(|seed| block_id(*seed))
                    .collect();
                let root = *ids.iter().next()?;
                let entry_seed = u8::try_from(index).unwrap() + 201;
                Some(TrashEntry::new(entry_id(entry_seed), root, OriginalPlacement::DocumentRoot, ids).unwrap())
            })
            .collect();
        let selected: Vec<&TrashEntry> = entries
            .iter()
            .enumerate()
            .filter(|(index, _)| mask & (1 << index) != 0)
            .map(|(_, entry)| entry)
            .collect();
        let targets = purge_targets(selected.iter().copied());
        for entry in &entries {
            let chosen = selected.iter().any(|s| s.id() == entry.id());
            prop_assert_eq!(entry.newly_deleted().is_subset(&targets), chosen);
            prop_assert_eq!(entry.newly_deleted().is_disjoint(&targets), !chosen);
        }
    }

    /// Copy remapping: inside the copied set follow the copy, outside keep the original.
    #[test]
    fn copy_remap_follows_only_copied_targets(
        target in 1u8..=50,
        copied in prop::collection::btree_set(1u8..=50, 0..10),
    ) {
        let copies: BTreeMap<BlockId, BlockId> =
            copied.iter().map(|seed| (block_id(*seed), block_id(seed + 100))).collect();
        let remapped = remap_on_copy(block_id(target), &copies);
        let expected = if copied.contains(&target) { block_id(target + 100) } else { block_id(target) };
        prop_assert_eq!(remapped, expected);
    }
}

#[test]
fn malformed_and_non_canonical_ids_are_rejected() {
    let id = block_id(7);
    let simple = id.as_uuid().simple().to_string();
    assert!(matches!(
        simple.parse::<BlockId>(),
        Err(IdError::NotHyphenated { .. })
    ));
    assert!(matches!(
        format!("{{{id}}}").parse::<BlockId>(),
        Err(IdError::NotHyphenated { .. })
    ));
    assert!(matches!(
        "zzzzzzzz-zzzz-7zzz-8zzz-zzzzzzzzzzzz".parse::<BlockId>(),
        Err(IdError::Malformed { .. })
    ));
    assert!(BlockId::from_uuid(Uuid::nil()).is_err());
    assert!(BlockId::from_uuid(Uuid::max()).is_err());
}

#[test]
fn block_link_rejects_other_urls() {
    let id = block_id(3);
    for url in [
        format!("https://block/{id}"),
        format!("radiora://topic/{id}"),
        format!("radiora://block/{id}/"),
        "radiora://block/".to_owned(),
    ] {
        assert!(parse_block_link_url(&url).is_err(), "{url}");
    }
}

#[test]
fn whitespace_only_labels_mean_unset_and_text_is_kept() {
    assert_eq!(PlainLabel::new(" \t\u{3000}\n"), None);
    assert_eq!(PlainLabel::new("  別名 ").unwrap().as_str(), "  別名 ");
}

#[test]
fn reference_from_reference_points_at_the_owner() {
    let owner = owned(block_id(1), Presence::Live);
    let first = Block {
        id: block_id(2),
        content: BlockContent::Reference(ReferenceItem::to(&owner)),
        presence: Presence::Live,
    };
    let second = ReferenceItem::to(&first);
    assert_eq!(second.target(), owner.id);
    assert_eq!(direct_reference_target(&first), owner.id);
}

#[test]
fn reference_resolution_distinguishes_trash_missing_and_chain() {
    let live = BlockRecord::Present(owned(block_id(1), Presence::Live));
    let trashed = BlockRecord::Present(owned(block_id(2), Presence::Trashed(entry_id(9))));
    let purged = BlockRecord::Purged(PurgedBlock { id: block_id(3) });
    let reference = BlockRecord::Present(Block {
        id: block_id(4),
        content: BlockContent::Reference(ReferenceItem::from_persisted(block_id(1), None)),
        presence: Presence::Live,
    });
    let records: BTreeMap<BlockId, BlockRecord> = [live, trashed, purged, reference]
        .into_iter()
        .map(|record| (record.id(), record))
        .collect();
    let resolve = |seed| resolve_reference(block_id(seed), |id| records.get(&id));
    assert!(matches!(resolve(1), ReferenceResolution::Live(_)));
    assert_eq!(resolve(2), ReferenceResolution::InTrash(entry_id(9)));
    assert_eq!(resolve(3), ReferenceResolution::Missing);
    assert_eq!(resolve(5), ReferenceResolution::Missing);
    assert_eq!(
        resolve(4),
        ReferenceResolution::Chained { via: block_id(4) }
    );
}

/// "Delete C, then delete its parent B (with remaining child D)": restoring or purging B covers
/// B/D only; C keeps its own entry.
#[test]
fn earlier_deleted_child_stays_in_its_own_entry() {
    let (b, c, d) = (block_id(2), block_id(3), block_id(4));
    let parent = block_id(1);
    let c_entry = TrashEntry::new(
        entry_id(10),
        c,
        OriginalPlacement::Child {
            parent: b,
            previous_sibling: None,
        },
        collect_newly_deleted([(c, Presence::Live)]),
    )
    .unwrap();
    let b_set = collect_newly_deleted([
        (b, Presence::Live),
        (c, Presence::Trashed(c_entry.id())),
        (d, Presence::Live),
    ]);
    assert_eq!(b_set, set(&[b, d]));
    let b_entry = TrashEntry::new(
        entry_id(11),
        b,
        OriginalPlacement::Child {
            parent,
            previous_sibling: None,
        },
        b_set,
    )
    .unwrap();
    assert_eq!(purge_targets([&b_entry]), set(&[b, d]));
    assert_eq!(purge_targets([&b_entry, &c_entry]), set(&[b, c, d]));
    // After B is purged, C's parent is unusable: restore it as a document after confirmation.
    assert_eq!(
        plan_restore(
            c_entry.placement(),
            PlacementObservation {
                parent_live: false,
                anchor_in_place: false
            }
        ),
        RestorePlan::AsNewDocumentAfterConfirmation
    );
}

#[test]
fn trash_entry_must_contain_its_root() {
    let error = TrashEntry::new(
        entry_id(1),
        block_id(1),
        OriginalPlacement::DocumentRoot,
        set(&[block_id(2)]),
    )
    .unwrap_err();
    assert!(matches!(error, TrashEntryError::RootNotDeleted { .. }));
}

#[test]
fn restore_destination_table() {
    let parent = block_id(1);
    let anchor = block_id(2);
    let child = |previous_sibling| OriginalPlacement::Child {
        parent,
        previous_sibling,
    };
    let observe = |parent_live, anchor_in_place| PlacementObservation {
        parent_live,
        anchor_in_place,
    };
    let cases = [
        (
            child(Some(anchor)),
            observe(true, true),
            RestorePlan::AtOriginalPosition {
                parent,
                after: Some(anchor),
            },
        ),
        (
            child(None),
            observe(true, false),
            RestorePlan::AtOriginalPosition {
                parent,
                after: None,
            },
        ),
        (
            child(Some(anchor)),
            observe(true, false),
            RestorePlan::AtEndOfParent { parent },
        ),
        (
            child(Some(anchor)),
            observe(false, true),
            RestorePlan::AsNewDocumentAfterConfirmation,
        ),
        (
            OriginalPlacement::DocumentRoot,
            observe(false, false),
            RestorePlan::AsDocumentRoot,
        ),
    ];
    for (placement, observed, expected) in cases {
        assert_eq!(
            plan_restore(placement, observed),
            expected,
            "{placement:?} {observed:?}"
        );
    }
}
