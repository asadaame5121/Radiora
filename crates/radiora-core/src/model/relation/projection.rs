//! Vertical-tree projection of typed Relations onto Topic cards (#381 contract, #409 V0).
//!
//! Everything here is regenerable read data keyed only by logical Block IDs and Topic root IDs:
//! it never writes back to Relations, holds no layout coordinates, and display filters apply
//! after it ([`VerticalTree::filtered`]), so a filter never changes generations or Knot
//! membership.
use super::lineage::lineage;
use super::{Direction, Relation, RelationStatus, RelationTypeName, RelationTypes};
use crate::model::id::{BlockId, RelationId};
use std::collections::{BTreeMap, BTreeSet};

/// Deleted state of a Block as observed by the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum EndpointState {
    /// Live Block (root, ordinary Block or reference item) and the root of the Topic it belongs
    /// to.
    Live {
        topic: BlockId,
    },
    InTrash,
    /// Purged or unknown. Block IDs absent from the projection input are Missing as well.
    Missing,
}

/// One Block of the projection input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TopicBlock {
    pub id: BlockId,
    pub state: EndpointState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ExclusionReason {
    Retracted,
    UnknownType,
    EndpointInTrash,
    EndpointMissing,
}

/// Cards connected by an edge, in display order. FROM (`New FROM Old`) is reversed so the origin
/// is on top; every other directed type, generation-advancing custom types included, keeps the
/// stored source on top. Symmetric pairs are ordered by Topic ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CardPair {
    pub from: BlockId,
    pub to: BlockId,
}

/// Where one original Relation went. Every input Relation has exactly one trace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelationTrace {
    /// Generation-advancing edge between two non-Knot cards: an edge of the layout DAG.
    Layout { pair: CardPair },
    /// Generation-advancing edge with a Knot member at either end. Drawn with its display
    /// direction, but not part of the layout DAG.
    KnotConnection { pair: CardPair },
    /// Edge between cards whose type does not advance generations.
    NonGenerational { pair: CardPair },
    /// Both endpoints belong to `topic` (self-loops and in-card cycles included): no card
    /// self-edge, not used for generations.
    InCard { topic: BlockId },
    /// Kept as stored but not projected; trash/Missing bodies are never shown.
    Excluded { reason: ExclusionReason },
}

impl RelationTrace {
    pub fn pair(&self) -> Option<CardPair> {
        match self {
            Self::Layout { pair }
            | Self::KnotConnection { pair }
            | Self::NonGenerational { pair } => Some(*pair),
            Self::InCard { .. } | Self::Excluded { .. } => None,
        }
    }
}

/// Aggregated edge between two cards, keeping the original Relation IDs and their types.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CardEdge {
    pub relations: BTreeSet<RelationId>,
    pub kinds: BTreeSet<RelationTypeName>,
}

impl CardEdge {
    /// Number of original Relations shown on the aggregated edge.
    pub fn count(&self) -> usize {
        self.relations.len()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardPlacement {
    Generation(usize),
    /// Member of the Knot identified by its smallest member Topic ID.
    Knot {
        knot: BlockId,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Card {
    pub placement: CardPlacement,
    pub in_card: BTreeSet<RelationId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VerticalTree {
    /// One card per Topic root that has a live Block.
    pub cards: BTreeMap<BlockId, Card>,
    pub edges: BTreeMap<CardPair, CardEdge>,
    /// Cycles of the Topic projection keyed by their smallest member. Only cycle members, never
    /// the acyclic Topics flowing into or out of them.
    pub knots: BTreeMap<BlockId, BTreeSet<BlockId>>,
    /// Row of the Knot area below every generation (v2 rule), if any Knot exists.
    pub knot_generation: Option<usize>,
    pub traces: BTreeMap<RelationId, RelationTrace>,
}

impl VerticalTree {
    pub fn generation(&self, topic: BlockId) -> Option<usize> {
        match self.cards.get(&topic)?.placement {
            CardPlacement::Generation(generation) => Some(generation),
            CardPlacement::Knot { .. } => None,
        }
    }

    /// Edges of the layout DAG between the cards present in this projection.
    pub fn layout_edges(&self) -> BTreeSet<CardPair> {
        self.traces
            .values()
            .filter_map(|trace| match trace {
                RelationTrace::Layout { pair } => Some(*pair),
                _ => None,
            })
            .filter(|pair| self.cards.contains_key(&pair.from) && self.cards.contains_key(&pair.to))
            .collect()
    }

    /// Display filter: hides cards outside `visible` and edges touching them. Generations, Knot
    /// IDs, the Knot row and traces are kept exactly as computed from the unfiltered input.
    pub fn filtered(&self, visible: &BTreeSet<BlockId>) -> Self {
        let shown = |topic: &BlockId| visible.contains(topic);
        Self {
            cards: self
                .cards
                .iter()
                .filter(|(topic, _)| shown(topic))
                .map(|(topic, card)| (*topic, card.clone()))
                .collect(),
            edges: self
                .edges
                .iter()
                .filter(|(pair, _)| shown(&pair.from) && shown(&pair.to))
                .map(|(pair, edge)| (*pair, edge.clone()))
                .collect(),
            knots: self
                .knots
                .iter()
                .map(|(id, members)| (*id, members.iter().copied().filter(shown).collect()))
                .filter(|(_, members): &(BlockId, BTreeSet<BlockId>)| !members.is_empty())
                .collect(),
            knot_generation: self.knot_generation,
            traces: self.traces.clone(),
        }
    }
}

enum Classified<'a> {
    Pair {
        pair: CardPair,
        kind: &'a RelationTypeName,
        advances_generation: bool,
    },
    InCard(BlockId),
    Excluded(ExclusionReason),
}

fn classify<'a>(
    relation: &'a Relation,
    types: &RelationTypes,
    state: &impl Fn(BlockId) -> EndpointState,
) -> Classified<'a> {
    if relation.status == RelationStatus::Retracted {
        return Classified::Excluded(ExclusionReason::Retracted);
    }
    let Some(definition) = types.get(&relation.kind) else {
        return Classified::Excluded(ExclusionReason::UnknownType);
    };
    let (source, target) = match (state(relation.source), state(relation.target)) {
        (EndpointState::Live { topic: s }, EndpointState::Live { topic: t }) => (s, t),
        (EndpointState::Missing, _) | (_, EndpointState::Missing) => {
            return Classified::Excluded(ExclusionReason::EndpointMissing);
        }
        _ => return Classified::Excluded(ExclusionReason::EndpointInTrash),
    };
    if source == target {
        return Classified::InCard(source);
    }
    let pair = match definition.direction {
        Direction::Symmetric => CardPair {
            from: source.min(target),
            to: source.max(target),
        },
        Direction::Directed if definition.display_reversed() => CardPair {
            from: target,
            to: source,
        },
        Direction::Directed => CardPair {
            from: source,
            to: target,
        },
    };
    Classified::Pair {
        pair,
        kind: &relation.kind,
        advances_generation: definition.advances_generation
            && definition.direction == Direction::Directed,
    }
}

/// Projects Relations onto Topic cards and computes generations and Knots from every valid
/// generation-advancing Relation, before any display filter.
///
/// Preconditions: Block IDs and Relation IDs are unique. If a Block ID repeats, the smallest
/// state wins so the result still does not depend on input order.
pub fn project_vertical_tree<'a>(
    blocks: impl IntoIterator<Item = TopicBlock>,
    relations: impl IntoIterator<Item = &'a Relation>,
    types: &RelationTypes,
) -> VerticalTree {
    let mut states: BTreeMap<BlockId, EndpointState> = BTreeMap::new();
    for block in blocks {
        states
            .entry(block.id)
            .and_modify(|state| *state = (*state).min(block.state))
            .or_insert(block.state);
    }
    let topics: BTreeSet<BlockId> = states
        .values()
        .filter_map(|state| match state {
            EndpointState::Live { topic } => Some(*topic),
            EndpointState::InTrash | EndpointState::Missing => None,
        })
        .collect();
    let state = |id: BlockId| states.get(&id).copied().unwrap_or(EndpointState::Missing);

    let mut tree = VerticalTree::default();
    let mut in_card: BTreeMap<BlockId, BTreeSet<RelationId>> = BTreeMap::new();
    let mut advancing: BTreeMap<RelationId, CardPair> = BTreeMap::new();
    for relation in relations {
        let trace = match classify(relation, types, &state) {
            Classified::Excluded(reason) => RelationTrace::Excluded { reason },
            Classified::InCard(topic) => {
                in_card.entry(topic).or_default().insert(relation.id);
                RelationTrace::InCard { topic }
            }
            Classified::Pair {
                pair,
                kind,
                advances_generation,
            } => {
                let edge = tree.edges.entry(pair).or_default();
                edge.relations.insert(relation.id);
                edge.kinds.insert(kind.clone());
                if advances_generation {
                    advancing.insert(relation.id, pair);
                }
                // Layout vs Knot connection is decided once Knots are known.
                RelationTrace::NonGenerational { pair }
            }
        };
        tree.traces.insert(relation.id, trace);
    }

    let lineage = lineage(&topics, &advancing.values().copied().collect());
    let knot_of: BTreeMap<BlockId, BlockId> = lineage
        .knots
        .iter()
        .filter_map(|members| members.first().map(|id| (*id, members)))
        .flat_map(|(id, members)| members.iter().map(move |member| (*member, id)))
        .collect();
    for (relation, pair) in advancing {
        let touches_knot = knot_of.contains_key(&pair.from) || knot_of.contains_key(&pair.to);
        let trace = if touches_knot {
            RelationTrace::KnotConnection { pair }
        } else {
            RelationTrace::Layout { pair }
        };
        tree.traces.insert(relation, trace);
    }
    tree.knot_generation = (!lineage.knots.is_empty())
        .then(|| lineage.generation.values().max().map_or(0, |max| max + 1));
    tree.cards = topics
        .into_iter()
        .map(|topic| {
            let placement = match knot_of.get(&topic) {
                Some(knot) => CardPlacement::Knot { knot: *knot },
                None => {
                    CardPlacement::Generation(lineage.generation.get(&topic).copied().unwrap_or(0))
                }
            };
            let card = Card {
                placement,
                in_card: in_card.remove(&topic).unwrap_or_default(),
            };
            (topic, card)
        })
        .collect();
    tree.knots = lineage
        .knots
        .into_iter()
        .filter_map(|members| members.first().copied().map(|id| (id, members)))
        .collect();
    tree
}
