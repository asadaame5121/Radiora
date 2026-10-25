module document_model

// Bounded specification model, NOT a model of Loro's implementation.
// Block atoms stand for immutable, workspace-wide logical UUIDs.
// Text atoms abstract strings (including the empty string).
abstract sig Position {}
one sig Start extends Position {}
sig Block extends Position {}
sig Text {}
sig State {
  issued: set Block,
  dead: set Block,
  purged: set Block,
  parent: Block -> lone Block,
  order: Block -> Block,
  body: Block -> lone Text,
  reference: Block -> lone Block,
  links: Block -> Block,
  relations: Block -> Block,
  view: lone Block
}

fun retained[s: State]: set Block { s.issued - s.purged }
fun live[s: State]: set Block { retained[s] - s.dead }
fun roots[s: State]: set Block { retained[s] - (s.parent).Block }
fun document[s: State, b: Block]: set Block {
  b.*(s.parent) & roots[s]
}
fun subtree[s: State, b: Block]: set Block {
  b.*(~(s.parent))
}
fun previous[s: State, b: Block]: set Block {
  { x: retained[s] |
    x->b in s.order and
    no y: retained[s] | x->y in s.order and y->b in s.order }
}
fun displayed[s: State, b: Block]: set Text {
  (b & live[s]).(s.body) +
  ((b & live[s]).(s.reference) & live[s]).(s.body)
}

pred wellFormed[s: State] {
  s.dead + s.purged in s.issued
  no s.dead & s.purged
  s.parent in retained[s] -> retained[s]
  no iden & ^(s.parent)
  live[s].(s.parent) in live[s]
  s.order in retained[s] -> retained[s]
  no iden & s.order
  (s.order).(s.order) in s.order
  all disj a, b: retained[s] |
    (a->b in s.order or b->a in s.order)
      iff a.(s.parent) = b.(s.parent)
  s.reference in retained[s] -> s.issued
  // Interpretation: a reference item points directly to an owning block.
  no (Block.(s.reference)) & ((s.reference).Block)
  s.body in (retained[s] - (s.reference).Block) -> Text
  all b: retained[s] - (s.reference).Block | one b.(s.body)
  s.links + s.relations in s.issued -> s.issued
  s.view in live[s]
}

pred unchangedData[s, t: State] {
  t.issued = s.issued
  t.dead = s.dead
  t.purged = s.purged
  t.body = s.body
  t.reference = s.reference
  t.links = s.links
  t.relations = s.relations
  t.view = s.view
}

// Insert b after prev under p. none as prev means first sibling.
// p = none makes b a document root. The caller must authorize this.
pred place[s, t: State, b: Block, p, prev: set Block] {
  wellFormed[s]
  b in live[s]
  lone p
  p in live[s] - subtree[s, b]
  lone prev
  let siblings = { x: retained[s] - b | x.(s.parent) = p },
      prefix = (prev.*(~(s.order))) & siblings,
      suffix = siblings - prefix {
    prev in siblings
    t.parent = (s.parent - b->Block) + b->p
    t.order = (s.order - (b->Block + Block->b)) +
      prefix->b + b->suffix
  }
  unchangedData[s, t]
}

pred normalMove[s, t: State, b, p: Block, prev: Position] {
  some b.(s.parent)
  document[s, b] = document[s, p]
  place[s, t, b, p, prev & Block]
}

pred crossDocumentMove[s, t: State, b, p: Block, prev: Position] {
  some b.(s.parent)
  document[s, b] != document[s, p]
  place[s, t, b, p, prev & Block]
}

pred cutOut[s, t: State, b: Block] {
  some b.(s.parent)
  // Chosen presentation policy: append the new root after existing roots.
  place[s, t, b, none, previousRoot[s]]
}

fun previousRoot[s: State]: set Block {
  { r: roots[s] | no r.(s.order) }
}

pred structuralStep[s, t: State] {
  (some b, p: Block, prev: Position |
    normalMove[s, t, b, p, prev] or
    crossDocumentMove[s, t, b, p, prev])
  or (some b: Block | cutOut[s, t, b])
}

pred rootEnter[s, t: State, root, fresh: Block, text: Text] {
  wellFormed[s]
  root in roots[s] & live[s]
  fresh not in s.issued
  t.issued = s.issued + fresh
  t.dead = s.dead
  t.purged = s.purged
  t.parent = s.parent + fresh->root
  t.order = s.order +
    fresh->{ x: retained[s] | x.(s.parent) = root }
  t.body = s.body + fresh->text
  t.reference = s.reference
  t.links = s.links
  t.relations = s.relations
  t.view = s.view
}

pred duplicateLeaf[s, t: State, original, fresh: Block] {
  wellFormed[s]
  original in live[s] - (s.reference).Block
  no original.~(s.parent)
  fresh not in s.issued
  t.issued = s.issued + fresh
  t.dead = s.dead
  t.purged = s.purged
  t.parent = s.parent + fresh->(original.(s.parent))
  let earlier = { x: retained[s] |
    x.(s.parent) = original.(s.parent) and
    (x = original or x->original in s.order) },
      later = { x: retained[s] | original->x in s.order } {
    t.order = s.order + earlier->fresh + fresh->later
  }
  t.body = s.body + fresh->(original.(s.body))
  t.reference = s.reference
  t.links = s.links
  t.relations = s.relations
  t.view = s.view
}

// Chosen deletion policy: tombstone the entire subtree, retain its structure.
// Restore/purge policy is an explicit interpretation, not a settled UI spec.
pred removeSubtree[s, t: State, b: Block] {
  wellFormed[s]
  b in live[s]
  t.dead = s.dead + subtree[s, b]
  t.view = s.view - subtree[s, b]
  t.issued = s.issued
  t.purged = s.purged
  t.parent = s.parent
  t.order = s.order
  t.body = s.body
  t.reference = s.reference
  t.links = s.links
  t.relations = s.relations
}

pred restoreSubtree[s, t: State, b: Block] {
  wellFormed[s]
  b in s.dead
  b.(s.parent) in live[s]
  t.dead = s.dead - subtree[s, b]
  t.issued = s.issued
  t.purged = s.purged
  t.parent = s.parent
  t.order = s.order
  t.body = s.body
  t.reference = s.reference
  t.links = s.links
  t.relations = s.relations
  t.view = s.view
}

pred purgeSubtree[s, t: State, b: Block] {
  wellFormed[s]
  b in s.dead
  let gone = subtree[s, b] {
    t.purged = s.purged + gone
    t.dead = s.dead - gone
    t.parent = s.parent - (gone->Block + Block->gone)
    t.order = s.order - (gone->Block + Block->gone)
    t.body = s.body - gone->Text
    t.reference = s.reference - gone->Block
  }
  t.issued = s.issued
  t.links = s.links
  t.relations = s.relations
  t.view = s.view
}

pred hoist[s, t: State, b: Block] {
  wellFormed[s]
  b in live[s]
  t.view = b
  t.issued = s.issued
  t.dead = s.dead
  t.purged = s.purged
  t.parent = s.parent
  t.order = s.order
  t.body = s.body
  t.reference = s.reference
  t.links = s.links
  t.relations = s.relations
}

pred editBody[s, t: State, b: Block, text: Text] {
  wellFormed[s]
  b in live[s] - (s.reference).Block
  t.body = s.body ++ b->text
  t.issued = s.issued
  t.dead = s.dead
  t.purged = s.purged
  t.parent = s.parent
  t.order = s.order
  t.reference = s.reference
  t.links = s.links
  t.relations = s.relations
  t.view = s.view
}

pred step[s, t: State] {
  structuralStep[s, t]
  or (some r, b: Block, text: Text | rootEnter[s, t, r, b, text])
  or (some a, b: Block | duplicateLeaf[s, t, a, b])
  or (some b: Block |
    removeSubtree[s, t, b] or restoreSubtree[s, t, b] or
    purgeSubtree[s, t, b] or hoist[s, t, b])
}

assert OperationsPreserveStructure {
  all s, t: State | step[s, t] implies wellFormed[t]
}
assert EveryRetainedBlockHasOneDocument {
  all s: State | wellFormed[s] implies
    (all b: retained[s] | one document[s, b])
}
assert NormalMoveCannotChangeDocument {
  all s, t: State, b, p: Block, prev: Position |
    normalMove[s, t, b, p, prev] implies
      (all x: retained[s] | document[s, x] = document[t, x])
}
assert RootCannotBeDemotedByMove {
  all s, t: State |
    structuralStep[s, t] implies roots[s] in roots[t]
}
assert CutOutPreservesDescendantIdentity {
  all s, t: State, b: Block | cutOut[s, t, b] implies
    (subtree[s, b] = subtree[t, b] and
     document[t, b] = b and t.issued = s.issued)
}
assert HoistDoesNotChangeMembership {
  all s, t: State, b: Block | hoist[s, t, b] implies
    (all x: retained[s] | document[s, x] = document[t, x])
}
assert IssuedIDsNeverBecomeAvailable {
  all s, t: State | step[s, t] implies s.issued in t.issued
}
assert PurgeRetainsReferencesWithoutRewiring {
  all s, t: State, b: Block | purgeSubtree[s, t, b] implies
    (t.links = s.links and t.relations = s.relations and
     t.issued = s.issued and no subtree[s, b].(t.body))
}
assert RootEnterCreatesFirstChildNotNewDocument {
  all s, t: State, r, b: Block, text: Text |
    rootEnter[s, t, r, b, text] implies
      (roots[s] = roots[t] and b.(t.parent) = r and
       no { x: retained[t] | x->b in t.order })
}
assert BodyEditPreservesStructure {
  all s, t: State, b: Block, text: Text |
    editBody[s, t, b, text] implies wellFormed[t]
}
assert SharedViewsReflectOwnerEdit {
  all s, t: State, owner: Block, text: Text |
    editBody[s, t, owner, text] implies
      (all r: live[s] | r.(s.reference) = owner implies displayed[t, r] = text)
}
// Undo uses the saved logical parent AND previous sibling, not TreeID.
// Immediate, isolated undo only; concurrent history/UndoManager not modeled.
assert SavedPositionUndoRestoresStructure {
  all disj s, t, u: State, b: Block, p, prev: Position |
    (some b.(s.parent) and place[s, t, b, p & Block, prev & Block] and
     place[t, u, b, b.(s.parent), previous[s, b]]) implies
      (u.parent = s.parent and u.order = s.order and
       u.body = s.body and u.reference = s.reference and u.issued = s.issued)
}

// Deliberately false controls: the analyzer MUST find counterexamples.
assert NaiveUndoToFirstSiblingRestoresOrder {
  all disj s, t, u: State, b: Block, p, prev: Position |
    (some b.(s.parent) and place[s, t, b, p & Block, prev & Block] and
     place[t, u, b, b.(s.parent), none]) implies u.order = s.order
}
assert NaiveGenericMoveKeepsDocumentBoundary {
  all s, t: State, b: Block, prev: Position |
    (some b.(s.parent) and place[s, t, b, none, prev & Block]) implies
      document[s, b] = document[t, b]
}

// SAT witnesses prevent "all checks passed because no operation is possible".
run rootEnter for 5 but 4 Block, exactly 2 State, 2 Text expect 1
run normalMove for 5 but 4 Block, exactly 2 State, 2 Text expect 1
run crossDocumentMove for 5 but 4 Block, exactly 2 State, 2 Text expect 1
run cutOut for 5 but 4 Block, exactly 2 State, 2 Text expect 1
run duplicateLeaf for 5 but 4 Block, exactly 2 State, 2 Text expect 1
run removeSubtree for 5 but 4 Block, exactly 2 State, 2 Text expect 1
run restoreSubtree for 5 but 4 Block, exactly 2 State, 2 Text expect 1
run purgeSubtree for 5 but 4 Block, exactly 2 State, 2 Text expect 1
run hoist for 5 but 4 Block, exactly 2 State, 2 Text expect 1
check OperationsPreserveStructure for 6 but 5 Block, exactly 2 State, 2 Text expect 0
check EveryRetainedBlockHasOneDocument for 6 but 5 Block, exactly 1 State, 2 Text expect 0
check NormalMoveCannotChangeDocument for 6 but 5 Block, exactly 2 State, 2 Text expect 0
check RootCannotBeDemotedByMove for 6 but 5 Block, exactly 2 State, 2 Text expect 0
check CutOutPreservesDescendantIdentity for 6 but 5 Block, exactly 2 State, 2 Text expect 0
check HoistDoesNotChangeMembership for 6 but 5 Block, exactly 2 State, 2 Text expect 0
check IssuedIDsNeverBecomeAvailable for 6 but 5 Block, exactly 2 State, 2 Text expect 0
check PurgeRetainsReferencesWithoutRewiring for 5 but 4 Block, exactly 2 State, 2 Text expect 0
check RootEnterCreatesFirstChildNotNewDocument for 5 but 4 Block, exactly 2 State, 2 Text expect 0
check SavedPositionUndoRestoresStructure for 5 but 4 Block, exactly 3 State, 2 Text expect 0
check NaiveUndoToFirstSiblingRestoresOrder for 5 but 4 Block, exactly 3 State, 2 Text expect 1
check NaiveGenericMoveKeepsDocumentBoundary for 5 but 4 Block, exactly 2 State, 2 Text expect 1
run {
  some disj s, t: State, disj owner, ref, child: Block, text: Text |
    editBody[s, t, owner, text] and
    ref in live[s] and ref.(s.reference) = owner and
    child in live[s] and child.(s.parent) = ref and
    owner.(s.body) != text
} for 5 but 4 Block, exactly 2 State, exactly 2 Text expect 1
check BodyEditPreservesStructure for 5 but 4 Block, exactly 2 State, 2 Text expect 0
check SharedViewsReflectOwnerEdit for 5 but 4 Block, exactly 2 State, 2 Text expect 0
