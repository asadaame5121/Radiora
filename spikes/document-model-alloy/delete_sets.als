module delete_sets

// A02 (v3-verification-plan.md §6): independent trash items created by each
// ordinary delete, restore placement, and purge of exactly one item.
// Contract: v3-model-decisions.md "通常削除・復元・参照先削除の採用契約".
//
// Abstractions (not product decisions):
// - parentOf is the current placement. Deleted blocks keep their last parent so
//   restore can decide between the original parent and an independent document.
// - Sibling order, text, IDs and Undo are out of scope (V12 PBT / A01).
// - Trash items are not edited or moved while in trash (initial v3 contract).
abstract sig Block {}
sig Plain extends Block {}
sig Reference extends Block { target: one Block }
sig Item { root: one Block, members: set Block }
abstract sig Consent {}
one sig Accepted, Declined extends Consent {}

sig State {
  parentOf: Block -> lone Block,
  deleted: set Block,
  purged: set Block,
  items: set Item
}

fun live[s: State]: set Block { Block - s.deleted - s.purged }
fun under[s: State, b: Block]: set Block { b.*(~(s.parentOf)) }
fun originalParent[s: State, i: Item]: lone Block { s.parentOf[i.root] }
pred parentAvailable[s: State, i: Item] {
  no originalParent[s, i] or originalParent[s, i] in live[s]
}

pred initial[s: State] {
  no iden & ^(s.parentOf)
  no s.deleted + s.purged
  no s.items
}

// An inductive safety candidate, NOT a fact imposed on every state.
pred safe[s: State] {
  no iden & ^(s.parentOf)
  s.deleted = s.items.members
  no s.deleted & s.purged
  all disj i, j: s.items | no i.members & j.members
  all i: s.items {
    i.root in i.members
    i.members in under[s, i.root]
    all m: i.members - i.root | s.parentOf[m] in i.members
  }
  // The live outline is closed upward: no live block hangs under trash/purged.
  all b: live[s] | s.parentOf[b] in live[s]
}

// Ordinary delete: the target and its descendants that are still live.
// Earlier trash items under the target stay separate items.
pred delete[s, t: State, i: Item, b: Block] {
  b in live[s]
  i not in s.items
  i.root = b
  i.members = under[s, b] & live[s]
  t.deleted = s.deleted + i.members
  t.items = s.items + i
  t.purged = s.purged
  t.parentOf = s.parentOf
}

// Restore exactly the set this delete created. If the original parent is
// unavailable, restore as an independent document only after confirmation.
pred restore[s, t: State, i: Item, c: Consent] {
  i in s.items
  parentAvailable[s, i] implies t.parentOf = s.parentOf
  not parentAvailable[s, i] implies {
    c = Accepted
    t.parentOf = s.parentOf - (i.root -> Block)
  }
  t.deleted = s.deleted - i.members
  t.items = s.items - i
  t.purged = s.purged
}

// Purge exactly the selected item; never follow the original tree.
pred purge[s, t: State, i: Item] {
  i in s.items
  t.purged = s.purged + i.members
  t.deleted = s.deleted - i.members
  t.items = s.items - i
  t.parentOf = s.parentOf
}

pred step[s, t: State] {
  (some i: Item, b: Block | delete[s, t, i, b])
  or (some i: Item, c: Consent | restore[s, t, i, c])
  or (some i: Item | purge[s, t, i])
}

// ---- Positive checks ----

assert InitialIsSafe {
  all s: State | initial[s] implies safe[s]
}
assert EveryStepPreservesSafety {
  all s, t: State | safe[s] and step[s, t] implies safe[t]
}
assert EarlierItemSurvivesParentRestore {
  all s, t: State, i: Item, c: Consent | (safe[s] and restore[s, t, i, c]) implies
    all j: s.items - i | j in t.items and j.members in t.deleted
}
assert EarlierItemSurvivesParentPurge {
  all s, t: State, i: Item | (safe[s] and purge[s, t, i]) implies
    all j: s.items - i | j in t.items and no j.members & t.purged
}
assert PurgeMatchesConfirmedSet {
  all s, t: State, i: Item | (safe[s] and purge[s, t, i]) implies t.purged - s.purged = i.members
}
assert NoReferenceCascade {
  all s, t: State, i: Item, b: Block | (safe[s] and delete[s, t, i, b]) implies {
    i.members in under[s, b]
    all r: Reference & live[s] - under[s, b] | r in live[t]
  }
}
assert RestoreNeverUsesUnavailableParent {
  all s, t: State, i: Item, c: Consent | (safe[s] and restore[s, t, i, c]) implies
    (no t.parentOf[i.root] or t.parentOf[i.root] in live[t])
}
assert IndependentRestoreNeedsConfirmation {
  all s, t: State, i: Item, c: Consent |
    (restore[s, t, i, c] and not parentAvailable[s, i]) implies c = Accepted
}
assert RestoreKeepsInternalStructure {
  all s, t: State, i: Item, c: Consent | restore[s, t, i, c] implies
    (i.members - i.root) <: t.parentOf = (i.members - i.root) <: s.parentOf
}
assert PurgedNeverRevived {
  all s, t: State | (safe[s] and step[s, t]) implies {
    s.purged in t.purged
    no t.purged & live[t]
  }
}

// ---- Negative controls ----

// Selects the whole original subtree, swallowing earlier trash items.
pred badDeleteWholeSubtree[s, t: State, i: Item, b: Block] {
  b in live[s]
  i not in s.items
  i.root = b
  i.members = under[s, b] - s.purged
  t.deleted = s.deleted + i.members
  t.items = s.items + i
  t.purged = s.purged
  t.parentOf = s.parentOf
}
// Purges by walking the original tree instead of the selected item.
pred badPurgeFollowingTree[s, t: State, i: Item] {
  i in s.items
  let doomed = under[s, i.root] - s.purged {
    t.purged = s.purged + doomed
    t.deleted = s.deleted - doomed
    t.items = { j: s.items - i | no j.members & doomed }
  }
  t.parentOf = s.parentOf
}
// Follows references and deletes external reference items too.
pred badDeleteFollowingReferences[s, t: State, i: Item, b: Block] {
  b in live[s]
  i not in s.items
  i.root = b
  i.members = (under[s, b] + target.(under[s, b])) & live[s]
  t.deleted = s.deleted + i.members
  t.items = s.items + i
  t.purged = s.purged
  t.parentOf = s.parentOf
}
// Restores under the original parent even when that parent is in trash.
pred badRestoreUnderTrash[s, t: State, i: Item] {
  i in s.items
  t.parentOf = s.parentOf
  t.deleted = s.deleted - i.members
  t.items = s.items - i
  t.purged = s.purged
}

assert WholeSubtreeDeleteKeepsEarlierItems {
  all s, t, u: State, i: Item, b: Block, c: Consent |
    (safe[s] and badDeleteWholeSubtree[s, t, i, b] and restore[t, u, i, c]) implies
      all j: t.items - i | j.members in u.deleted
}
assert TreeWalkingPurgeKeepsEarlierItems {
  all s, t: State, i: Item | (safe[s] and badPurgeFollowingTree[s, t, i]) implies
    all j: s.items - i | no j.members & t.purged
}
assert ReferenceFollowingDeleteDoesNotCascade {
  all s, t: State, i: Item, b: Block | (safe[s] and badDeleteFollowingReferences[s, t, i, b]) implies
    all r: Reference & live[s] - under[s, b] | r in live[t]
}
assert RestoreUnderTrashIsSafe {
  all s, t: State, i: Item | (safe[s] and badRestoreUnderTrash[s, t, i]) implies safe[t]
}

// ---- Witnesses (contract examples) ----

// A > B > {C, D}; R is an external reference to B under A.
pred example[s: State, a, b, c, d: Plain, r: Reference] {
  initial[s]
  no s.parentOf[a]
  s.parentOf[b] = a
  s.parentOf[c] = b
  s.parentOf[d] = b
  s.parentOf[r] = a
  r.target = b
}

// Delete C, delete B: restoring B leaves C in trash; C then restores under B.
run RestoreParentKeepsEarlierChildItem {
  some disj s0, s1, s2, s3, s4: State, disj a, b, c, d: Plain, r: Reference,
       disj ic, ib: Item |
    example[s0, a, b, c, d, r] and
    delete[s0, s1, ic, c] and delete[s1, s2, ib, b] and
    ib.members = b + d and
    restore[s2, s3, ib, Declined] and c in s3.deleted and
    restore[s3, s4, ic, Declined] and s4.parentOf[c] = b
} for 5 but 5 Block, 3 Item, exactly 5 State expect 1
// Delete C, delete B, purge B: C survives and restores as an independent document.
run PurgeParentThenRestoreChildIndependently {
  some disj s0, s1, s2, s3, s4: State, disj a, b, c, d: Plain, r: Reference,
       disj ic, ib: Item |
    example[s0, a, b, c, d, r] and
    delete[s0, s1, ic, c] and delete[s1, s2, ib, b] and purge[s2, s3, ib] and
    c in s3.deleted and c not in s3.purged and
    restore[s3, s4, ic, Accepted] and no s4.parentOf[c] and c in live[s4]
} for 5 but 5 Block, 3 Item, exactly 5 State expect 1
// Deleting the representative B keeps the external reference R live.
run RepresentativeDeleteKeepsExternalReference {
  some disj s0, s1: State, disj a, b, c, d: Plain, r: Reference, ib: Item |
    example[s0, a, b, c, d, r] and delete[s0, s1, ib, b] and r in live[s1]
} for 5 but 5 Block, 3 Item, exactly 2 State expect 1
// C's original parent is in trash: only a confirmed independent restore applies
// (IndependentRestoreNeedsConfirmation checks that Declined is refused).
run OrphanedItemNeedsIndependentRestore {
  some disj s0, s1, s2: State, disj a, b, c, d: Plain, r: Reference, disj ic, ib: Item |
    example[s0, a, b, c, d, r] and delete[s0, s1, ic, c] and delete[s1, s2, ib, b] and
    not parentAvailable[s2, ic]
} for 5 but 5 Block, 3 Item, exactly 3 State expect 1

check InitialIsSafe for 5 but 5 Block, 3 Item, exactly 1 State expect 0
check EveryStepPreservesSafety for 5 but 5 Block, 3 Item, exactly 2 State expect 0
check EarlierItemSurvivesParentRestore for 5 but 5 Block, 3 Item, exactly 2 State expect 0
check EarlierItemSurvivesParentPurge for 5 but 5 Block, 3 Item, exactly 2 State expect 0
check PurgeMatchesConfirmedSet for 5 but 5 Block, 3 Item, exactly 2 State expect 0
check NoReferenceCascade for 5 but 5 Block, 3 Item, exactly 2 State expect 0
check RestoreNeverUsesUnavailableParent for 5 but 5 Block, 3 Item, exactly 2 State expect 0
check IndependentRestoreNeedsConfirmation for 5 but 5 Block, 3 Item, exactly 2 State expect 0
check RestoreKeepsInternalStructure for 5 but 5 Block, 3 Item, exactly 2 State expect 0
check PurgedNeverRevived for 5 but 5 Block, 3 Item, exactly 2 State expect 0
check WholeSubtreeDeleteKeepsEarlierItems for 5 but 5 Block, 3 Item, exactly 3 State expect 1
check TreeWalkingPurgeKeepsEarlierItems for 5 but 5 Block, 3 Item, exactly 2 State expect 1
check ReferenceFollowingDeleteDoesNotCascade for 5 but 5 Block, 3 Item, exactly 2 State expect 1
check RestoreUnderTrashIsSafe for 5 but 5 Block, 3 Item, exactly 2 State expect 1
