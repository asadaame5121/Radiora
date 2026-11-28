//! Relation types, Topic projection and lineage (#381 Relation contract).
use proptest::prelude::*;
use radiora_core::model::*;
use std::collections::{BTreeMap, BTreeSet};
use uuid::{Builder, Variant, Version};

fn v7(seed: u32, tag: u8) -> uuid::Uuid {
    let mut bytes = [tag; 16];
    bytes[..4].copy_from_slice(&seed.to_be_bytes());
    Builder::from_random_bytes(bytes)
        .with_version(Version::SortRand)
        .with_variant(Variant::RFC4122)
        .into_uuid()
}
fn block(seed: u32) -> BlockId {
    BlockId::from_uuid(v7(seed, 0xB0)).unwrap()
}
fn rid(seed: u32) -> RelationId {
    RelationId::from_uuid(v7(seed, 0xA0)).unwrap()
}
fn name(text: &str) -> RelationTypeName {
    RelationTypeName::normalize(text).unwrap()
}
fn relation(id: u32, kind: &str, source: u32, target: u32) -> Relation {
    Relation {
        id: rid(id),
        kind: name(kind),
        source: block(source),
        target: block(target),
        status: RelationStatus::Asserted,
    }
}
/// Blocks 1..=99 live in Topic `seed / 10 * 10` (e.g. 11 and 12 belong to Topic 10).
/// 900+ are in the trash, 990+ are missing.
fn state(seed: u32) -> EndpointState {
    match seed {
        990.. => EndpointState::Missing,
        900.. => EndpointState::InTrash,
        _ => EndpointState::Live {
            topic: block(seed / 10 * 10),
        },
    }
}
/// Every Block any Relation names, plus its Topic root. Missing Blocks are left out on purpose:
/// an absent ID must read as Missing.
fn blocks_of(relations: &[Relation]) -> Vec<TopicBlock> {
    let mut seeds = BTreeSet::new();
    for relation in relations {
        for id in [relation.source, relation.target] {
            if let Some(seed) = (1..1000).find(|seed| block(*seed) == id) {
                seeds.insert(seed);
                if seed < 900 {
                    seeds.insert(seed / 10 * 10);
                }
            }
        }
    }
    seeds
        .into_iter()
        .filter(|seed| *seed < 990)
        .map(|seed| TopicBlock {
            id: block(seed),
            state: state(seed),
        })
        .collect()
}
fn project(relations: &[Relation], types: &RelationTypes) -> VerticalTree {
    project_vertical_tree(blocks_of(relations), relations, types)
}
fn pair(from: u32, to: u32) -> CardPair {
    CardPair {
        from: block(from),
        to: block(to),
    }
}
fn generations(tree: &VerticalTree) -> BTreeMap<BlockId, usize> {
    tree.cards
        .keys()
        .filter_map(|topic| tree.generation(*topic).map(|g| (*topic, g)))
        .collect()
}
fn custom_types() -> RelationTypes {
    let mut types = RelationTypes::built_in();
    types
        .add_custom("INSPIRED_BY", Direction::Directed, true)
        .unwrap();
    types
        .add_custom("ECHOES", Direction::Symmetric, true)
        .unwrap();
    types
}

#[test]
fn type_names_are_normalized_and_validated() {
    assert_eq!(name("  from ").as_str(), "FROM");
    assert_eq!(name("my_type2").as_str(), "MY_TYPE2");
    for invalid in ["", "  ", "1ABC", "A-B", "ÄB", &"A".repeat(65)] {
        assert!(RelationTypeName::normalize(invalid).is_err(), "{invalid:?}");
    }
    assert!(RelationTypeName::normalize(&"A".repeat(64)).is_ok());
}

#[test]
fn type_registry_protects_built_ins() {
    let built_in = RelationTypes::built_in();
    let defs: Vec<RelationTypeDefinition> = built_in.definitions().cloned().collect();
    assert_eq!(defs.len(), BUILT_IN_TYPES.len());
    assert_eq!(
        RelationTypes::from_definitions(defs.clone()),
        Ok(built_in.clone())
    );
    let from = built_in.get(&name("FROM")).unwrap();
    assert!(from.advances_generation && from.direction == Direction::Directed);

    let mut altered = defs.clone();
    altered
        .iter_mut()
        .find(|d| d.name.as_str() == "FROM")
        .unwrap()
        .advances_generation = false;
    assert!(matches!(
        RelationTypes::from_definitions(altered),
        Err(RelationTypeError::AlteredBuiltIn { .. })
    ));
    assert!(matches!(
        RelationTypes::from_definitions(defs[1..].to_vec()),
        Err(RelationTypeError::MissingBuiltIn { .. })
    ));
    let mut duplicated = defs.clone();
    duplicated.push(defs[0].clone());
    assert!(matches!(
        RelationTypes::from_definitions(duplicated),
        Err(RelationTypeError::Duplicate { .. })
    ));
    let mut fake = defs;
    fake.push(RelationTypeDefinition {
        name: name("MINE"),
        direction: Direction::Directed,
        built_in: true,
        advances_generation: false,
    });
    assert!(matches!(
        RelationTypes::from_definitions(fake),
        Err(RelationTypeError::CustomMarkedBuiltIn { .. })
    ));

    let mut types = built_in;
    assert!(matches!(
        types.add_custom(" related ", Direction::Symmetric, false),
        Err(RelationTypeError::ConflictsWithBuiltIn { .. })
    ));
    types
        .add_custom("inspired_by", Direction::Directed, true)
        .unwrap();
    assert!(matches!(
        types.add_custom("INSPIRED_BY", Direction::Directed, true),
        Err(RelationTypeError::Duplicate { .. })
    ));
}

fn trace(tree: &VerticalTree, id: u32) -> RelationTrace {
    tree.traces[&rid(id)]
}

/// FROM is reversed, other directed types (custom generation types too) keep the stored source
/// on top, symmetric pairs are ordered by Topic ID; same-Topic Relations stay in the card and
/// unusable Relations are kept with a reason.
#[test]
fn projection_orients_aggregates_and_excludes() {
    let types = custom_types();
    let mut retracted = relation(9, "SUPPORT", 11, 21);
    retracted.status = RelationStatus::Retracted;
    let relations = [
        relation(1, "FROM", 21, 11),    // New(20) FROM Old(10): displayed 10 → 20
        relation(2, "SUPPORT", 12, 21), // stored direction 10 → 20
        relation(3, "VS", 31, 12),      // symmetric: ordered by Topic ID
        relation(4, "RELATED", 11, 12), // same Topic: in-card
        relation(5, "LIKE", 13, 13),    // self-loop: in-card, no card self-edge
        relation(6, "CITE", 11, 901),
        relation(7, "CITE", 11, 991),
        relation(8, "UNKNOWN_TYPE", 11, 21),
        retracted,
        relation(10, "INSPIRED_BY", 41, 51), // custom generation type: source 40 on top
        relation(11, "ECHOES", 51, 61),      // symmetric never advances generations
        relation(12, "CITE", 901, 991),      // Missing wins over trash
    ];
    let before = relations.clone();
    let tree = project(&relations, &types);
    assert_eq!(relations, before, "the projection never writes back");

    let edge = &tree.edges[&pair(10, 20)];
    assert_eq!(edge.relations, BTreeSet::from([rid(1), rid(2)]));
    assert_eq!(edge.count(), 2);
    assert_eq!(edge.kinds, BTreeSet::from([name("FROM"), name("SUPPORT")]));
    assert_eq!(
        tree.edges.keys().copied().collect::<Vec<_>>(),
        vec![pair(10, 20), pair(10, 30), pair(40, 50), pair(50, 60)]
    );
    assert_eq!(
        tree.cards[&block(10)].in_card,
        BTreeSet::from([rid(4), rid(5)])
    );
    assert_eq!(
        tree.cards.keys().copied().collect::<Vec<_>>(),
        [10, 20, 30, 40, 50, 60].map(block).to_vec(),
        "a trashed Block does not make a card"
    );
    let excluded = |reason| RelationTrace::Excluded { reason };
    let expected = [
        (1, RelationTrace::Layout { pair: pair(10, 20) }),
        (2, RelationTrace::NonGenerational { pair: pair(10, 20) }),
        (3, RelationTrace::NonGenerational { pair: pair(10, 30) }),
        (4, RelationTrace::InCard { topic: block(10) }),
        (5, RelationTrace::InCard { topic: block(10) }),
        (6, excluded(ExclusionReason::EndpointInTrash)),
        (7, excluded(ExclusionReason::EndpointMissing)),
        (8, excluded(ExclusionReason::UnknownType)),
        (9, excluded(ExclusionReason::Retracted)),
        (10, RelationTrace::Layout { pair: pair(40, 50) }),
        (11, RelationTrace::NonGenerational { pair: pair(50, 60) }),
        (12, excluded(ExclusionReason::EndpointMissing)),
    ];
    assert_eq!(
        tree.traces,
        expected.into_iter().map(|(id, t)| (rid(id), t)).collect()
    );
    assert_eq!(
        generations(&tree),
        BTreeMap::from([
            (block(10), 0),
            (block(20), 1),
            (block(30), 0),
            (block(40), 0),
            (block(50), 1),
            (block(60), 0),
        ])
    );
    assert!(tree.knots.is_empty());
    assert_eq!(tree.knot_generation, None);
}

/// 10 → 20 → {30 ⇄ 40} → 50 with 20 → 50, and a second cycle {60 → 70 → 80 → 60} reached from
/// 40 and flowing into 90. Only cycle members form Knots; edges touching Knot members do not
/// advance generations (v2 rule); a non-generation edge back up makes no cycle.
#[test]
fn lineage_separates_knots_from_acyclic_topics() {
    let types = custom_types();
    let relations = [
        relation(1, "FROM", 21, 11),
        relation(2, "FROM", 31, 21),
        relation(3, "INSPIRED_BY", 31, 41),
        relation(4, "FROM", 31, 41),
        relation(5, "FROM", 51, 41),
        relation(6, "INSPIRED_BY", 22, 51),
        relation(7, "FROM", 12, 11),    // inside Topic 10: never a Knot
        relation(8, "SUPPORT", 11, 51), // does not advance generation
        relation(9, "FROM", 61, 901),   // trashed origin is ignored
        relation(10, "INSPIRED_BY", 61, 71),
        relation(11, "INSPIRED_BY", 71, 81),
        relation(12, "INSPIRED_BY", 81, 61),
        relation(13, "INSPIRED_BY", 41, 62), // Knot → Knot
        relation(14, "INSPIRED_BY", 81, 91), // out of a Knot
        relation(15, "SUPPORT", 51, 21),     // non-generation edge upwards: no cycle
    ];
    let tree = project(&relations, &types);
    let knot_a = BTreeSet::from([block(30), block(40)]);
    let knot_b = BTreeSet::from([block(60), block(70), block(80)]);
    assert_eq!(
        tree.knots,
        BTreeMap::from([(block(30), knot_a), (block(60), knot_b)])
    );
    assert_eq!(
        tree.cards[&block(70)].placement,
        CardPlacement::Knot { knot: block(60) }
    );
    let expected_generations = BTreeMap::from([
        (block(10), 0),
        (block(20), 1),
        (block(50), 2),
        (block(90), 0),
    ]);
    assert_eq!(generations(&tree), expected_generations);
    assert_eq!(tree.knot_generation, Some(3));
    assert_eq!(
        tree.layout_edges(),
        BTreeSet::from([pair(10, 20), pair(20, 50)])
    );
    for id in [2, 3, 4, 5, 10, 11, 12, 13, 14] {
        assert!(
            matches!(trace(&tree, id), RelationTrace::KnotConnection { .. }),
            "{id}"
        );
    }
    assert_eq!(
        trace(&tree, 4),
        RelationTrace::KnotConnection { pair: pair(40, 30) }
    );
    assert_eq!(trace(&tree, 7), RelationTrace::InCard { topic: block(10) });
    assert!(matches!(
        trace(&tree, 15),
        RelationTrace::NonGenerational { .. }
    ));

    // A display filter hides cards; numbers, Knot IDs and traces stay.
    let visible = BTreeSet::from([20, 30, 50, 90].map(block));
    let filtered = tree.filtered(&visible);
    assert_eq!(
        generations(&filtered),
        BTreeMap::from([(block(20), 1), (block(50), 2), (block(90), 0)])
    );
    assert_eq!(
        filtered.knots,
        BTreeMap::from([(block(30), BTreeSet::from([block(30)]))])
    );
    assert_eq!(filtered.knot_generation, Some(3));
    assert_eq!(filtered.traces, tree.traces);
    assert_eq!(filtered.layout_edges(), BTreeSet::from([pair(20, 50)]));
    assert_eq!(
        filtered.edges.keys().copied().collect::<Vec<_>>(),
        vec![pair(20, 30), pair(20, 50), pair(50, 20)]
    );
}

/// Diamond (deepest parent + 1), a second root into the diamond, a disconnected chain and a card
/// without cross-Topic Relations.
#[test]
fn diamond_multiple_roots_and_disconnected_components() {
    let types = custom_types();
    let relations = [
        relation(1, "INSPIRED_BY", 11, 21),
        relation(2, "INSPIRED_BY", 11, 31),
        relation(3, "FROM", 41, 21),
        relation(4, "FROM", 41, 31),
        relation(5, "INSPIRED_BY", 12, 42), // shortcut 10 → 40 does not lower 40
        relation(6, "INSPIRED_BY", 51, 41), // second root
        relation(7, "FROM", 71, 61),        // disconnected 60 → 70
        relation(8, "RELATED", 81, 82),     // lone card 80
        relation(9, "INSPIRED_BY", 21, 22), // in-card only
    ];
    let tree = project(&relations, &types);
    assert_eq!(
        generations(&tree),
        BTreeMap::from([
            (block(10), 0),
            (block(20), 1),
            (block(30), 1),
            (block(40), 2),
            (block(50), 0),
            (block(60), 0),
            (block(70), 1),
            (block(80), 0),
        ])
    );
    assert_eq!(tree.layout_edges().len(), 7);
    assert_eq!(tree.edges[&pair(10, 40)].count(), 1);
    assert_eq!(tree.cards[&block(80)].in_card, BTreeSet::from([rid(8)]));
}

/// A cycle among Blocks of one Topic stays an in-card cycle and never a Knot or card self-edge.
#[test]
fn same_topic_cycle_is_in_card_not_a_knot() {
    let types = custom_types();
    let relations = [
        relation(1, "FROM", 11, 12),
        relation(2, "FROM", 12, 11),
        relation(3, "INSPIRED_BY", 13, 13),
        relation(4, "INSPIRED_BY", 13, 21),
    ];
    let tree = project(&relations, &types);
    assert!(tree.knots.is_empty());
    assert_eq!(
        tree.cards[&block(10)].in_card,
        BTreeSet::from([rid(1), rid(2), rid(3)])
    );
    assert_eq!(
        tree.edges.keys().copied().collect::<Vec<_>>(),
        vec![pair(10, 20)]
    );
    assert_eq!(tree.generation(block(20)), Some(1));
}

/// Moving an endpoint to another Topic keeps the Relation and its endpoints; only the owning
/// Topic and the projected edge change.
#[test]
fn moving_an_endpoint_only_changes_the_projection() {
    let types = custom_types();
    let relations = [relation(1, "INSPIRED_BY", 11, 12)];
    let mut blocks = blocks_of(&relations);
    blocks.push(TopicBlock {
        id: block(20),
        state: state(20),
    });
    let before = project_vertical_tree(blocks.clone(), &relations, &types);
    assert_eq!(
        trace(&before, 1),
        RelationTrace::InCard { topic: block(10) }
    );

    let moved = blocks
        .iter()
        .map(|b| {
            if b.id == block(12) {
                TopicBlock {
                    id: b.id,
                    state: EndpointState::Live { topic: block(20) },
                }
            } else {
                *b
            }
        })
        .collect::<Vec<_>>();
    let after = project_vertical_tree(moved, &relations, &types);
    assert_eq!(
        trace(&after, 1),
        RelationTrace::Layout { pair: pair(10, 20) }
    );
    assert_eq!(relations[0], relation(1, "INSPIRED_BY", 11, 12));
    assert_eq!(after.generation(block(20)), Some(1));
}

// ---- Product-level properties against brute-force models ----

/// Longest chain ending at `node` in a DAG, by brute force.
fn longest(node: usize, parents: &[BTreeSet<usize>]) -> usize {
    parents[node]
        .iter()
        .map(|parent| longest(*parent, parents) + 1)
        .max()
        .unwrap_or(0)
}

fn reaches(from: usize, to: usize, children: &[BTreeSet<usize>]) -> bool {
    let mut stack: Vec<usize> = children[from].iter().copied().collect();
    let mut seen = BTreeSet::new();
    while let Some(node) = stack.pop() {
        if node == to {
            return true;
        }
        if seen.insert(node) {
            stack.extend(children[node].iter().copied());
        }
    }
    false
}

fn topic_seed(index: usize) -> u32 {
    u32::try_from(index).unwrap() * 10 + 10
}

/// A generation Relation drawn `origin → derived`, stored as FROM or as the custom type.
fn derivation(id: usize, origin: usize, derived: usize, as_from: bool) -> Relation {
    let id = u32::try_from(id).unwrap();
    let (origin, derived) = (topic_seed(origin) + 1, topic_seed(derived) + 2);
    if as_from {
        relation(id, "FROM", derived, origin)
    } else {
        relation(id, "INSPIRED_BY", origin, derived)
    }
}

fn mixed_relations() -> impl Strategy<Value = Vec<Relation>> {
    let kinds: Vec<&'static str> = BUILT_IN_TYPES
        .iter()
        .map(|(name, _, _)| *name)
        .chain(["INSPIRED_BY", "ECHOES", "UNKNOWN_TYPE"])
        .collect();
    let endpoint = prop_oneof![10 => 1u32..60, 1 => Just(901u32), 1 => Just(991u32)];
    prop::collection::vec(
        (
            prop::sample::select(kinds),
            endpoint.clone(),
            endpoint,
            any::<bool>(),
        ),
        0..30,
    )
    .prop_map(|specs| {
        specs
            .into_iter()
            .enumerate()
            .map(|(index, (kind, source, target, asserted))| {
                let mut relation = relation(u32::try_from(index).unwrap(), kind, source, target);
                if !asserted && index % 3 == 0 {
                    relation.status = RelationStatus::Retracted;
                }
                relation
            })
            .collect()
    })
}

proptest! {
    /// Generations match the brute-force longest path on DAGs in display direction, for FROM and
    /// custom generation types alike, and every generation edge points downwards.
    #[test]
    fn generations_match_longest_paths_on_dags(
        n in 1usize..9,
        edges in prop::collection::vec((0usize..9, 0usize..9, any::<bool>()), 0..20),
    ) {
        let types = custom_types();
        let mut parents = vec![BTreeSet::new(); n];
        let mut relations = Vec::new();
        for (index, (a, b, as_from)) in edges.into_iter().enumerate() {
            let (origin, derived) = (a % n, b % n);
            if origin >= derived { continue; }
            parents[derived].insert(origin);
            relations.push(derivation(index, origin, derived, as_from));
        }
        let mut blocks = blocks_of(&relations);
        blocks.extend((0..n).map(|i| TopicBlock { id: block(topic_seed(i)), state: state(topic_seed(i)) }));
        let tree = project_vertical_tree(blocks.clone(), &relations, &types);
        prop_assert!(tree.knots.is_empty());
        for (i, _) in parents.iter().enumerate() {
            prop_assert_eq!(tree.generation(block(topic_seed(i))), Some(longest(i, &parents)));
        }
        for relation in &relations {
            let is_layout = matches!(tree.traces[&relation.id], RelationTrace::Layout { .. });
            prop_assert!(is_layout);
        }
        for edge in tree.layout_edges() {
            prop_assert!(tree.generation(edge.from) < tree.generation(edge.to));
        }
        // Input order does not matter.
        let mut reversed = relations.clone();
        reversed.reverse();
        blocks.reverse();
        prop_assert_eq!(project_vertical_tree(blocks, &reversed, &types), tree);
    }

    /// A Topic is in a Knot exactly when it lies on a cycle; Knots and generations partition the
    /// cards and the layout input is a DAG.
    #[test]
    fn knots_are_exactly_the_cyclic_topics(
        n in 1usize..8,
        edges in prop::collection::vec((0usize..8, 0usize..8, any::<bool>()), 0..16),
    ) {
        let types = custom_types();
        let mut children = vec![BTreeSet::new(); n];
        let mut relations = Vec::new();
        for (index, (a, b, as_from)) in edges.into_iter().enumerate() {
            let (origin, derived) = (a % n, b % n);
            if origin == derived { continue; }
            children[origin].insert(derived);
            relations.push(derivation(index, origin, derived, as_from));
        }
        let tree = project(&relations, &types);
        let in_knot: BTreeSet<BlockId> = tree.knots.values().flatten().copied().collect();
        for (i, children_of) in children.iter().enumerate() {
            let topic = block(topic_seed(i));
            if !tree.cards.contains_key(&topic) {
                prop_assert!(children_of.is_empty());
                continue;
            }
            prop_assert_eq!(in_knot.contains(&topic), reaches(i, i, &children));
            prop_assert_eq!(tree.generation(topic).is_some(), !in_knot.contains(&topic));
            if let CardPlacement::Knot { knot } = tree.cards[&topic].placement {
                prop_assert!(tree.knots[&knot].contains(&topic));
                prop_assert_eq!(tree.knots[&knot].first(), Some(&knot));
            }
        }
        let members: usize = tree.knots.values().map(BTreeSet::len).sum();
        prop_assert_eq!(members, in_knot.len(), "Knots are disjoint");
        let index = |id: BlockId| (0..n).find(|i| block(topic_seed(*i)) == id).unwrap();
        let mut layout_children = vec![BTreeSet::new(); n];
        for edge in tree.layout_edges() {
            layout_children[index(edge.from)].insert(index(edge.to));
            prop_assert!(!in_knot.contains(&edge.from) && !in_knot.contains(&edge.to));
        }
        for i in 0..n {
            prop_assert!(!reaches(i, i, &layout_children), "layout input is a DAG");
        }
    }

    /// Every Relation is traced exactly once, aggregated edges hold exactly the Relations traced
    /// to them, display filters and input order never change the meaning, and the input is left
    /// unchanged.
    #[test]
    fn every_relation_is_traced_and_filters_keep_numbers(
        relations in mixed_relations(),
        visible_seeds in prop::collection::btree_set(1u32..6, 0..6),
        seed in any::<u64>(),
    ) {
        let types = custom_types();
        let before = relations.clone();
        let blocks = blocks_of(&relations);
        let tree = project_vertical_tree(blocks.clone(), &relations, &types);
        prop_assert_eq!(&relations, &before);
        prop_assert_eq!(tree.traces.len(), relations.len());

        let mut from_traces: BTreeMap<CardPair, BTreeSet<RelationId>> = BTreeMap::new();
        let mut in_card: BTreeMap<BlockId, BTreeSet<RelationId>> = BTreeMap::new();
        for (id, trace) in &tree.traces {
            if let Some(pair) = trace.pair() {
                prop_assert_ne!(pair.from, pair.to);
                from_traces.entry(pair).or_default().insert(*id);
            }
            if let RelationTrace::InCard { topic } = trace {
                in_card.entry(*topic).or_default().insert(*id);
            }
        }
        let edges: BTreeMap<CardPair, BTreeSet<RelationId>> =
            tree.edges.iter().map(|(pair, edge)| (*pair, edge.relations.clone())).collect();
        prop_assert_eq!(edges, from_traces);
        let cards_in_card: BTreeMap<BlockId, BTreeSet<RelationId>> = tree.cards.iter()
            .filter(|(_, card)| !card.in_card.is_empty())
            .map(|(topic, card)| (*topic, card.in_card.clone()))
            .collect();
        prop_assert_eq!(cards_in_card, in_card);

        let visible: BTreeSet<BlockId> = visible_seeds.iter().map(|s| block(s * 10)).collect();
        let filtered = tree.filtered(&visible);
        for topic in &visible {
            prop_assert_eq!(filtered.generation(*topic), tree.generation(*topic));
            prop_assert_eq!(
                filtered.cards.get(topic).map(|c| c.placement),
                tree.cards.get(topic).map(|c| c.placement)
            );
        }
        prop_assert!(filtered.cards.keys().all(|topic| visible.contains(topic)));
        prop_assert_eq!(filtered.knot_generation, tree.knot_generation);
        prop_assert_eq!(&filtered.traces, &tree.traces);

        // Seeded rotation of the Relations and reversed Blocks.
        let mut shuffled = relations.clone();
        let mut shuffled_blocks = blocks;
        if !shuffled.is_empty() {
            let k = usize::try_from(seed % u64::try_from(shuffled.len()).unwrap()).unwrap();
            shuffled.rotate_left(k);
        }
        shuffled_blocks.reverse();
        prop_assert_eq!(project_vertical_tree(shuffled_blocks, &shuffled, &types), tree);
    }
}
