//! Generations and Knots of the Topic graph built from generation-advancing card edges.
//!
//! Pure graph computation over Topic root IDs: no Relation, type or display knowledge. The caller
//! passes edges already in display direction (origin above derived) and without self-edges.
use super::projection::CardPair;
use crate::model::id::BlockId;
use petgraph::algo::tarjan_scc;
use petgraph::graph::{DiGraph, NodeIndex};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(super) struct Lineage {
    /// Generation of every non-Knot Topic: the longest chain of edges from a Topic without
    /// non-Knot origins, ignoring edges to and from Knot members (same rule as v2).
    pub generation: BTreeMap<BlockId, usize>,
    /// Each strongly connected component with more than one Topic, sorted.
    pub knots: Vec<BTreeSet<BlockId>>,
}

/// `edges` endpoints outside `topics` are ignored.
pub(super) fn lineage(topics: &BTreeSet<BlockId>, edges: &BTreeSet<CardPair>) -> Lineage {
    let mut graph: DiGraph<BlockId, ()> = DiGraph::new();
    let nodes: BTreeMap<BlockId, NodeIndex> = topics
        .iter()
        .map(|topic| (*topic, graph.add_node(*topic)))
        .collect();
    for edge in edges {
        if let (Some(from), Some(to)) = (nodes.get(&edge.from), nodes.get(&edge.to))
            && from != to
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

/// Longest-path generations over the non-Knot Topics (Kahn order; the result is independent of
/// which ready Topic is taken first).
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
