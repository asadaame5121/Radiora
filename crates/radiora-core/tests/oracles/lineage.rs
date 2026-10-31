//! V09 oracle: Relation → Topic projection, filter-independent generations and Knot.
//!
//! Contract: v3-model-decisions.md「Relationの対象・Topic投影の採用契約」 and
//! vertical-tree-implementation-plan.md §3. Cycles come from a reachability
//! matrix (not Tarjan); generations from memoised longest paths (not Kahn).

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;
use serde::Deserialize;

use crate::support::{Coverage, read_fixture, runner};

pub type BlockId = u32;
pub type TopicId = u32;
pub type RelationId = u32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockState {
    Live,
    Trash,
    Missing,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Block {
    pub id: BlockId,
    pub topic: TopicId,
    pub state: BlockState,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelationType {
    pub name: String,
    pub advances_generation: bool,
    /// FROM stores `derived → source`; the display/generation direction is reversed.
    pub display_reversed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Relation {
    pub id: RelationId,
    pub kind: String,
    pub from: BlockId,
    pub to: BlockId,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub blocks: Vec<Block>,
    pub types: Vec<RelationType>,
    pub relations: Vec<Relation>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Class {
    Normal,
    KnotConnection,
    InCard,
    NonGenerational,
    ExcludedEndpoint,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Projection {
    pub generation: BTreeMap<TopicId, u32>,
    pub knot: BTreeSet<TopicId>,
    pub knot_generation: Option<u32>,
    /// Display-direction edges between visible cards with their source Relation IDs.
    pub edges: BTreeMap<(TopicId, TopicId), BTreeSet<RelationId>>,
    pub class: BTreeMap<RelationId, Class>,
}

pub fn project(input: &Input, visible: Option<&BTreeSet<TopicId>>) -> Projection {
    let blocks: BTreeMap<_, _> = input.blocks.iter().map(|b| (b.id, b)).collect();
    let types: BTreeMap<_, _> = input.types.iter().map(|t| (t.name.as_str(), t)).collect();
    let topics: BTreeSet<TopicId> = input
        .blocks
        .iter()
        .filter(|b| b.state == BlockState::Live)
        .map(|b| b.topic)
        .collect();

    // 1. Classify every relation once and orient generation edges for display.
    let mut class = BTreeMap::new();
    let mut display = Vec::new();
    for relation in &input.relations {
        let (Some(from), Some(to)) = (blocks.get(&relation.from), blocks.get(&relation.to)) else {
            class.insert(relation.id, Class::ExcludedEndpoint);
            continue;
        };
        if from.state != BlockState::Live || to.state != BlockState::Live {
            class.insert(relation.id, Class::ExcludedEndpoint);
            continue;
        }
        if from.topic == to.topic {
            class.insert(relation.id, Class::InCard);
            continue;
        }
        let kind = types.get(relation.kind.as_str());
        let (src, dst) = if kind.is_some_and(|k| k.display_reversed) {
            (to.topic, from.topic)
        } else {
            (from.topic, to.topic)
        };
        display.push((relation.id, src, dst));
        if !kind.is_some_and(|k| k.advances_generation) {
            class.insert(relation.id, Class::NonGenerational);
        }
    }
    let advancing: Vec<_> = display
        .iter()
        .filter(|(id, _, _)| !class.contains_key(id))
        .copied()
        .collect();

    // 2. Knot = topics on a cycle of the unfiltered generation graph.
    let index: BTreeMap<_, _> = topics.iter().enumerate().map(|(i, t)| (*t, i)).collect();
    let n = topics.len();
    let mut reach = vec![vec![false; n]; n];
    for (_, src, dst) in &advancing {
        reach[index[src]][index[dst]] = true;
    }
    for k in 0..n {
        let via = reach[k].clone();
        for row in &mut reach {
            if row[k] {
                for (cell, through) in row.iter_mut().zip(&via) {
                    *cell |= *through;
                }
            }
        }
    }
    let knot: BTreeSet<_> = topics
        .iter()
        .filter(|t| reach[index[t]][index[t]])
        .copied()
        .collect();

    // 3. Generations over edges between non-Knot topics only.
    for (id, src, dst) in &advancing {
        let connection = knot.contains(src) || knot.contains(dst);
        class.insert(
            *id,
            if connection {
                Class::KnotConnection
            } else {
                Class::Normal
            },
        );
    }
    let mut parents: BTreeMap<TopicId, BTreeSet<TopicId>> = BTreeMap::new();
    for (id, src, dst) in &advancing {
        if class[id] == Class::Normal {
            parents.entry(*dst).or_default().insert(*src);
        }
    }
    let mut generation = BTreeMap::new();
    for topic in topics.iter().filter(|t| !knot.contains(t)) {
        longest(*topic, &parents, &mut generation);
    }
    let knot_generation = (!knot.is_empty()).then(|| {
        generation
            .values()
            .copied()
            .max()
            .map_or(0, |max: u32| max + 1)
    });

    // 4. Filtering only hides cards; numbers and membership were fixed above.
    let shown = |topic: &TopicId| visible.is_none_or(|v| v.contains(topic));
    let mut edges: BTreeMap<_, BTreeSet<_>> = BTreeMap::new();
    for (id, src, dst) in &display {
        if shown(src) && shown(dst) {
            edges.entry((*src, *dst)).or_default().insert(*id);
        }
    }
    generation.retain(|topic, _| shown(topic));
    let knot = knot.into_iter().filter(|t| shown(t)).collect();
    Projection {
        generation,
        knot,
        knot_generation,
        edges,
        class,
    }
}

fn longest(
    topic: TopicId,
    parents: &BTreeMap<TopicId, BTreeSet<TopicId>>,
    memo: &mut BTreeMap<TopicId, u32>,
) -> u32 {
    if let Some(value) = memo.get(&topic) {
        return *value;
    }
    let value = parents.get(&topic).map_or(0, |ps| {
        ps.iter()
            .map(|p| longest(*p, parents, memo) + 1)
            .max()
            .unwrap_or(0)
    });
    memo.insert(topic, value);
    value
}

/// Second, independent cycle test: DFS from each topic's successors.
fn on_cycle(input: &Input, topic: TopicId) -> bool {
    let projection = project(input, None);
    let mut successors: BTreeMap<TopicId, Vec<TopicId>> = BTreeMap::new();
    for ((src, dst), ids) in &projection.edges {
        let advancing = ids
            .iter()
            .any(|id| matches!(projection.class[id], Class::Normal | Class::KnotConnection));
        if advancing {
            successors.entry(*src).or_default().push(*dst);
        }
    }
    let next = |t: TopicId| successors.get(&t).cloned().unwrap_or_default();
    let mut seen = BTreeSet::new();
    let mut stack = next(topic);
    while let Some(current) = stack.pop() {
        if current == topic {
            return true;
        }
        if seen.insert(current) {
            stack.extend(next(current));
        }
    }
    false
}

// ---- Generators ----

fn types() -> Vec<RelationType> {
    vec![
        RelationType {
            name: "from".into(),
            advances_generation: true,
            display_reversed: true,
        },
        RelationType {
            name: "derives".into(),
            advances_generation: true,
            display_reversed: false,
        },
        RelationType {
            name: "mentions".into(),
            advances_generation: false,
            display_reversed: false,
        },
    ]
}

fn input() -> impl Strategy<Value = Input> {
    let block = (
        1u32..=5,
        prop_oneof![12 => Just(BlockState::Live), 1 => Just(BlockState::Trash), 1 => Just(BlockState::Missing)],
    );
    // Mostly generation-advancing kinds over few topics, so Knots and DAGs co-occur.
    let kind = prop_oneof![3 => Just(1usize), 2 => Just(0usize), 1 => Just(2usize)];
    let endpoint = prop_oneof![12 => 0usize..12, 1 => 12usize..14];
    let relation = (endpoint.clone(), endpoint, kind);
    (
        prop::collection::vec(block, 2..=12),
        prop::collection::vec(relation, 0..=20),
        any::<bool>(),
    )
        .prop_map(|(blocks, relations, plant_chain)| {
            let blocks: Vec<_> = blocks
                .into_iter()
                .enumerate()
                .map(|(i, (topic, state))| Block {
                    id: i as BlockId + 1,
                    topic,
                    state,
                })
                .collect();
            let names = ["from", "derives", "mentions"];
            let relations = relations
                .into_iter()
                .enumerate()
                // Endpoints past the block list model unresolved (Missing) IDs.
                .map(|(i, (from, to, kind))| Relation {
                    id: i as RelationId + 1,
                    kind: names[kind].into(),
                    from: endpoint_id(from, blocks.len()),
                    to: endpoint_id(to, blocks.len()),
                })
                .collect::<Vec<_>>();
            let mut input = Input {
                blocks,
                types: types(),
                relations,
            };
            if plant_chain {
                plant_derivation_chain(&mut input);
            }
            input
        })
}

/// Appends topics 8 → 9 → 10 so a DAG with positive generations sits next to
/// whatever Knot the random part produced.
fn plant_derivation_chain(input: &mut Input) {
    let first_block = input.blocks.len() as BlockId + 100;
    let first_relation = input.relations.len() as RelationId + 1;
    for offset in 0..3 {
        input.blocks.push(Block {
            id: first_block + offset,
            topic: 8 + offset,
            state: BlockState::Live,
        });
    }
    for offset in 0..2 {
        input.relations.push(Relation {
            id: first_relation + offset,
            kind: "derives".into(),
            from: first_block + offset,
            to: first_block + offset + 1,
        });
    }
}

/// Indexes below 12 pick an existing block; 12 and 13 stay unresolved.
fn endpoint_id(index: usize, blocks: usize) -> BlockId {
    if index < 12 {
        (index % blocks) as BlockId + 1
    } else {
        (blocks + index - 11) as BlockId
    }
}

// ---- Properties ----

#[test]
fn projection_properties_hold() {
    let coverage = Coverage::default();
    runner(file!())
        .run(&input(), |input| {
            let projection = project(&input, None);
            // Every relation is traceable to exactly one class.
            prop_assert_eq!(projection.class.len(), input.relations.len());
            for class in projection.class.values() {
                coverage.hit(match class {
                    Class::Normal => "normal",
                    Class::KnotConnection => "knot_connection",
                    Class::InCard => "in_card",
                    Class::NonGenerational => "non_generational",
                    Class::ExcludedEndpoint => "excluded",
                });
            }
            // Generation increases along every normal edge (derived below source).
            for ((src, dst), ids) in &projection.edges {
                if ids.iter().any(|id| projection.class[id] == Class::Normal) {
                    prop_assert!(projection.generation[src] < projection.generation[dst]);
                }
            }
            // Knot membership agrees with an independent DFS cycle test.
            let topics: BTreeSet<_> = input
                .blocks
                .iter()
                .filter(|b| b.state == BlockState::Live)
                .map(|b| b.topic)
                .collect();
            for topic in &topics {
                prop_assert_eq!(projection.knot.contains(topic), on_cycle(&input, *topic));
                prop_assert!(
                    projection.knot.contains(topic) != projection.generation.contains_key(topic)
                );
            }
            if !projection.knot.is_empty() {
                coverage.hit("knot");
                if projection.generation.values().any(|g| *g > 0) {
                    coverage.hit("knot_with_dag");
                }
            }
            Ok(())
        })
        .unwrap();
    coverage.require(
        "V09 projection",
        &[
            "normal",
            "knot_connection",
            "in_card",
            "non_generational",
            "excluded",
            "knot",
            "knot_with_dag",
        ],
    );
}

#[test]
fn filter_never_changes_generation_or_knot_membership() {
    let case = (input(), prop::collection::btree_set(1u32..=6, 0..=6));
    runner(file!())
        .run(&case, |(input, visible)| {
            let full = project(&input, None);
            let filtered = project(&input, Some(&visible));
            for (topic, generation) in &filtered.generation {
                prop_assert_eq!(full.generation.get(topic), Some(generation));
            }
            for topic in &visible {
                prop_assert_eq!(full.knot.contains(topic), filtered.knot.contains(topic));
                prop_assert_eq!(full.generation.get(topic), filtered.generation.get(topic));
            }
            prop_assert_eq!(full.knot_generation, filtered.knot_generation);
            prop_assert_eq!(&full.class, &filtered.class);
            Ok(())
        })
        .unwrap();
}

#[test]
fn input_order_does_not_change_meaning() {
    let case = input().prop_flat_map(|input| {
        let blocks = Just(input.blocks.clone()).prop_shuffle();
        let relations = Just(input.relations.clone()).prop_shuffle();
        (Just(input), blocks, relations)
    });
    runner(file!())
        .run(&case, |(input, blocks, relations)| {
            let shuffled = Input {
                blocks,
                relations,
                types: input.types.clone(),
            };
            prop_assert_eq!(project(&input, None), project(&shuffled, None));
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
    input: Input,
    #[serde(default)]
    visible: Option<BTreeSet<TopicId>>,
    generation: BTreeMap<TopicId, u32>,
    knot: BTreeSet<TopicId>,
    knot_generation: Option<u32>,
    edges: Vec<(TopicId, TopicId, Vec<RelationId>)>,
    class: BTreeMap<RelationId, String>,
}

#[test]
fn shared_fixtures_match_the_contract() {
    let fixtures: Vec<Fixture> =
        serde_json::from_str(&read_fixture("v09_lineage.json")).expect("valid V09 fixture JSON");
    assert!(!fixtures.is_empty());
    for fixture in fixtures {
        let context = format!("{} ({})", fixture.id, fixture.contract);
        let projection = project(&fixture.input, fixture.visible.as_ref());
        assert_eq!(
            projection.generation, fixture.generation,
            "{context}: generation"
        );
        assert_eq!(projection.knot, fixture.knot, "{context}: knot");
        assert_eq!(
            projection.knot_generation, fixture.knot_generation,
            "{context}: knot_generation"
        );
        let edges: Vec<_> = projection
            .edges
            .iter()
            .map(|((src, dst), ids)| (*src, *dst, ids.iter().copied().collect::<Vec<_>>()))
            .collect();
        assert_eq!(edges, fixture.edges, "{context}: edges");
        let class: BTreeMap<_, _> = projection
            .class
            .iter()
            .map(|(id, c)| (*id, format!("{c:?}")))
            .collect();
        assert_eq!(class, fixture.class, "{context}: class");
    }
}
