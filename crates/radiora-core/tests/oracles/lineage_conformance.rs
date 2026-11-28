//! V09 conformance: the product projection (`radiora_core::model::project_vertical_tree`) agrees
//! with the independent V09 oracle in `lineage.rs` on the shared fixtures and on random inputs,
//! with and without a display filter (#409).
//!
//! The oracle finds cycles with a reachability matrix and generations with memoised longest
//! paths; the product uses Tarjan SCC and Kahn order. Only the input/output shapes are mapped
//! here, never the algorithm.

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;
use radiora_core::model::{
    BlockId, Direction, EndpointState, ExclusionReason, Relation, RelationId, RelationStatus,
    RelationTrace, RelationTypeName, RelationTypes, TopicBlock, VerticalTree,
    project_vertical_tree,
};
use serde::Deserialize;
use uuid::{Builder, Uuid, Variant, Version};

use crate::lineage::{self, BlockState, Class, Input, Projection, TopicId};
use crate::support::{read_fixture, runner};

fn v7(seed: u32, tag: u8) -> Uuid {
    let mut bytes = [tag; 16];
    bytes[..4].copy_from_slice(&seed.to_be_bytes());
    Builder::from_random_bytes(bytes)
        .with_version(Version::SortRand)
        .with_variant(Variant::RFC4122)
        .into_uuid()
}

/// Oracle Block, Topic and Relation numbers live in separate ID spaces; the big-endian seed
/// prefix keeps the oracle's numeric order.
fn block_id(seed: u32) -> BlockId {
    BlockId::from_uuid(v7(seed, 0xB0)).expect("UUIDv7")
}
fn topic_id(seed: TopicId) -> BlockId {
    BlockId::from_uuid(v7(seed, 0x70)).expect("UUIDv7")
}
fn relation_id(seed: u32) -> RelationId {
    RelationId::from_uuid(v7(seed, 0xA0)).expect("UUIDv7")
}

fn product_types(input: &Input) -> RelationTypes {
    let mut types = RelationTypes::built_in();
    for kind in &input.types {
        let name = RelationTypeName::normalize(&kind.name).expect("valid type name");
        match types.get(&name) {
            Some(built_in) => {
                assert_eq!(built_in.display_reversed(), kind.display_reversed, "{name}");
                assert_eq!(
                    built_in.advances_generation, kind.advances_generation,
                    "{name}"
                );
            }
            None => {
                // Only FROM is displayed reversed (adopted 2026-11-27).
                assert!(!kind.display_reversed, "{name}");
                types
                    .add_custom(&kind.name, Direction::Directed, kind.advances_generation)
                    .expect("custom type");
            }
        }
    }
    types
}

fn product_project(input: &Input) -> VerticalTree {
    let blocks = input.blocks.iter().map(|block| TopicBlock {
        id: block_id(block.id),
        state: match block.state {
            BlockState::Live => EndpointState::Live {
                topic: topic_id(block.topic),
            },
            BlockState::Trash => EndpointState::InTrash,
            BlockState::Missing => EndpointState::Missing,
        },
    });
    let relations: Vec<Relation> = input
        .relations
        .iter()
        .map(|relation| Relation {
            id: relation_id(relation.id),
            kind: RelationTypeName::normalize(&relation.kind).expect("valid type name"),
            source: block_id(relation.from),
            target: block_id(relation.to),
            status: RelationStatus::Asserted,
        })
        .collect();
    project_vertical_tree(blocks, &relations, &product_types(input))
}

/// Maps the product result back to the oracle's numbering.
fn as_oracle(input: &Input, tree: &VerticalTree) -> Projection {
    let topics: BTreeMap<BlockId, TopicId> = input
        .blocks
        .iter()
        .map(|block| (topic_id(block.topic), block.topic))
        .collect();
    let relations: BTreeMap<RelationId, u32> = input
        .relations
        .iter()
        .map(|relation| (relation_id(relation.id), relation.id))
        .collect();
    let topic = |id: &BlockId| topics[id];
    let generation = tree
        .cards
        .keys()
        .filter_map(|id| {
            let generation = tree.generation(*id)?;
            Some((
                topic(id),
                u32::try_from(generation).expect("small generation"),
            ))
        })
        .collect();
    let knot = tree.knots.values().flatten().map(topic).collect();
    let knot_generation = tree
        .knot_generation
        .map(|generation| u32::try_from(generation).expect("small generation"));
    let edges = tree
        .edges
        .iter()
        .map(|(pair, edge)| {
            let ids: BTreeSet<u32> = edge.relations.iter().map(|id| relations[id]).collect();
            ((topic(&pair.from), topic(&pair.to)), ids)
        })
        .collect();
    let class = tree
        .traces
        .iter()
        .map(|(id, trace)| {
            let class = match trace {
                RelationTrace::Layout { .. } => Class::Normal,
                RelationTrace::KnotConnection { .. } => Class::KnotConnection,
                RelationTrace::NonGenerational { .. } => Class::NonGenerational,
                RelationTrace::InCard { .. } => Class::InCard,
                RelationTrace::Excluded {
                    reason: ExclusionReason::EndpointInTrash | ExclusionReason::EndpointMissing,
                } => Class::ExcludedEndpoint,
                RelationTrace::Excluded { reason } => {
                    panic!("oracle inputs are asserted with known types: {reason:?}")
                }
            };
            (relations[id], class)
        })
        .collect();
    Projection {
        generation,
        knot,
        knot_generation,
        edges,
        class,
    }
}

fn product(input: &Input, visible: Option<&BTreeSet<TopicId>>) -> Projection {
    let tree = product_project(input);
    let tree = match visible {
        Some(visible) => tree.filtered(&visible.iter().copied().map(topic_id).collect()),
        None => tree,
    };
    as_oracle(input, &tree)
}

#[derive(Deserialize)]
struct FixtureInput {
    id: String,
    input: Input,
    #[serde(default)]
    visible: Option<BTreeSet<TopicId>>,
}

#[test]
fn product_matches_the_oracle_on_shared_fixtures() {
    let fixtures: Vec<FixtureInput> =
        serde_json::from_str(&read_fixture("v09_lineage.json")).expect("valid V09 fixture JSON");
    assert!(!fixtures.is_empty());
    for fixture in fixtures {
        let visible = fixture.visible.as_ref();
        assert_eq!(
            product(&fixture.input, visible),
            lineage::project(&fixture.input, visible),
            "{}",
            fixture.id
        );
    }
}

#[test]
fn product_matches_the_oracle_on_random_inputs() {
    let case = (
        lineage::input(),
        prop::option::of(prop::collection::btree_set(1u32..=10, 0..=8)),
    );
    runner(file!())
        .run(&case, |(input, visible)| {
            prop_assert_eq!(
                product(&input, visible.as_ref()),
                lineage::project(&input, visible.as_ref())
            );
            Ok(())
        })
        .unwrap();
}
