# 完全削除・Undo barrierのAlloy検査記録

## 入力・実行

入力はユーザーが採用した「通常削除はUndo可能、完全削除はUndo不可、成功時にworkspaceの全Undo/Redo履歴をclearする」契約。
実装時の状態/失敗処理は[実装契約](../../docs/design/purge-undo-contract.md)を参照。

- Alloy: **6.2.0**、ユーザー指定JAR。
- Java: **OpenJDK 27.0.1.0.2**（`27.0.1.0.2+1-2`）。初回検査のJava 21.0.2とは異なるため、旧モデルも再実行した。
- solver: **SAT4J** / symmetry: 20。
- `purge_protocol.als` SHA-256: `4BFA08E2990231F68254307EF49A0583F85A9A955B5B607F578555F28A5515AF`

最終実行（repository root、PowerShell）:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/document-model-alloy/run.ps1 -OutputDirectory (Join-Path $env:DELTA_SCRATCH_DIR 'alloy-purge-reference') -TimeoutSeconds 180
```

終了code **0**。新20件と既存30件の**計50 commandがすべて期待と一致**。
18 witness（SAT）、25正条件（UNSAT）、7 negative control（SAT）。
raw receipt/instances/summaryは指定出力先に生成。scratchはturn限りなので、
再現時はREADMEの既定`.results/`出力か、別の永続出力先を指定する。

## 新モデル20 commandの結果

共通scopeは最大3 Block、2 Entry、ちょうど2 Session。Snapshot数は以下のとおり。
SATは`run`なら実例、`check`なら反例。正のcheckでUNSATでも、scope外の不存在は証明しない。

| index | command/目的 | Snapshot | 結果 |
| --- | --- | --- | --- |
| 0 | 入力flush→purge→耐久化→全clear→成功の正常経路 | 7 | SAT |
| 1 | 入力flush失敗 | 2 | SAT |
| 2 | purge適用後の保存失敗 | 2 | SAT |
| 3 | 既にpurgeしたIDがあっても、新編集後にUndo可能 | 3 | SAT |
| 4 | 代表purge時も外部参照項目とその子を非連鎖に保持 | 2 | SAT |
| 5 | InitialIsSafe | 1 | UNSAT |
| 6 | EveryStepPreservesSafety | 2 | UNSAT |
| 7 | CompleteOnlyAfterDurabilityAndReset | 2 | UNSAT |
| 8 | DirtyCannotResumeOrClearHistory | 2 | UNSAT |
| 9 | FailuresKeepDraftsAndHistory | 2 | UNSAT |
| 10 | LockedRejectsOrdinaryOperationsAndReads | 2 | UNSAT |
| 11 | NoPurgeWithoutConfirmationOrTrash | 2 | UNSAT |
| 12 | NoReferenceCascadeOrAutomaticRewire | 2 | UNSAT |
| 13 | RegistryNeverForgetsPurgedIDs | 2 | UNSAT |
| 14 | NoStaleReplayAfterReset | 3 | UNSAT |
| 15 | ExcludingPurgeOriginAloneIsEnough（誤実装） | 3 | SAT |
| 16 | ClearingOnlyOneSessionIsEnough（誤実装） | 3 | SAT |
| 17 | ReturningSuccessBeforeDiskIsSafe（誤実装） | 1 | SAT |
| 18 | purge後の新編集→Undo→Redoも可能 | 4 | SAT |
| 19 | ClearingOnlyUndoIsEnough（誤実装） | 3 | SAT |

## 実際に得た反例

モデルのhistory payloadは「復元時に露出し得る内容」の抽象化であり、
実Loroが同じ不具合を起こすと実測したものではない。

1. **purge origin除外だけでは不十分**:
   disk/memoryからBを消したDurable状態でも古いUndo entryは残る。
   clearせずIdleへ戻り、そのentryを実行すると、削除済みIDを残したままBの本文が再露出した。
2. **一つのsessionだけclearしても不十分**:
   別sessionに同じBを復元し得るentryが残る。そちらからUndoできた。
3. **Redoだけ残しても不十分**:
   Undoが空でも、古いRedo entryからBの本文を再露出できた。
4. **耐久化前の成功扱いは不十分**:
   Dirty状態にはmemory側の削除IDしかなく、disk側に削除IDが保存されていない反例が存在した。

全clear前は通常操作を再開しないこと、UndoだけでなくRedoも消すこと、durability境界を明示することが必要。

## 初期モデルからの修正と限界

初期の`safe`候補はIdleでのみ公開cacheのpurge済み本文を禁止していたため、
「前のpurgeで削除済みの本文がDrainingのcacheに残る」状態からflush失敗でIdleに戻れる反例が出た。
これはその`safe`候補では初期状態からの到達可能性を十分に特徴付けられていないことを示す。
「履歴/cacheは現在の対象以外の過去purge本文を含まない」を進行中も要求する帰納不変条件へ強化し、
最終モデルで全遷移の保存性を再検査した。

今回の結果はモデルの安全性条件を満たすbounded状態からの遷移検査。
実API、並行処理のスケジューリング、manager登録/破棄、crash/restart、cache実装、GC、
physical erasureや実UIの保証ではない。詳細な抽象化は実装契約の限界節を参照する。
