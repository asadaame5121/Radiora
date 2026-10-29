# 完全削除とUndo/Redoの実装契約

状態: ユーザー採用済みの方針。Alloy有界検査済み。
独立Rust PoCで実Loro/SQLiteの部分検証を実施。初回v3はworkspace共通Undo履歴へ方針変更した。
既存Alloyと旧Rust fixtureは複数履歴方式の検証記録。共通履歴でのpurge・retryは
[追加Rust fixture](../../spikes/loro-purge/shared-undo-results.md)で確認したが、製品UIは未実装。
対象: 単一workspace・単一Backend LoroDoc。通常削除と完全削除を分ける。
関連: #381（意味）、#383（保存/失敗/UndoManager検証）、#385（UI・要求失効）。

## 1. 採用した仕様

- 通常削除は復元可能なTombstone。完全削除はUndo不可。
- 完全削除はゴミ箱からだけ実行し、通常のDeleteキーへ割り当てない。
- 完全削除するBlock/子孫を事前に明示する。
  「元に戻せない」だけでなく、**workspace内の他の編集のUndo/Redo履歴もリセットされる**と確認する。
- 対象は選択したゴミ箱項目に含まれる集合。別の削除操作で作られたゴミ箱項目は独立とし、
  元の親子関係をたどって暗黙に追加しない。確認集合と実際の本文除去・purged記録の集合を一致させる。
  ゴミ箱全体を空にする場合は、独立した各項目も明示的に対象へ含める。
- 成功時にはworkspace共通のUndo/Redo履歴をclearする。操作をoriginでUndo対象外にするだけでは不十分。
  全pane/sessionがこの共通履歴を使い、独立したstackを保持しない。
- 完全削除後も論理IDを予約し、再利用しない。本文/タイトルは通常のAPI・検索・補完等へ出さない。
- Link/RelationはMissing参照として残す。隣接Relationを自動生成しない。
- 参照をたどって外部の参照項目やその子を連鎖削除しない。明示した削除集合だけを処理する。
- 過去のLoro履歴・backupからの物理抹消は保証しない。

## 2. 状態遷移と公開権限

| 状態 | 入れる操作 | 禁止・失敗時の扱い |
| --- | --- | --- |
| `Idle` | 通常編集・Undo/Redo。確認済みのゴミ箱対象で完全削除開始 | 同じworkspaceの処理をwriterが直列化する |
| `Draining` | 通常操作を止め、専用の準備権限で未保存入力をflush | 新しい編集/Undo/Redo/autosave適用を通さない。flush失敗なら削除せず、入力と履歴を維持してIdleへ |
| `Prepared` | 対象集合を確定したままメモリへpurge適用 | pending入力がないことを確認。まだ履歴を消さない |
| `Dirty` | 同じ適用済み差分の耐久化を試みる | 保存失敗でもIdleへ戻さない。後続編集・Undo/Redo・通常queryを止め、保存のみretry/復旧。purgeを二重適用しない |
| `Durable` | SQLiteへbody除去と削除済みIDの記録が保存済み。共通managerのclearへ | まだ成功応答・通常操作再開をしない |
| `Reset` | workspace共通のUndo/Redo履歴clearが完了 | clear完了を確認するまでこの状態とみなさない |
| `Idle`へ復帰 | 保存済みread modelを公開し、成功を返して通常操作を再開 | 耐久化と全clearの両方を確認してから実行 |

`finally`で無条件にunlock/成功扱いする実装は禁止する。
Draining中のflushを通常書込APIの停止待ちqueueへ戻すとdeadlockになるため、
準備中のownerにだけ与える保存権限で実行する。

共通managerのclearが完了するまで通常操作を再開しない。
clearに失敗した場合はbarrierを維持して再試行/復旧する。
既存Alloyモデルの`resetAll`は複数履歴を対象とした旧方式の抽象化であり、共通履歴版の検査完了とは扱わない。

## 3. 実装時の重要な境界

- barrierはUIボタンだけでなくBackend writerで強制する。複数pane/sessionの要求、timer、
  autosave callback、既にqueueされたUndo/Redoも実行時に権限を再確認する。
- clear前に捕捉された古いUndo/Redo要求を、履歴clear後に無条件実行しない。
  現在のmanager/履歴membership、必要なら世代tokenを再検証する。
- 共通managerの寿命はBackend ownerが管理する。pane/sessionの生成・再接続で独立managerを作らず、
  barrierを迂回したり、廃棄済みmanagerや古い保存済みstackが復活したりしないようにする。
- 成功後の新しい編集は通常どおりUndo/Redo可能。完全削除が以後のUndo全体を永久無効化する仕様ではない。
- 新しい編集・履歴payloadに既に完全削除した本文が混入しない。
  再起動・backupからの明示的復元・履歴GCは別の操作契約で扱う。
- 検索/補完/参照表示cacheの失効も実装試験に含める。

Loroではpurge originを非記録にする設定と共通UndoManagerの`clear`を組み合わせる方針。
実Rust APIの設定・通知再入・共通履歴での複数pane要求は#383で検証し、
Alloyだけでライブラリ挙動を確認済みとはしない。

## 4. Alloyでモデル化したこと

以下は共通履歴への方針変更前の検査記録。モデル本体・hash・結果は変更せず保存する。

[purge_protocol.als](../../spikes/document-model-alloy/purge_protocol.als)は以下を表す。

- memory/diskそれぞれの本文存在と削除済みID。
- 複数sessionのUndo/Redo履歴と、過去本文を再露出し得るpayload。
- 未保存入力、確認、ゴミ箱対象、選択集合、公開済みcache、完了扱い。
- 正常経路、flush失敗、適用後の保存失敗とretry、全履歴リセット、再開後の新しいUndo/Redo。
- 部分clear・Redo残存・origin除外のみ・耐久化前成功という意図的な誤実装。

前提となる安全性候補は`safe`、検査は`InitialIsSafe`と`EveryStepPreservesSafety`。
遷移後の安全性をfactで強制せず、前状態が安全なら各操作で安全性を維持するかを検査した。
`safe`には「前のpurgeで消した本文が、次のpurge中の履歴/cacheへ戻らない」条件も含む。

## 5. 限界と実行試験への引継ぎ

- 最大3 Block、2 session、2履歴entry。正常経路witnessは7 snapshot。任意規模の証明ではない。
- 履歴はstack順序/本文文字列ではなく「再露出し得るBlock」の集合として保守的に抽象化した。
  実Loroの削除Undo・多段Undo・text container再生成・mergeIntervalは扱わない。
- モデルの対象集合は一つのゴミ箱部分木。子孫の一部だけを選ぶUI、子の昇格、
  通常削除/復元の親子方針は別判断。確認した集合と実際に消す集合の一致を実装で検査する。
- parentと参照先はこのprotocol中に変えない前提。全構造操作は既存の文書モデルと別途照合する。
- pendingはflush待ちの印であり、実際の文字列や耐久保存の内容までは検証しない。
- 進行中の無限retry・到達保証・process crash/restartは未モデル化。
  特にdisk保存後/clear前の終了から、永続化済み削除IDと新しい空のUndoManagerで安全に再起動する試験が必要。
- 古い履歴/backupを人が明示的に復元する場合の意味、OS/SQLiteの耐久保証、1万件性能、UI確認文言も実装試験で確認する。

実行結果とモデルhashは[追加検査記録](../../spikes/document-model-alloy/purge-results.md)。
実装者は正常系の順序だけでなく、各失敗状態から「何をしてはいけないか」も同じfixtureで検証する。

## 6. 実Loro/SQLite PoCの結果

[独立Rust PoC](../../spikes/loro-purge/README.md)で、origin除外だけでは旧履歴を消せないこと、
全managerのclear、SQLite失敗中の操作拒否、差分のみのretry、再open後のpurged IDを確認した。
ただし同一Doc/peerの複数managerでは、origin分離だけだと他sessionのUndoまで記録される。
他managerのpause/resumeで別Block caseは改善したが、同じ本文のUndo/Redoで文字順が戻らない再現caseが残る。
異なるpeer/Docでも再現することを[追加調査](../../spikes/loro-purge/undo-research.md)で確認した。
ユーザー決定により初回v3はworkspace共通履歴を採用し、独立session履歴と独自の選択的Undoは対象外とした。
旧方式の失敗caseは期待値を書き換えず診断として残すが、初回v3の独立session Undo受入とはしない。
共通履歴の追加fixtureでは、purge・保存失敗/retry・Tree操作を含む13件の公開操作testが成功した。
これは製品UI、crash復旧、共通履歴版Alloyの検証完了ではない。範囲と限界は
[共通履歴の検証記録](../../spikes/loro-purge/shared-undo-results.md)を参照する。
