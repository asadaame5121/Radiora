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
fn endpoint(id: BlockId) -> EndpointState {
    (1..1000)
        .find(|seed| block(*seed) == id)
        .map_or(EndpointState::Missing, |seed| match seed {
            990.. => EndpointState::Missing,
            900.. => EndpointState::InTrash,
            _ => EndpointState::Live {
                topic: block(seed / 10 * 10),
            },
        })
}
fn pair(from: u32, to: u32) -> CardPair {
    CardPair {
        from: block(from),
        to: block(to),
    }
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

#[test]
fn projection_orients_aggregates_and_excludes() {
    let types = RelationTypes::built_in();
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
    ];
    let projection = project_to_topics(&relations, &types, endpoint);
    let expected_10_20 = BTreeSet::from([rid(1), rid(2)]);
    let edge = &projection.edges[&pair(10, 20)];
    assert_eq!(edge.relations, expected_10_20);
    assert_eq!(edge.kinds, BTreeSet::from([name("FROM"), name("SUPPORT")]));
    let (low, high) = (block(10).min(block(30)), block(10).max(block(30)));
    assert!(projection.edges.contains_key(&CardPair {
        from: low,
        to: high
    }));
    assert_eq!(projection.edges.len(), 2);
    assert_eq!(
        projection.in_card,
        BTreeMap::from([(block(10), BTreeSet::from([rid(4), rid(5)]))])
    );
    let reasons: BTreeMap<RelationId, ExclusionReason> = projection
        .excluded
        .iter()
        .map(|e| (e.relation, e.reason))
        .collect();
    assert_eq!(
        reasons,
        BTreeMap::from([
            (rid(6), ExclusionReason::EndpointInTrash),
            (rid(7), ExclusionReason::EndpointMissing),
            (rid(8), ExclusionReason::UnknownType),
            (rid(9), ExclusionReason::Retracted),
        ])
    );
}

/// Topics 10 → 20 → {30 ⇄ 40} → 50, and 20 → 50. The cycle is a Knot without dragging 20 or 50
/// into it; edges from Knot members do not advance generations (v2 rule).
#[test]
fn lineage_separates_knots_from_acyclic_topics() {
    let types = RelationTypes::built_in();
    let relations = [
        relation(1, "FROM", 21, 11),
        relation(2, "FROM", 31, 21),
        relation(3, "FROM", 41, 31),
        relation(4, "FROM", 31, 41),
        relation(5, "FROM", 51, 41),
        relation(6, "FROM", 51, 22),
        relation(7, "FROM", 12, 11),    // inside Topic 10: never a Knot
        relation(8, "SUPPORT", 11, 51), // does not advance generation
        relation(9, "FROM", 61, 901),   // trashed origin is ignored
    ];
    let topics = [10, 20, 30, 40, 50, 60].map(block);
    let result = lineage(topics, &relations, &types, endpoint);
    assert_eq!(result.knots, vec![BTreeSet::from([block(30), block(40)])]);
    assert_eq!(
        result.generation,
        BTreeMap::from([
            (block(10), 0),
            (block(20), 1),
            (block(50), 2),
            (block(60), 0),
        ])
    );
}

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

proptest! {
    /// Generations match the brute-force longest path on DAGs (edges only go to higher indices).
    #[test]
    fn generations_match_longest_paths_on_dags(
        n in 1usize..9,
        edges in prop::collection::vec((0usize..9, 0usize..9), 0..20),
    ) {
        let types = RelationTypes::built_in();
        let mut parents = vec![BTreeSet::new(); n];
        let mut relations = Vec::new();
        for (index, (a, b)) in edges.into_iter().enumerate() {
            let (origin, derived) = (a % n, b % n);
            if origin >= derived { continue; }
            parents[derived].insert(origin);
            let seed = u32::try_from(index).unwrap();
            let topic = |i: usize| u32::try_from(i).unwrap() * 10 + 10;
            relations.push(relation(seed, "FROM", topic(derived) + 1, topic(origin) + 1));
        }
        let topics: Vec<BlockId> = (0..n).map(|i| block(u32::try_from(i).unwrap() * 10 + 10)).collect();
        let result = lineage(topics.clone(), &relations, &types, endpoint);
        prop_assert!(result.knots.is_empty());
        for (i, topic) in topics.iter().enumerate() {
            prop_assert_eq!(result.generation[topic], longest(i, &parents));
        }
        // Relation order (and thus any display filter applied later) does not matter.
        let mut reversed = relations.clone();
        reversed.reverse();
        prop_assert_eq!(lineage(topics, &reversed, &types, endpoint), result);
    }

    /// A Topic is in a Knot exactly when it lies on a cycle; Knot and generation keys partition
    /// the Topics.
    #[test]
    fn knots_are_exactly_the_cyclic_topics(
        n in 1usize..8,
        edges in prop::collection::vec((0usize..8, 0usize..8), 0..16),
    ) {
        let types = RelationTypes::built_in();
        let mut children = vec![BTreeSet::new(); n];
        let topic_seed = |i: usize| u32::try_from(i).unwrap() * 10 + 10;
        let mut relations = Vec::new();
        for (index, (a, b)) in edges.into_iter().enumerate() {
            let (origin, derived) = (a % n, b % n);
            if origin == derived { continue; }
            children[origin].insert(derived);
            relations.push(relation(u32::try_from(index).unwrap(), "FROM", topic_seed(derived) + 1, topic_seed(origin) + 1));
        }
        let topics: Vec<BlockId> = (0..n).map(|i| block(topic_seed(i))).collect();
        let result = lineage(topics.clone(), &relations, &types, endpoint);
        let in_knot: BTreeSet<BlockId> = result.knots.iter().flatten().copied().collect();
        for (i, topic) in topics.iter().enumerate() {
            prop_assert_eq!(in_knot.contains(topic), reaches(i, i, &children));
            prop_assert_eq!(result.generation.contains_key(topic), !in_knot.contains(topic));
        }
        for (x, knot) in result.knots.iter().enumerate() {
            for other in &result.knots[x + 1..] {
                prop_assert!(knot.is_disjoint(other));
            }
        }
    }

    /// Every Relation lands in exactly one of in-card, an aggregated edge, or excluded.
    #[test]
    fn projection_accounts_for_every_relation(
        specs in prop::collection::vec((0usize..8, 1u32..60, 1u32..60, prop::sample::select(vec![1u32, 901, 991])), 0..30),
    ) {
        let types = RelationTypes::built_in();
        let relations: Vec<Relation> = specs
            .iter()
            .enumerate()
            .map(|(index, (kind, source, target, far))| {
                let target = if *far == 1 { *target } else { *far };
                relation(u32::try_from(index).unwrap(), BUILT_IN_TYPES[*kind].0, *source, target)
            })
            .collect();
        let projection = project_to_topics(&relations, &types, endpoint);
        let mut seen = BTreeSet::new();
        let placed = projection.in_card.values().flatten()
            .chain(projection.edges.values().flat_map(|edge| edge.relations.iter()))
            .copied()
            .chain(projection.excluded.iter().map(|e| e.relation));
        for id in placed {
            prop_assert!(seen.insert(id), "{} projected twice", id);
        }
        prop_assert_eq!(seen.len(), relations.len());
        for pair in projection.edges.keys() {
            prop_assert_ne!(pair.from, pair.to);
        }
    }
}
