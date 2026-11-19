//! Card (Topic) projection and lineage of Relations. Everything here is regenerable display
//! data: it never writes back to Relations, and display filters apply after it, so filters never
//! change generations or Knot membership.
use super::{Direction, Relation, RelationStatus, RelationTypeName, RelationTypes};
use crate::model::id::{BlockId, RelationId};
use petgraph::algo::tarjan_scc;
use petgraph::graph::{DiGraph, NodeIndex};
use std::collections::{BTreeMap, BTreeSet};

/// State of a Relation endpoint, observed from the workspace by the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointState {
    /// Live Block (root, ordinary Block or reference item) and the Topic it belongs to.
    Live {
        topic: BlockId,
    },
    InTrash,
    /// Purged or unknown.
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExclusionReason {
    Retracted,
    UnknownType,
    EndpointInTrash,
    EndpointMissing,
}

/// A kept Relation that is not projected. Trash/Missing Relations are preserved, never shown
/// with deleted bodies, and never used for lineage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Excluded {
    pub relation: RelationId,
    pub reason: ExclusionReason,
}

/// Cards connected by an edge, in display order. Directed Relations use their display direction
/// (origin → derived for generation types, source → target otherwise); symmetric pairs are
/// ordered by Topic ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CardPair {
    pub from: BlockId,
    pub to: BlockId,
}

/// Aggregated edge between two cards, keeping the original Relation IDs (their count is the
/// number shown) and types.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CardEdge {
    pub relations: BTreeSet<RelationId>,
    pub kinds: BTreeSet<RelationTypeName>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TopicProjection {
    /// Relations whose endpoints share a Topic, including self-loops and in-card cycles. They
    /// make no card self-edge and are not used for lineage.
    pub in_card: BTreeMap<BlockId, BTreeSet<RelationId>>,
    pub edges: BTreeMap<CardPair, CardEdge>,
    pub excluded: Vec<Excluded>,
}

/// Live endpoints of an asserted Relation with a known type, as display-ordered Topics.
enum Projected<'a> {
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
    endpoint: &impl Fn(BlockId) -> EndpointState,
) -> Projected<'a> {
    if relation.status == RelationStatus::Retracted {
        return Projected::Excluded(ExclusionReason::Retracted);
    }
    let Some(definition) = types.get(&relation.kind) else {
        return Projected::Excluded(ExclusionReason::UnknownType);
    };
    let (source, target) = match (endpoint(relation.source), endpoint(relation.target)) {
        (EndpointState::Live { topic: s }, EndpointState::Live { topic: t }) => (s, t),
        (EndpointState::Missing, _) | (_, EndpointState::Missing) => {
            return Projected::Excluded(ExclusionReason::EndpointMissing);
        }
        _ => return Projected::Excluded(ExclusionReason::EndpointInTrash),
    };
    if source == target {
        return Projected::InCard(source);
    }
    let pair = match (definition.direction, definition.advances_generation) {
        (Direction::Symmetric, _) => CardPair {
            from: source.min(target),
            to: source.max(target),
        },
        (Direction::Directed, true) => CardPair {
            from: target,
            to: source,
        },
        (Direction::Directed, false) => CardPair {
            from: source,
            to: target,
        },
    };
    Projected::Pair {
        pair,
        kind: &relation.kind,
        advances_generation: definition.advances_generation
            && definition.direction == Direction::Directed,
    }
}

pub fn project_to_topics<'a>(
    relations: impl IntoIterator<Item = &'a Relation>,
    types: &RelationTypes,
    endpoint: impl Fn(BlockId) -> EndpointState,
) -> TopicProjection {
    let mut projection = TopicProjection::default();
    for relation in relations {
        match classify(relation, types, &endpoint) {
            Projected::Excluded(reason) => projection.excluded.push(Excluded {
                relation: relation.id,
                reason,
            }),
            Projected::InCard(topic) => {
                projection
                    .in_card
                    .entry(topic)
                    .or_default()
                    .insert(relation.id);
            }
            Projected::Pair { pair, kind, .. } => {
                let edge = projection.edges.entry(pair).or_default();
                edge.relations.insert(relation.id);
                edge.kinds.insert(kind.clone());
            }
        }
    }
    projection
}

/// Generations and Knots of the Topic projection.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Lineage {
    /// Generation of every non-Knot Topic: the longest chain of generation Relations from a
    /// Topic without origins, ignoring edges to and from Knot members (same rule as v2).
    pub generation: BTreeMap<BlockId, usize>,
    /// Each cycle of the Topic projection, separated from the acyclic Topics around it.
    pub knots: Vec<BTreeSet<BlockId>>,
}

/// Computes lineage over `topics` from the asserted, live, cross-Topic Relations whose type
/// advances generation. Cycles inside one Topic are in-card and do not form Knots.
pub fn lineage<'a>(
    topics: impl IntoIterator<Item = BlockId>,
    relations: impl IntoIterator<Item = &'a Relation>,
    types: &RelationTypes,
    endpoint: impl Fn(BlockId) -> EndpointState,
) -> Lineage {
    let mut graph: DiGraph<BlockId, ()> = DiGraph::new();
    let nodes: BTreeMap<BlockId, NodeIndex> = topics
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|topic| (topic, graph.add_node(topic)))
        .collect();
    for relation in relations {
        if let Projected::Pair {
            pair,
            advances_generation: true,
            ..
        } = classify(relation, types, &endpoint)
            && let (Some(from), Some(to)) = (nodes.get(&pair.from), nodes.get(&pair.to))
            && graph.find_edge(*from, *to).is_none()
        {
            graph.add_edge(*from, *to, ());
        }
    }
    let mut knots: Vec<BTreeSet<BlockId>> = tarjan_scc(&graph)
        .into_iter()
        .filter(|component| component.len() > 1)
        .map(|component| component.into_iter().map(|node| graph[node]).collect())
        .collect();
    knots.sort();
    let in_knot: BTreeSet<BlockId> = knots.iter().flatten().copied().collect();
    let generation = acyclic_generations(&graph, &nodes, &in_knot);
    Lineage { generation, knots }
}

fn acyclic_generations(
    graph: &DiGraph<BlockId, ()>,
    nodes: &BTreeMap<BlockId, NodeIndex>,
    in_knot: &BTreeSet<BlockId>,
) -> BTreeMap<BlockId, usize> {
    let active = |node: NodeIndex| !in_knot.contains(&graph[node]);
    let mut indegree: BTreeMap<NodeIndex, usize> = BTreeMap::new();
    let mut generation: BTreeMap<BlockId, usize> = BTreeMap::new();
    let mut ready = Vec::new();
    for (topic, node) in nodes {
        if !active(*node) {
            continue;
        }
        let degree = graph
            .neighbors_directed(*node, petgraph::Direction::Incoming)
            .filter(|parent| active(*parent))
            .count();
        indegree.insert(*node, degree);
        generation.insert(*topic, 0);
        if degree == 0 {
            ready.push(*node);
        }
    }
    while let Some(parent) = ready.pop() {
        let next = generation.get(&graph[parent]).copied().unwrap_or(0) + 1;
        for child in graph.neighbors(parent).filter(|child| active(*child)) {
            let current = generation.entry(graph[child]).or_insert(0);
            *current = (*current).max(next);
            if let Some(degree) = indegree.get_mut(&child) {
                *degree -= 1;
                if *degree == 0 {
                    ready.push(child);
                }
            }
        }
    }
    generation
}
