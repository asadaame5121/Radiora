module legacy_sharing

// LegacyContent distinguishes Work/Branch current bodies and pinned Revisions.
// Their extraction/representative-selection policy is deliberately not chosen.
sig LegacyWork {}
sig Text {}
sig LegacyContent { work: one LegacyWork, text: one Text }
sig Placement {
  content: one LegacyContent,
  oldParent: lone Placement
}
sig Block {}
one sig Import {
  converted: Placement -> one Block,
  representative: LegacyContent -> one Placement,
  target: Block -> one Block,
  body: Block -> lone Text,
  newParent: Block -> lone Block
}

pred legacyValid {
  no iden & ^oldParent
  LegacyContent = Placement.content
  all c: LegacyContent | c.(Import.representative).content = c
}

pred losslessImport {
  legacyValid
  // Each placement gets its own logical node and independent child structure.
  all disj a, b: Placement | a.(Import.converted) != b.(Import.converted)
  Block = Placement.(Import.converted)
  all p: Placement |
    let b = p.(Import.converted),
        owner = p.content.(Import.representative).(Import.converted) {
      b.(Import.target) = owner
      b.(Import.newParent) = p.oldParent.(Import.converted)
      b = owner implies b.(Import.body) = p.content.text
      b != owner implies no b.(Import.body)
    }
}

assert PreserveSharedBody {
  losslessImport implies
    (all a, b: Placement |
      (a.content = b.content) iff
        a.(Import.converted).(Import.target) =
        b.(Import.converted).(Import.target))
}
assert PreserveEachPlacementsChildren {
  losslessImport implies
    (all a, b: Placement |
      a->b in oldParent iff
        a.(Import.converted)->b.(Import.converted) in Import.newParent)
}
assert DisplayOriginalContent {
  losslessImport implies
    (all p: Placement |
      p.(Import.converted).(Import.target).(Import.body) = p.content.text)
}

// Deliberately false: Work alone is NOT a sufficient sharing key.
assert WorkAloneDeterminesCurrentBody {
  legacyValid implies
    (all a, b: Placement | a.content.work = b.content.work implies
      a.content.text = b.content.text)
}

run losslessImport for 4 expect 1
run {
  losslessImport
  some disj a, b: Placement | a.content = b.content and a.oldParent != b.oldParent
} for 4 expect 1
check PreserveSharedBody for 4 expect 0
check PreserveEachPlacementsChildren for 4 expect 0
check DisplayOriginalContent for 4 expect 0
check WorkAloneDeterminesCurrentBody for 4 expect 1
