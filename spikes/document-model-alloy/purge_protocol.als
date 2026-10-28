module purge_protocol

// Implementation reference for the adopted purge/Undo barrier.
// Body sets mean "this block's content could be exposed", not actual strings.
// History entries over-approximate content that Undo OR Redo may restore.
abstract sig Block { parent: lone Block }
sig Owner extends Block {}
sig Reference extends Block { target: one Owner }
sig Session {}
sig Entry { restores: set Owner }
abstract sig Phase {}
one sig Idle, Draining, Prepared, Dirty, Durable, Reset extends Phase {}
abstract sig Direction {}
one sig Undo, Redo extends Direction {}
abstract sig Consent {}
one sig Accepted, Declined extends Consent {}

fact Topology {
  no iden & ^parent
}

sig Snapshot {
  phase: one Phase,
  trash: set Block,
  chosen: set Block,
  pending: set Owner,
  memoryBody: set Owner,
  diskBody: set Owner,
  memoryPurged: set Block,
  diskPurged: set Block,
  undo: Session -> Entry,
  redo: Session -> Entry,
  published: set Owner,
  completed: set Block,
  links: Block -> Block,
  relations: Block -> Block
}

fun subtree[b: Block]: set Block { b.*(~parent) }
fun history[s: Snapshot]: set Entry { Session.(s.undo + s.redo) }
fun returnedBody[s: Snapshot]: set Owner {
  // Ordinary reads are rejected during the barrier; old published cache
  // may remain internally but is not returned as a new successful read.
  { b: s.published | s.phase = Idle }
}

pred sameHistory[s, t: Snapshot] {
  t.undo = s.undo
  t.redo = s.redo
}
pred sameStorage[s, t: Snapshot] {
  t.memoryBody = s.memoryBody
  t.diskBody = s.diskBody
  t.memoryPurged = s.memoryPurged
  t.diskPurged = s.diskPurged
}
pred sameMetadata[s, t: Snapshot] {
  t.trash = s.trash
  t.links = s.links
  t.relations = s.relations
  t.published = s.published
  t.completed = s.completed
}

pred initial[s: Snapshot] {
  s.phase = Idle
  no s.chosen
  s.memoryBody = Owner
  s.diskBody = Owner
  s.published = Owner
  no s.memoryPurged + s.diskPurged + s.completed
  // pending drafts, trash and earlier undo/redo payloads are arbitrary.
}

// An inductive safety candidate, NOT a fact imposed on every state.
pred safe[s: Snapshot] {
  s.memoryPurged + s.diskPurged in s.trash
  no s.memoryBody & s.memoryPurged
  no s.diskBody & s.diskPurged
  s.completed in s.diskPurged
  // Old purge boundaries remain respected while a NEW purge is in progress.
  // Before reset, history may mention only the currently selected purge set,
  // never blocks purged by a previous completed operation.
  no history[s].restores & (s.diskPurged - s.chosen)
  no s.published & (s.diskPurged - s.chosen)
  s.phase = Idle implies {
    no s.chosen
    s.memoryPurged = s.diskPurged
    no history[s].restores & s.memoryPurged
    no s.published & s.diskPurged
  }
  s.phase != Idle implies {
    some s.chosen
    s.chosen in s.trash
  }
  s.phase in Draining + Prepared implies {
    s.memoryPurged = s.diskPurged
    no s.chosen & s.memoryPurged
  }
  s.phase = Prepared implies no s.pending
  s.phase = Dirty implies {
    no s.pending
    s.memoryPurged = s.diskPurged + s.chosen
    no s.chosen & s.diskPurged
  }
  s.phase in Durable + Reset implies {
    no s.pending
    s.memoryPurged = s.diskPurged
    s.chosen in s.diskPurged
  }
  s.phase = Reset implies no s.undo + s.redo
}

pred begin[s, t: Snapshot, b: Block, consent: Consent] {
  s.phase = Idle
  consent = Accepted
  b in s.trash - s.memoryPurged
  subtree[b] in s.trash - s.memoryPurged
  t.phase = Draining
  t.chosen = subtree[b]
  t.pending = s.pending
  sameStorage[s, t]
  sameHistory[s, t]
  sameMetadata[s, t]
}

pred flushSuccess[s, t: Snapshot] {
  s.phase = Draining
  t.phase = Prepared
  t.chosen = s.chosen
  no t.pending
  sameStorage[s, t]
  sameHistory[s, t]
  sameMetadata[s, t]
}

pred flushFailure[s, t: Snapshot] {
  s.phase = Draining
  t.phase = Idle
  no t.chosen
  t.pending = s.pending
  sameStorage[s, t]
  sameHistory[s, t]
  sameMetadata[s, t]
}

pred applyPurge[s, t: Snapshot] {
  s.phase = Prepared
  t.phase = Dirty
  t.chosen = s.chosen
  t.pending = s.pending
  t.memoryBody = s.memoryBody - s.chosen
  t.memoryPurged = s.memoryPurged + s.chosen
  t.diskBody = s.diskBody
  t.diskPurged = s.diskPurged
  // Purge-origin operations are not captured by UndoManager.
  // Earlier entries intentionally remain until resetAll.
  sameHistory[s, t]
  sameMetadata[s, t]
}

pred persistSuccess[s, t: Snapshot] {
  s.phase = Dirty
  t.phase = Durable
  t.chosen = s.chosen
  t.pending = s.pending
  t.memoryBody = s.memoryBody
  t.memoryPurged = s.memoryPurged
  t.diskBody = s.memoryBody
  t.diskPurged = s.memoryPurged
  sameHistory[s, t]
  sameMetadata[s, t]
}

pred persistFailure[s, t: Snapshot] {
  s.phase = Dirty
  t.phase = Dirty
  t.chosen = s.chosen
  t.pending = s.pending
  sameStorage[s, t]
  sameHistory[s, t]
  sameMetadata[s, t]
}

pred resetAll[s, t: Snapshot] {
  s.phase = Durable
  t.phase = Reset
  t.chosen = s.chosen
  t.pending = s.pending
  no t.undo + t.redo
  sameStorage[s, t]
  sameMetadata[s, t]
}

pred finish[s, t: Snapshot] {
  s.phase = Reset
  no s.undo + s.redo
  t.phase = Idle
  no t.chosen
  t.pending = s.pending
  sameStorage[s, t]
  sameHistory[s, t]
  t.trash = s.trash
  t.links = s.links
  t.relations = s.relations
  t.published = s.diskBody
  t.completed = s.completed + s.chosen
}

// Abstract a later, independently durable edit. Payload cannot capture purged
// content. Normal-operation crash semantics belong to the storage PoC.
pred edit[s, t: Snapshot, p: Session, e: Entry, b: Owner] {
  s.phase = Idle
  b not in s.memoryPurged
  e not in history[s]
  e.restores = s.memoryBody
  t.phase = Idle
  t.chosen = s.chosen
  t.pending = s.pending
  t.memoryBody = s.memoryBody + b
  t.diskBody = t.memoryBody
  t.memoryPurged = s.memoryPurged
  t.diskPurged = s.diskPurged
  t.undo = s.undo + p->e
  t.redo = s.redo - p->Entry
  t.trash = s.trash
  t.links = s.links
  t.relations = s.relations
  t.published = t.diskBody
  t.completed = s.completed
}

pred replay[s, t: Snapshot, p: Session, e: Entry, d: Direction] {
  s.phase = Idle
  d = Undo implies {
    p->e in s.undo
    t.undo = s.undo - p->e
    t.redo = s.redo + p->e
  }
  d = Redo implies {
    p->e in s.redo
    t.redo = s.redo - p->e
    t.undo = s.undo + p->e
  }
  t.phase = Idle
  t.chosen = s.chosen
  t.pending = s.pending
  t.memoryBody = s.memoryBody + e.restores
  t.diskBody = t.memoryBody
  t.memoryPurged = s.memoryPurged
  t.diskPurged = s.diskPurged
  t.trash = s.trash
  t.links = s.links
  t.relations = s.relations
  t.published = t.diskBody
  t.completed = s.completed
}

pred step[s, t: Snapshot] {
  (some b: Block, consent: Consent | begin[s, t, b, consent])
  or flushSuccess[s, t] or flushFailure[s, t]
  or applyPurge[s, t] or persistSuccess[s, t] or persistFailure[s, t]
  or resetAll[s, t] or finish[s, t]
  or (some p: Session, e: Entry, b: Owner | edit[s, t, p, e, b])
  or (some p: Session, e: Entry, d: Direction | replay[s, t, p, e, d])
}

assert InitialIsSafe {
  all s: Snapshot | initial[s] implies safe[s]
}
assert EveryStepPreservesSafety {
  all s, t: Snapshot | safe[s] and step[s, t] implies safe[t]
}
assert CompleteOnlyAfterDurabilityAndReset {
  all s, t: Snapshot | safe[s] and finish[s, t] implies {
    s.chosen in t.diskPurged
    no t.undo + t.redo
    no t.published & s.chosen
    s.chosen in t.completed
  }
}
assert DirtyCannotResumeOrClearHistory {
  all s, t: Snapshot |
    safe[s] and s.phase = Dirty and step[s, t] implies {
      t.phase in Dirty + Durable
      t.undo = s.undo
      t.redo = s.redo
    }
}
assert FailuresKeepDraftsAndHistory {
  all s, t: Snapshot |
    flushFailure[s, t] or persistFailure[s, t] implies {
      t.pending = s.pending
      t.undo = s.undo
      t.redo = s.redo
      t.completed = s.completed
      t.diskPurged = s.diskPurged
    }
}
assert LockedRejectsOrdinaryOperationsAndReads {
  all s, t: Snapshot | s.phase != Idle implies {
    no returnedBody[s]
    no p: Session, e: Entry, b: Owner | edit[s, t, p, e, b]
    no p: Session, e: Entry, d: Direction | replay[s, t, p, e, d]
  }
}
assert NoPurgeWithoutConfirmationOrTrash {
  all s, t: Snapshot, b: Block, c: Consent |
    begin[s, t, b, c] implies c = Accepted and b in s.trash
}
assert NoReferenceCascadeOrAutomaticRewire {
  all s, t: Snapshot | applyPurge[s, t] implies {
    t.memoryPurged = s.memoryPurged + s.chosen
    t.memoryBody = s.memoryBody - s.chosen
    t.links = s.links
    t.relations = s.relations
  }
}
assert RegistryNeverForgetsPurgedIDs {
  all s, t: Snapshot | safe[s] and step[s, t] implies {
    s.memoryPurged in t.memoryPurged
    s.diskPurged in t.diskPurged
  }
}
assert NoStaleReplayAfterReset {
  all s, t, u: Snapshot | finish[s, t] implies
    no p: Session, e: Entry, d: Direction | replay[t, u, p, e, d]
}

// Negative controls model implementations that omit the adopted barrier.
pred badResume[s, t: Snapshot, keepUndo, keepRedo: set Session] {
  s.phase = Durable
  t.phase = Idle
  no t.chosen
  t.pending = s.pending
  sameStorage[s, t]
  t.undo = keepUndo <: s.undo
  t.redo = keepRedo <: s.redo
  t.trash = s.trash
  t.links = s.links
  t.relations = s.relations
  t.published = s.diskBody
  t.completed = s.completed + s.chosen
}
assert ExcludingPurgeOriginAloneIsEnough {
  all s, t, u: Snapshot, p: Session, e: Entry, d: Direction |
    (safe[s] and badResume[s, t, Session, Session] and replay[t, u, p, e, d]) implies
      no u.memoryBody & u.memoryPurged
}
assert ClearingOnlyOneSessionIsEnough {
  all s, t, u: Snapshot, cleared, remaining: Session, e: Entry, d: Direction |
    (cleared != remaining and safe[s] and
     badResume[s, t, Session - cleared, Session - cleared] and replay[t, u, remaining, e, d]) implies
      no u.memoryBody & u.memoryPurged
}
assert ReturningSuccessBeforeDiskIsSafe {
  all s: Snapshot | safe[s] and s.phase = Dirty implies
    s.chosen in s.diskPurged
}
assert ClearingOnlyUndoIsEnough {
  all s, t, u: Snapshot, p: Session, e: Entry |
    (safe[s] and badResume[s, t, none, Session] and replay[t, u, p, e, Redo]) implies
      no u.memoryBody & u.memoryPurged
}

run {
  some disj a, b, c, d, e, f, g: Snapshot, block: Block |
    initial[a] and some a.pending and some a.undo and some a.redo and
    begin[a, b, block, Accepted] and flushSuccess[b, c] and
    applyPurge[c, d] and persistSuccess[d, e] and resetAll[e, f] and finish[f, g]
} for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 7 Snapshot expect 1
run flushFailure for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 1
run {
  some disj a, b: Snapshot | safe[a] and persistFailure[a, b]
} for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 1
run {
  some disj a, b, c: Snapshot, p: Session, e: Entry, owner: Owner |
    safe[a] and a.phase = Idle and some a.diskPurged and
    edit[a, b, p, e, owner] and replay[b, c, p, e, Undo]
} for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 3 Snapshot expect 1
run {
  some disj a, b: Snapshot, r: Reference, child, owner: Owner |
    safe[a] and a.phase = Prepared and a.chosen = owner and
    r.target = owner and child.parent = r and
    child not in a.chosen and r not in a.chosen and applyPurge[a, b]
} for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 1
check InitialIsSafe for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 1 Snapshot expect 0
check EveryStepPreservesSafety for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 0
check CompleteOnlyAfterDurabilityAndReset for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 0
check DirtyCannotResumeOrClearHistory for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 0
check FailuresKeepDraftsAndHistory for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 0
check LockedRejectsOrdinaryOperationsAndReads for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 0
check NoPurgeWithoutConfirmationOrTrash for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 0
check NoReferenceCascadeOrAutomaticRewire for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 0
check RegistryNeverForgetsPurgedIDs for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 2 Snapshot expect 0
check NoStaleReplayAfterReset for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 3 Snapshot expect 0
check ExcludingPurgeOriginAloneIsEnough for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 3 Snapshot expect 1
check ClearingOnlyOneSessionIsEnough for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 3 Snapshot expect 1
check ReturningSuccessBeforeDiskIsSafe for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 1 Snapshot expect 1
run {
  some disj a, b, c, d: Snapshot, p: Session, e: Entry, owner: Owner |
    safe[a] and a.phase = Idle and some a.diskPurged and
    edit[a, b, p, e, owner] and replay[b, c, p, e, Undo] and replay[c, d, p, e, Redo]
} for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 4 Snapshot expect 1
check ClearingOnlyUndoIsEnough for 10 but 3 Block, 2 Entry, exactly 2 Session, exactly 3 Snapshot expect 1
