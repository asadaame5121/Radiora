module shared_undo_protocol

// A01 (v3-verification-plan.md §6): workspace-shared Undo/Redo history,
// purge barrier, durable save/success response and publication protocol.
// Supersedes purge_protocol.als (per-session histories) for the v3 contract;
// that model and its recorded results stay unchanged.
//
// Abstractions (not product decisions):
// - Body sets mean "this block's content could be exposed", not strings.
// - History entries over-approximate content that Undo OR Redo may restore.
// - Snapshot pairs are checked inductively: safe[s] and step[s, t] => safe[t].
// - crash is crash + restart of the backend process; durable state survives,
//   memory, drafts and the shared history do not.
abstract sig Block { parent: lone Block }
sig Owner extends Block {}
sig Reference extends Block { target: one Owner }
sig Pane {}
sig Epoch {}
sig Cmd { writes: lone Owner }
sig Entry {
  restores: set Owner,
  cmd: one Cmd,
  origin: one Pane,
  epoch: one Epoch
}
sig Request { pane: one Pane, dir: one Direction, epoch: one Epoch }
abstract sig Phase {}
one sig Idle, Draining, Prepared, Dirty, Durable, Reset extends Phase {}
abstract sig Direction {}
one sig Undo, Redo extends Direction {}

fact Topology {
  no iden & ^parent
}
// One history entry records one accepted command.
fact EntryPerCommand {
  all disj e1, e2: Entry | e1.cmd != e2.cmd
}

sig Snapshot {
  phase: one Phase,
  trash: set Block,
  chosen: set Block,
  purgeCmd: lone Cmd,
  pending: set Owner,
  memoryBody: set Owner,
  diskBody: set Owner,
  memoryPurged: set Block,
  diskPurged: set Block,
  applied: set Cmd,
  durable: set Cmd,
  acked: set Cmd,
  undo: seq Entry,
  redo: seq Entry,
  epoch: one Epoch,
  usedEpochs: set Epoch,
  queued: set Request,
  published: set Owner,
  completed: set Block,
  links: Block -> Block,
  relations: Block -> Block
}

fun subtree[b: Block]: set Block { b.*(~parent) }
fun history[s: Snapshot]: set Entry { s.undo.elems + s.redo.elems }
fun returnedBody[s: Snapshot]: set Owner {
  // Ordinary reads are rejected during the barrier.
  { b: s.published | s.phase = Idle }
}
fun executed[s: Snapshot, r: Request]: lone Entry {
  r.dir = Undo implies s.undo.last else s.redo.last
}
// Bounded push: infeasible when the stack is full, instead of silently
// dropping the entry as util/sequniv add does at the seq bound.
pred push[q, r: seq Entry, e: Entry] {
  r.butlast = q
  r.last = e
}

pred sameDoc[s, t: Snapshot] {
  t.trash = s.trash
  t.links = s.links
  t.relations = s.relations
}
pred sameStorage[s, t: Snapshot] {
  t.memoryBody = s.memoryBody
  t.diskBody = s.diskBody
  t.memoryPurged = s.memoryPurged
  t.diskPurged = s.diskPurged
}
pred sameCmds[s, t: Snapshot] {
  t.applied = s.applied
  t.durable = s.durable
  t.acked = s.acked
}
pred sameHistory[s, t: Snapshot] {
  t.undo = s.undo
  t.redo = s.redo
  t.epoch = s.epoch
  t.usedEpochs = s.usedEpochs
}
pred samePurge[s, t: Snapshot] {
  t.phase = s.phase
  t.chosen = s.chosen
  t.purgeCmd = s.purgeCmd
}
pred sameView[s, t: Snapshot] {
  t.published = s.published
  t.completed = s.completed
}
pred freshEpoch[s, t: Snapshot] {
  t.epoch not in s.usedEpochs
  t.usedEpochs = s.usedEpochs + t.epoch
}

pred initial[s: Snapshot] {
  s.phase = Idle
  no s.chosen
  no s.purgeCmd
  s.memoryBody = Owner
  s.diskBody = Owner
  s.published = Owner
  no s.memoryPurged + s.diskPurged + s.completed
  no s.pending & s.trash
  s.durable = s.applied
  s.acked in s.durable
  history[s].cmd in s.applied
  all e: history[s] | e.epoch = s.epoch
  not s.undo.hasDups
  not s.redo.hasDups
  no s.undo.elems & s.redo.elems
  s.usedEpochs = s.epoch
  s.queued.epoch = s.epoch
  // trash, drafts, earlier entries and queued requests are otherwise arbitrary.
}

// An inductive safety candidate, NOT a fact imposed on every state.
pred safe[s: Snapshot] {
  // Purge sets and bodies.
  s.chosen in s.trash
  s.memoryPurged + s.diskPurged in s.trash
  s.diskPurged in s.memoryPurged
  no s.memoryBody & s.memoryPurged
  no s.diskBody & s.diskPurged
  s.diskBody - s.chosen in s.memoryBody
  s.phase != Dirty implies s.diskBody in s.memoryBody
  s.completed in s.diskPurged
  no s.pending & s.trash
  // Durability and success responses: published/acked never ahead of disk.
  s.durable in s.applied
  s.acked in s.durable
  s.applied.writes in s.memoryBody + s.memoryPurged
  s.durable.writes in s.diskBody + s.diskPurged
  s.published in s.diskBody + s.chosen
  no s.published & (s.diskPurged - s.chosen)
  // One shared LIFO history of the current epoch.
  not s.undo.hasDups
  not s.redo.hasDups
  no s.undo.elems & s.redo.elems
  history[s].cmd in s.applied
  all e: history[s] | e.epoch = s.epoch
  s.epoch in s.usedEpochs
  s.queued.epoch in s.usedEpochs
  // Earlier purge boundaries hold while a new purge is in progress.
  no history[s].restores & (s.diskPurged - s.chosen)
  s.phase in Idle + Draining + Prepared implies s.published in s.diskBody
  s.phase = Idle implies {
    no s.chosen
    no s.purgeCmd
    s.memoryPurged = s.diskPurged
    no history[s].restores & s.memoryPurged
  }
  s.phase != Idle implies {
    some s.chosen
    one s.purgeCmd
    no s.purgeCmd.writes
    s.purgeCmd not in s.acked
  }
  s.phase in Draining + Prepared implies {
    s.memoryPurged = s.diskPurged
    no s.chosen & s.memoryPurged
    s.purgeCmd not in s.applied
  }
  s.phase = Prepared implies {
    no s.pending
    s.memoryBody = s.diskBody
    s.durable = s.applied
  }
  s.phase = Dirty implies {
    no s.pending
    s.memoryPurged = s.diskPurged + s.chosen
    no s.chosen & s.diskPurged
    s.purgeCmd in s.applied - s.durable
  }
  s.phase in Durable + Reset implies {
    no s.pending
    s.memoryPurged = s.diskPurged
    s.chosen in s.diskPurged
    s.purgeCmd in s.durable
  }
  s.phase = Reset implies {
    s.undo.isEmpty
    s.redo.isEmpty
  }
}

// ---- Ordinary editing, save, publication and responses ----

pred draft[s, t: Snapshot, b: Owner] {
  s.phase = Idle
  b not in s.trash
  t.pending = s.pending + b
  t.queued = s.queued
  samePurge[s, t]
  sameStorage[s, t]
  sameCmds[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

// Applying a command changes memory only; the durable version moves on persist.
pred edit[s, t: Snapshot, p: Pane, e: Entry, c: Cmd, b: Owner] {
  s.phase = Idle
  b not in s.trash
  c not in s.applied
  c.writes = b
  e.cmd = c
  e.origin = p
  e.epoch = s.epoch
  e.restores in s.memoryBody + b
  t.pending = s.pending - b
  t.memoryBody = s.memoryBody + b
  t.diskBody = s.diskBody
  t.memoryPurged = s.memoryPurged
  t.diskPurged = s.diskPurged
  t.applied = s.applied + c
  t.durable = s.durable
  t.acked = s.acked
  push[s.undo, t.undo, e]
  t.redo.isEmpty
  t.epoch = s.epoch
  t.usedEpochs = s.usedEpochs
  t.queued = s.queued
  samePurge[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

pred persist[s, t: Snapshot] {
  s.phase = Idle
  t.memoryBody = s.memoryBody
  t.memoryPurged = s.memoryPurged
  t.diskBody = s.memoryBody
  t.diskPurged = s.memoryPurged
  t.applied = s.applied
  t.durable = s.applied
  t.acked = s.acked
  t.pending = s.pending
  t.queued = s.queued
  samePurge[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

pred publish[s, t: Snapshot] {
  s.phase = Idle
  t.published = s.diskBody
  t.completed = s.completed
  t.pending = s.pending
  t.queued = s.queued
  samePurge[s, t]
  sameStorage[s, t]
  sameCmds[s, t]
  sameHistory[s, t]
  sameDoc[s, t]
}

pred ack[s, t: Snapshot, c: Cmd] {
  c in s.durable - s.acked - s.purgeCmd
  t.acked = s.acked + c
  t.applied = s.applied
  t.durable = s.durable
  t.pending = s.pending
  t.queued = s.queued
  samePurge[s, t]
  sameStorage[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

// Response lost after apply/commit: the client resends the same command ID.
// The backend answers from its ledger and never applies the command again.
pred resend[s, t: Snapshot, c: Cmd] {
  c in s.applied
  t.acked = s.acked + (c & s.durable - s.purgeCmd)
  t.applied = s.applied
  t.durable = s.durable
  t.pending = s.pending
  t.queued = s.queued
  samePurge[s, t]
  sameStorage[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

// ---- Shared Undo/Redo requests ----

// Any pane may capture a request at any time; it carries the history epoch.
pred capture[s, t: Snapshot, r: Request] {
  r.epoch = s.epoch
  r not in s.queued
  t.queued = s.queued + r
  t.pending = s.pending
  samePurge[s, t]
  sameStorage[s, t]
  sameCmds[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

// Executes the top of the ONE shared stack, whichever pane recorded it.
pred replay[s, t: Snapshot, r: Request] {
  s.phase = Idle
  r in s.queued
  r.epoch = s.epoch
  // Undo/Redo is refused until unsaved input has been flushed.
  no s.pending
  replayEffect[s, t, r]
}

pred replayEffect[s, t: Snapshot, r: Request] {
  r.dir = Undo implies {
    not s.undo.isEmpty
    t.undo = s.undo.butlast
    push[s.redo, t.redo, s.undo.last]
  }
  r.dir = Redo implies {
    not s.redo.isEmpty
    t.redo = s.redo.butlast
    push[s.undo, t.undo, s.redo.last]
  }
  t.memoryBody = s.memoryBody + executed[s, r].restores
  t.diskBody = s.diskBody
  t.memoryPurged = s.memoryPurged
  t.diskPurged = s.diskPurged
  t.epoch = s.epoch
  t.usedEpochs = s.usedEpochs
  t.queued = s.queued - r
  t.pending = s.pending
  samePurge[s, t]
  sameCmds[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

pred rejectStale[s, t: Snapshot, r: Request] {
  r in s.queued
  r.epoch != s.epoch
  t.queued = s.queued - r
  t.pending = s.pending
  samePurge[s, t]
  sameStorage[s, t]
  sameCmds[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

// ---- Purge barrier ----

pred begin[s, t: Snapshot, b: Block, c: Cmd] {
  s.phase = Idle
  b in s.trash - s.memoryPurged
  subtree[b] in s.trash - s.memoryPurged
  c not in s.applied
  no c.writes
  t.phase = Draining
  t.chosen = subtree[b]
  t.purgeCmd = c
  t.pending = s.pending
  t.queued = s.queued
  sameStorage[s, t]
  sameCmds[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

// The preparing owner saves drafts and dirty edits with a privileged permit.
pred flushSuccess[s, t: Snapshot] {
  s.phase = Draining
  t.phase = Prepared
  t.chosen = s.chosen
  t.purgeCmd = s.purgeCmd
  no t.pending
  t.memoryBody = s.memoryBody + s.pending
  t.diskBody = s.memoryBody + s.pending
  t.memoryPurged = s.memoryPurged
  t.diskPurged = s.diskPurged
  t.applied = s.applied
  t.durable = s.applied
  t.acked = s.acked
  t.queued = s.queued
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

pred flushFailure[s, t: Snapshot] {
  s.phase = Draining
  t.phase = Idle
  no t.chosen
  no t.purgeCmd
  t.pending = s.pending
  t.queued = s.queued
  sameStorage[s, t]
  sameCmds[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

pred applyPurge[s, t: Snapshot] {
  s.phase = Prepared
  t.phase = Dirty
  t.chosen = s.chosen
  t.purgeCmd = s.purgeCmd
  t.pending = s.pending
  t.memoryBody = s.memoryBody - s.chosen
  t.memoryPurged = s.memoryPurged + s.chosen
  t.diskBody = s.diskBody
  t.diskPurged = s.diskPurged
  t.applied = s.applied + s.purgeCmd
  t.durable = s.durable
  t.acked = s.acked
  t.queued = s.queued
  // Purge-origin changes are not captured; earlier entries remain until reset.
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

pred persistSuccess[s, t: Snapshot] {
  s.phase = Dirty
  t.phase = Durable
  t.chosen = s.chosen
  t.purgeCmd = s.purgeCmd
  t.pending = s.pending
  t.memoryBody = s.memoryBody
  t.memoryPurged = s.memoryPurged
  t.diskBody = s.memoryBody
  t.diskPurged = s.memoryPurged
  t.applied = s.applied
  t.durable = s.applied
  t.acked = s.acked
  t.queued = s.queued
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

// Retry keeps the same applied difference; nothing is applied twice.
pred persistFailure[s, t: Snapshot] {
  s.phase = Dirty
  t.pending = s.pending
  t.queued = s.queued
  samePurge[s, t]
  sameStorage[s, t]
  sameCmds[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

pred resetAll[s, t: Snapshot] {
  s.phase = Durable
  t.phase = Reset
  t.chosen = s.chosen
  t.purgeCmd = s.purgeCmd
  t.pending = s.pending
  t.undo.isEmpty
  t.redo.isEmpty
  freshEpoch[s, t]
  t.queued = s.queued
  sameStorage[s, t]
  sameCmds[s, t]
  sameView[s, t]
  sameDoc[s, t]
}

pred finish[s, t: Snapshot] {
  s.phase = Reset
  s.undo.isEmpty
  s.redo.isEmpty
  t.phase = Idle
  no t.chosen
  no t.purgeCmd
  t.pending = s.pending
  t.applied = s.applied
  t.durable = s.durable
  t.acked = s.acked + s.purgeCmd
  t.queued = s.queued
  t.published = s.diskBody
  t.completed = s.completed + s.chosen
  sameStorage[s, t]
  sameHistory[s, t]
  sameDoc[s, t]
}

// ---- Process crash and restart (any phase) ----

pred crash[s, t: Snapshot] {
  t.phase = Idle
  no t.chosen
  no t.purgeCmd
  no t.pending
  t.memoryBody = s.diskBody
  t.memoryPurged = s.diskPurged
  t.diskBody = s.diskBody
  t.diskPurged = s.diskPurged
  t.applied = s.durable
  t.durable = s.durable
  t.acked = s.acked
  t.undo.isEmpty
  t.redo.isEmpty
  freshEpoch[s, t]
  // A reconnecting UI may still hold old requests; they are now stale.
  t.queued = s.queued
  t.published = s.diskBody
  t.completed = s.completed
  sameDoc[s, t]
}

pred step[s, t: Snapshot] {
  (some b: Owner | draft[s, t, b])
  or (some p: Pane, e: Entry, c: Cmd, b: Owner | edit[s, t, p, e, c, b])
  or persist[s, t] or publish[s, t]
  or (some c: Cmd | ack[s, t, c] or resend[s, t, c])
  or (some r: Request | capture[s, t, r] or replay[s, t, r] or rejectStale[s, t, r])
  or (some b: Block, c: Cmd | begin[s, t, b, c])
  or flushSuccess[s, t] or flushFailure[s, t]
  or applyPurge[s, t] or persistSuccess[s, t] or persistFailure[s, t]
  or resetAll[s, t] or finish[s, t]
  or crash[s, t]
}

// ---- Positive checks ----

assert InitialIsSafe {
  all s: Snapshot | initial[s] implies safe[s]
}
assert EveryStepPreservesSafety {
  all s, t: Snapshot | safe[s] and step[s, t] implies safe[t]
}
assert SuccessOnlyAfterDurabilityAndReset {
  all s, t: Snapshot | safe[s] and finish[s, t] implies {
    s.chosen in t.diskPurged
    s.purgeCmd in t.durable
    t.undo.isEmpty
    t.redo.isEmpty
    no t.published & s.chosen
  }
}
assert BarrierRejectsOrdinaryOperations {
  all s, t: Snapshot | s.phase != Idle implies {
    no returnedBody[s]
    no b: Owner | draft[s, t, b]
    no p: Pane, e: Entry, c: Cmd, b: Owner | edit[s, t, p, e, c, b]
    no r: Request | replay[s, t, r]
    not persist[s, t]
    not publish[s, t]
  }
}
assert DirtyCannotResumeOrClearHistory {
  all s, t: Snapshot |
    (safe[s] and s.phase = Dirty and step[s, t] and not crash[s, t]) implies {
      t.phase in Dirty + Durable
      t.undo = s.undo
      t.redo = s.redo
      t.purgeCmd not in t.acked
    }
}
assert FailuresKeepDraftsAndHistory {
  all s, t: Snapshot |
    (flushFailure[s, t] or persistFailure[s, t]) implies {
      t.pending = s.pending
      t.undo = s.undo
      t.redo = s.redo
      t.acked = s.acked
      t.completed = s.completed
      t.diskPurged = s.diskPurged
    }
}
assert StaleRequestsNeverExecute {
  all s, t: Snapshot, r: Request |
    (safe[s] and replay[s, t, r]) implies executed[s, r].epoch = r.epoch
}
assert ResetInvalidatesEveryCapturedRequest {
  all s, t: Snapshot, r: Request |
    (safe[s] and (resetAll[s, t] or crash[s, t]) and r in s.queued) implies r.epoch != t.epoch
}
assert RestartStartsWithEmptyHistory {
  all s, t: Snapshot | crash[s, t] implies {
    t.undo.isEmpty
    t.redo.isEmpty
    t.memoryBody = s.diskBody
    t.applied = s.durable
  }
}
assert CrashAfterDurablePurgeIsSafe {
  all s, t: Snapshot | (safe[s] and s.phase in Durable + Reset and crash[s, t]) implies {
    s.chosen in t.memoryPurged
    no t.memoryBody & t.memoryPurged
    no history[t]
  }
}
assert AckedWorkSurvivesCrash {
  all s, t: Snapshot | (safe[s] and crash[s, t]) implies {
    s.acked in t.applied
    s.acked.writes in t.memoryBody + t.memoryPurged
  }
}
assert ResendNeverDoubleApplies {
  all s, t: Snapshot, c: Cmd | resend[s, t, c] implies {
    t.applied = s.applied
    t.memoryBody = s.memoryBody
    t.undo = s.undo
    t.redo = s.redo
  }
}
assert NewEditInvalidatesRedo {
  all s, t: Snapshot, p: Pane, e: Entry, c: Cmd, b: Owner |
    edit[s, t, p, e, c, b] implies t.redo.isEmpty and t.undo.last = e
}
assert RegistryNeverForgetsPurgedIDs {
  all s, t: Snapshot | safe[s] and step[s, t] implies s.diskPurged in t.diskPurged
}
assert NoReferenceCascadeOrAutomaticRewire {
  all s, t: Snapshot | applyPurge[s, t] implies {
    t.memoryPurged = s.memoryPurged + s.chosen
    t.memoryBody = s.memoryBody - s.chosen
    t.links = s.links
    t.relations = s.relations
  }
}

// ---- Negative controls: each omits one part of the adopted protocol ----

// Early success: reports the purge before the purge is durable.
pred badFinishBeforeDisk[s, t: Snapshot] {
  s.phase = Dirty
  t.phase = Idle
  no t.chosen
  no t.purgeCmd
  t.pending = s.pending
  t.applied = s.applied
  t.durable = s.durable
  t.acked = s.acked + s.purgeCmd
  t.queued = s.queued
  t.published = s.diskBody - s.chosen
  t.completed = s.completed + s.chosen
  sameStorage[s, t]
  t.undo.isEmpty
  t.redo.isEmpty
  freshEpoch[s, t]
  sameDoc[s, t]
}
// Origin exclusion only: resumes after durability without clearing history.
pred badResumeKeepingHistory[s, t: Snapshot] {
  s.phase = Durable
  t.phase = Idle
  no t.chosen
  no t.purgeCmd
  t.pending = s.pending
  t.applied = s.applied
  t.durable = s.durable
  t.acked = s.acked + s.purgeCmd
  t.queued = s.queued
  t.published = s.diskBody
  t.completed = s.completed + s.chosen
  sameStorage[s, t]
  sameHistory[s, t]
  sameDoc[s, t]
}
// Dirty flag cleared on a failed save: marks applied work durable without disk.
pred badMarkClean[s, t: Snapshot] {
  s.phase = Idle
  t.durable = s.applied
  t.applied = s.applied
  t.acked = s.acked
  t.pending = s.pending
  t.queued = s.queued
  samePurge[s, t]
  sameStorage[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}
// Dirty purge resumes ordinary work after a failed save.
pred badDirtyResume[s, t: Snapshot] {
  s.phase = Dirty
  t.phase = Idle
  no t.chosen
  no t.purgeCmd
  t.pending = s.pending
  t.queued = s.queued
  sameStorage[s, t]
  sameCmds[s, t]
  sameHistory[s, t]
  sameView[s, t]
  sameDoc[s, t]
}
// Early publication: reads are served from memory instead of the durable version.
pred badPublishMemory[s, t: Snapshot] {
  s.phase = Idle
  t.published = s.memoryBody
  t.completed = s.completed
  t.pending = s.pending
  t.queued = s.queued
  samePurge[s, t]
  sameStorage[s, t]
  sameCmds[s, t]
  sameHistory[s, t]
  sameDoc[s, t]
}
// Stale request: executes without revalidating the history epoch.
pred badReplayIgnoringEpoch[s, t: Snapshot, r: Request] {
  s.phase = Idle
  r in s.queued
  no s.pending
  replayEffect[s, t, r]
}

assert EarlySuccessIsSafe {
  all s, t: Snapshot | safe[s] and badFinishBeforeDisk[s, t] implies safe[t]
}
assert ExcludingPurgeOriginAloneIsEnough {
  all s, t, u: Snapshot, r: Request |
    (safe[s] and badResumeKeepingHistory[s, t] and replay[t, u, r]) implies
      no u.memoryBody & u.memoryPurged
}
assert ClearingDirtyFlagIsSafe {
  all s, t: Snapshot | safe[s] and badMarkClean[s, t] implies safe[t]
}
assert ResumingDirtyPurgeIsSafe {
  all s, t: Snapshot | safe[s] and badDirtyResume[s, t] implies safe[t]
}
assert PublishingMemoryIsSafe {
  all s, t: Snapshot | safe[s] and badPublishMemory[s, t] implies safe[t]
}
assert SkippingEpochCheckIsSafe {
  all s, t: Snapshot, r: Request |
    (safe[s] and badReplayIgnoringEpoch[s, t, r]) implies executed[s, r].epoch = r.epoch
}

// ---- Witnesses: the protocol is executable in the intended scenarios ----

// W1: drafts and both stacks present; save fails once, retry succeeds.
run PurgeWithRetry {
  some disj a, b, c, d, e, f, g, h: Snapshot, x: Block, k: Cmd |
    initial[a] and some a.pending and not a.undo.isEmpty and not a.redo.isEmpty and
    begin[a, b, x, k] and flushSuccess[b, c] and applyPurge[c, d] and
    persistFailure[d, e] and persistSuccess[e, f] and resetAll[f, g] and finish[g, h]
} for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq,
  exactly 8 Snapshot expect 1
run FlushFailureReturnsToIdle {
  some disj a, b: Snapshot | safe[a] and some a.pending and flushFailure[a, b]
} for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq,
  exactly 2 Snapshot expect 1
// W2: commit succeeds, response is lost, resend is answered from the ledger.
run ResponseLostThenResend {
  some disj a, b, c, d: Snapshot, p: Pane, e: Entry, k: Cmd, o: Owner |
    safe[a] and a.phase = Idle and edit[a, b, p, e, k, o] and persist[b, c] and
    resend[c, d, k] and k not in c.acked and k in d.acked
} for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq,
  exactly 4 Snapshot expect 1
// W3 (E07): durable purge, crash before clear, restart, new edit is undoable.
run CrashAfterDurableThenNewUndo {
  some disj a, b, c, d, e, f: Snapshot, p: Pane, en: Entry, k: Cmd, o: Owner, r: Request |
    safe[a] and a.phase = Dirty and not a.undo.isEmpty and
    persistSuccess[a, b] and crash[b, c] and edit[c, d, p, en, k, o] and
    capture[d, e, r] and r.dir = Undo and replay[e, f, r]
} for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq,
  exactly 6 Snapshot expect 1
// W4: one shared history: pane q undoes the entry recorded by pane p.
run OtherPaneUndoesSharedEntry {
  some disj a, b, c, d: Snapshot, disj p, q: Pane, e: Entry, k: Cmd, o: Owner, r: Request |
    safe[a] and a.phase = Idle and edit[a, b, p, e, k, o] and
    capture[b, c, r] and r.pane = q and r.dir = Undo and replay[c, d, r] and
    executed[c, r] = e
} for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq,
  exactly 4 Snapshot expect 1
// W5: a request captured before reset is rejected afterwards.
run StaleRequestRejectedAfterReset {
  some disj a, b, c, d: Snapshot, r: Request |
    safe[a] and a.phase = Durable and r in a.queued and r.epoch = a.epoch and
    resetAll[a, b] and finish[b, c] and rejectStale[c, d, r]
} for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq,
  exactly 4 Snapshot expect 1

check InitialIsSafe for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 1 Snapshot expect 0
check EveryStepPreservesSafety for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check SuccessOnlyAfterDurabilityAndReset for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check BarrierRejectsOrdinaryOperations for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check DirtyCannotResumeOrClearHistory for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check FailuresKeepDraftsAndHistory for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check StaleRequestsNeverExecute for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check ResetInvalidatesEveryCapturedRequest for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check RestartStartsWithEmptyHistory for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check CrashAfterDurablePurgeIsSafe for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check AckedWorkSurvivesCrash for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check ResendNeverDoubleApplies for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check NewEditInvalidatesRedo for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check RegistryNeverForgetsPurgedIDs for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check NoReferenceCascadeOrAutomaticRewire for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 0
check EarlySuccessIsSafe for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 1
check ExcludingPurgeOriginAloneIsEnough for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 3 Snapshot expect 1
check ClearingDirtyFlagIsSafe for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 1
check ResumingDirtyPurgeIsSafe for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 1
check PublishingMemoryIsSafe for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 1
check SkippingEpochCheckIsSafe for 4 but 3 Block, 3 Entry, 3 Cmd, 2 Pane, 3 Epoch, 2 Request, 3 seq, exactly 2 Snapshot expect 1
