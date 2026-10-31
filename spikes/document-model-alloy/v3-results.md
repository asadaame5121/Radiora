# v3追加モデル検査（A01〜A03）の記録

実行日:
2026-10-31。入力は[v3検証対応計画 §6](../../docs/design/v3-verification-plan.md#6-追加モデル検査の決定範囲)、
[v3決定事項](../../docs/design/v3-model-decisions.md)、[完全削除とUndoの契約](../../docs/design/purge-undo-contract.md)。
既存モデル（`document_model.als`/`legacy_sharing.als`/`purge_protocol.als`）の本体・hash・旧記録は変更していない。
**有界scope内の検査であり、任意規模の証明・Loro/SQLite/OSの実装検証・製品の合格ではない。**

## 実行条件と結果

Alloy 6.2.0（既定JAR）、OpenJDK
27.0.1.0.2、SAT4J。`run.ps1`へ新モデル2件を登録し、5モデル全件を再実行した。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/document-model-alloy/run.ps1 `
  -OutputDirectory ./spikes/document-model-alloy/.results/a01-a02-2026-10-31
```

| モデル                                  | command                            | 結果                     | SHA-256                                                            |
| --------------------------------------- | ---------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| `shared_undo_protocol.als`（A01、新規） | 27（witness 6・正 15・negative 6） | 全件期待どおり           | `A4E2D758A9EE8E1A09ACE3D73A4E683BE1A46DA1BB4DCBFA09A9AB1C0209FAA8` |
| `delete_sets.als`（A02、新規）          | 18（witness 4・正 10・negative 4） | 全件期待どおり           | `986DFA400A236453E3A88BB7FE01C6B70CE22EA527769D2E10D69D0055A80F47` |
| `document_model.als`（既存）            | 24                                 | 全件期待どおり（再実行） | `1B081C1A09EF2E69E6D4E5293B0995700DF44689442BD547742B5F60635F0231` |
| `legacy_sharing.als`（既存）            | 6                                  | 全件期待どおり（再実行） | `22E9ACC0640F7B432352C89049BB163A678D7E0BBC1F83C5B86A5AADED87EC20` |
| `purge_protocol.als`（既存）            | 20                                 | 全件期待どおり（再実行） | `4BFA08E2990231F68254307EF49A0583F85A9A955B5B607F578555F28A5515AF` |

合計95 command、timeout・実行エラーなし。receipt・instance・`summary.json`は
`.results/a01-a02-2026-10-31/`（gitignore対象）に保存した。

## A01 共通Undo＋purge＋保存/公開protocol

`shared_undo_protocol.als`。workspaceで一つの`undo`/`redo` seq（LIFO）、履歴epoch、 command
ledger（applied/durable/acked）、公開版、crash＋再起動を表す。検査方法は旧モデルと同じ帰納法で、
`safe`をfactにせず`safe[s] and step[s, t] implies safe[t]`を確かめる。

| 保証（正のcheck）                                                                           | 内容                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `EveryStepPreservesSafety`                                                                  | 編集・保存・公開・応答・再送・Undo/Redo要求・stale拒否・purge全段階・crashの全遷移で安全性を維持 |
| `SuccessOnlyAfterDurabilityAndReset`                                                        | purge成功応答は耐久化と全履歴clearの後だけ                                                       |
| `BarrierRejectsOrdinaryOperations` / `DirtyCannotResumeOrClearHistory`                      | clear前は編集・Undo/Redo・保存・公開を再開しない。Dirtyで履歴を変えない                          |
| `StaleRequestsNeverExecute` / `ResetInvalidatesEveryCapturedRequest`                        | reset・再起動前に捕捉したUndo/Redo要求は実行しない                                               |
| `RestartStartsWithEmptyHistory` / `CrashAfterDurablePurgeIsSafe` / `AckedWorkSurvivesCrash` | 再起動後は空履歴、durable後crashでもpurged本文が戻らない、成功応答済み操作は再起動後も残る       |
| `ResendNeverDoubleApplies` / `NewEditInvalidatesRedo`                                       | 応答喪失後の再送で二重適用しない。新編集でRedo失効                                               |

安全性には「公開版・成功応答は耐久版以下」「先行purgeの本文を履歴/公開へ戻さない」
「履歴entryは現在epochのものだけ」を含む。

negative control（すべて反例あり＝誤実装を検出できる）:
早期成功（`EarlySuccessIsSafe`）、origin除外だけ（`ExcludingPurgeOriginAloneIsEnough`）、
dirty解除（`ClearingDirtyFlagIsSafe`・`ResumingDirtyPurgeIsSafe`）、早期公開（`PublishingMemoryIsSafe`）、
epoch未検証のUndo（`SkippingEpochCheckIsSafe`）。

witness: 保存失敗→retry→成功を含むpurge全経路（8状態）、flush失敗、commit後応答喪失→再送、
E07（durable後crash→再起動→新編集をUndo）、別paneが共通履歴の先頭entryをUndo、reset後のstale要求拒否。

検査中に見つけたモデル側の不備（製品仕様の変更ではない）:

- `util/sequniv`の`add`はseq上限で要素を黙って捨てるため、上限到達時に遷移不能となる`push`へ置換した。
  上限を超える履歴長はこのscopeでは探索しない。
- 公開版がDraining→flush失敗で耐久版を超える反例から、`Idle/Draining/Prepared`で公開版⊆耐久版、
  Dirty以外でdisk本文⊆memory本文の不変条件を明示した。

## A02 独立した削除集合・復元・purge

`delete_sets.als`。通常削除ごとのゴミ箱項目、元の親の状態による復元先、選択項目だけのpurge、参照項目を表す。

- 正:
  項目は互いに素、`deleted`＝全項目の和、liveな木は上方向に閉じる（`EveryStepPreservesSafety`）。
  C削除→B削除後のB復元/purgeでCの項目が残る、purge集合＝確認集合、参照経由の連鎖なし、
  使えない親へ復元しない、独立文書復元は確認必須、項目内部の構造を維持、purgedは復活しない。
- witness: 契約例「C削除→B削除→B復元でC残存→C復元はBの下」「Bのpurge後にCを確認付きで独立文書へ」、
  代表Bの削除で外部参照項目Rが残る、元親がゴミ箱内のCは独立復元が必要。
- negative control（すべて反例あり）: 元の部分木全体を選ぶ削除、元の木をたどるpurge、
  参照先をたどる削除、ゴミ箱内の親の下への復元。

兄弟順・本文・IDは扱わない。兄弟位置fallbackはPBTオラクル（V12）で扱う。

## A03 既存モデルと最新契約の差分監査

| 既存モデルの要素                                                                                            | 最新契約との関係                                                               | 扱い                                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `document_model` 単一forest、所属root一意、通常移動は境界内、切り出し/文書間移動でID維持、root Enter、Hoist | 一致                                                                           | V03の参考証拠に対応付け可（当時scope内）                            |
| `document_model` IDの非再利用、purge後もLink/Relation保持・自動接続なし                                     | 一致                                                                           | V12/A02と整合                                                       |
| `document_model` `restoreSubtree`/`purgeSubtree`（元の部分木全体を復元/purge、親がliveの時だけ復元）        | **不一致**: 最新契約は削除操作ごとの独立項目、親が使えなければ確認付き独立文書 | A02が置換。旧checkは当時の解釈の記録として保持し、V12の証拠にしない |
| `document_model` 介在操作なしの構造Undo 1回                                                                 | 部分一致: 共通LIFO履歴・複数段は未表現                                         | A01（履歴protocol）とV11オラクルで置換                              |
| `document_model` `duplicateLeaf`                                                                            | 部分一致: 葉だけ。コピー集合内外の参照対応は未表現                             | V03オラクルで補完                                                   |
| `legacy_sharing` 旧共有本文の保全・配置ごとの子                                                             | 方向は一致                                                                     | #384の写像確定まで保留。V15の証拠にしない                           |
| `purge_protocol` 複数session履歴の全reset                                                                   | **方式変更**: 初回v3は共通履歴                                                 | A01が置換。旧記録は参考として保持                                   |

## 限界

- scope: A01は最大3 Block・3 Entry・3 Cmd・2 Pane・3 Epoch・2 Request・seq長3、遷移は2〜8状態。
  A02は最大5 Block・3 Item、2〜5状態。この範囲外の反例がないことは示していない。
- 本文は「露出し得る集合」、履歴entryは復元し得る本文の過大近似。文字列、Loroの内部ID、
  mergeInterval、snapshot集約、SQLiteの具体的transaction、OSの耐久性は扱わない。
- crashはprocess停止＋再起動の抽象。停電・ストレージ故障の証明ではない。livenessは
  有限witness（保存失敗→retry→成功）だけで、永続的に失敗する環境での進行は保証しない。
- Rust/PBTへの接続は[オラクル](../../crates/radiora-core/tests/oracles/)の固定例・性質として行った。
  製品command・実Loro/SQLite（I層）・CI jobへの接続は未実施。
