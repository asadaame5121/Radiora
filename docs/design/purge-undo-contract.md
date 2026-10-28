# 完全削除とUndo/Redoの実装契約

状態: ユーザー採用済みの方針。Alloy有界検査済み。
独立Rust PoCで実Loro/SQLiteの部分検証を実施したが、同本文の複数session Redoは未成立、製品UIは未実装。
対象: 単一workspace・単一Backend LoroDoc。通常削除と完全削除を分ける。
関連: #381（意味）、#383（保存/失敗/UndoManager検証）、#385（UI・要求失効）。

## 1. 採用した仕様

- 通常削除は復元可能なTombstone。完全削除はUndo不可。
- 完全削除はゴミ箱からだけ実行し、通常のDeleteキーへ割り当てない。
- 完全削除するBlock/子孫を事前に明示する。
  「元に戻せない」だけでなく、**workspace内の他の編集のUndo/Redo履歴もリセットされる**と確認する。
- 成功時には全sessionのUndo/Redo履歴をclearする。操作をoriginでUndo対象外にするだけでは不十分。
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
| `Durable` | SQLiteへbody除去と削除済みIDの記録が保存済み。全managerのclearへ | まだ成功応答・通常操作再開をしない |
| `Reset` | 全sessionのUndo/Redo履歴clearが完了 | clear漏れ・未確認のmanagerがある間はこの状態とみなさない |
| `Idle`へ復帰 | 保存済みread modelを公開し、成功を返して通常操作を再開 | 耐久化と全clearの両方を確認してから実行 |

`finally`で無条件にunlock/成功扱いする実装は禁止する。
Draining中のflushを通常書込APIの停止待ちqueueへ戻すとdeadlockになるため、
準備中のownerにだけ与える保存権限で実行する。

全managerのclearは実コード上で順次実行してよいが、**途中で通常操作を再開しない**。
一部clearの失敗時はbarrierを維持して再試行/復旧する。モデルは全完了を一つの`resetAll`遷移へ抽象化している。

## 3. 実装時の重要な境界

- barrierはUIボタンだけでなくBackend writerで強制する。複数pane/sessionの要求、timer、
  autosave callback、既にqueueされたUndo/Redoも実行時に権限を再確認する。
- clear前に捕捉された古いUndo/Redo要求を、履歴clear後に無条件実行しない。
  現在のmanager/履歴membership、必要なら世代tokenを再検証する。
- 全sessionの列挙と寿命はownerが管理する。barrier中の新規manager生成・再接続を調停し、
  廃棄したmanagerや古い保存済みstackが復活しないようにする。
- 成功後の新しい編集は通常どおりUndo/Redo可能。完全削除が以後のUndo全体を永久無効化する仕様ではない。
- 新しい編集・履歴payloadに既に完全削除した本文が混入しない。
  再起動・backupからの明示的復元・履歴GCは別の操作契約で扱う。
- 検索/補完/参照表示cacheの失効も実装試験に含める。

Loroではpurge originを非記録にする設定と全UndoManagerの`clear`を組み合わせる方針。
実Rust APIの設定・通知再入・session分離は#383で検証し、Alloyだけでライブラリ挙動を確認済みとはしない。

## 4. Alloyでモデル化したこと

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
これは未解決の実装条件であり、形式仕様の検査や通常testの成功で代替しない。
