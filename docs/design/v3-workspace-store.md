# v3 本文保存の中核（段階B1）

作成日: 2026-11-20。状態: 実装済み（`radiora-core::app`、`radiora-infra::workspace`）。
開発データ用であり、#383の受入・G2承認ではない。
段階Bの目標「文書を作り本文を保存し、再起動後に復元する」の保存部分。Tauri
command・UIは後続のB3/B4で接続する。

## 1. 責務の分担

[C4](v3-c4-architecture.md) C3のcomponentに合わせて分ける。core側にLoro/SQLite/Tauriの型は現れない。

| component               | 置き場所                                   | 責務                                                                                                           |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Application coordinator | `radiora_core::app::DocumentCoordinator`   | 単一writer。要求の照合（receipt/再送/ID再利用）、版の確認、保存phase（Ready/Dirty/RecoveryRequired）、公開可否 |
| Pure planner            | `radiora_core::app::plan`                  | 読取り状態（`BlockPresence`）＋command→意味的な変更（`DocumentChange`）またはdomain error                      |
| Feature-specific port   | `radiora_core::app::DocumentStore`         | 文書保存とcommitted queryの契約。coreが定義する                                                                |
| 文書adapter             | `radiora_infra::workspace::WorkspaceStore` | portの実装。計画の適用・export・SQLite耐久化・receipt記録を一つの協調契約で行う                                |
| ID adapter              | `radiora_infra::workspace::issue_block_id` | UUIDv7の発行。coreは発行済みIDを受け取る                                                                       |

adapterは防御として、未保存の変更がある間の適用・公開を自身でも拒否する。

## 2. 採用した契約

[保存PoC](../../spikes/loro-purge/README.md)と[保存・復旧の検証結果](../../spikes/loro-purge/storage-recovery-results.md)の手順に従う。

- 単一workspaceに一つのLoroDocを正本とする。
- 変更の成功は、Loro updateとreceiptが同じSQLite transactionで耐久化された後だけ返す（WAL＋
  `synchronous=FULL`）。PoCと同じく実効値を確認し、適用されなければ`NotDurable`で開かない。
- 保存失敗では変更をメモリ上に残したままDirtyにする。`retry`は保存だけを再試行し、Loro操作を再適用しない。
  Dirtyの間は読取りも別の要求も`PersistPending`で拒否し、未保存値を公開しない。部分適用はRecoveryRequiredとし、
  再openだけで回復する。
- 要求はclient発行の`RequestId`と、要求内容の`Fingerprint`（長さ付きfieldの正準表現）で識別する。
  adapterはそのSHA-256をreceiptに記録する。同じ要求の再送は記録済みの結果を`replayed: true`で返し、
  同じIDで内容が違えば`RequestReused`。Dirty中の同じ要求の再送は`retry`と同じ扱い。
- 保存後応答喪失（COMMITは成功したが呼出し側にはerrorが返った）では、`retry`がまずreceiptを照合し、
  記録済みの版で決着させる（PoCの「receipt照合でReady」）。updateを二重に追記しない。
- 版（version）は最後に耐久化したupdateの連番（初期snapshotのみなら`0`）。単調増加し、要求には
  編集開始時の版を`base`として付ける。異なれば`StaleVersion`で拒否する。
- 内容が変わらない要求はupdateを作らず、receiptだけを現在の版で記録する。
- 再起動ではsnapshotの後に全updateを順にimportする。依存の欠けたupdateは`Corrupt`で拒否する。
- adapterは保存失敗・部分適用・receiptによる決着を`tracing`で記録する。本文は記録しない。

## 3. 保存形式（schema v1）

Loro文書は[Legacy Importer設計](v3-legacy-import-mapping.md) §3の「Loro文書schema v1」に従う
（Importerと#385で共有する）。SQLiteの`snapshot`/`updates`は同§2に従い、`store_meta`と`applied_request`は
本storeが追加した。

| 層     | 内容                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------- |
| SQLite | `store_meta`（`format`、`schema_version`）、`snapshot`（1行、`through_seq`）、`updates`（AUTOINCREMENT）、`applied_request` |
| Loro   | Map `meta`（`schemaVersion=1`、`workspaceId`）、Tree `blocks`（node metadataに`id`・`kind="block"`・LoroText `text`）       |

段階Bが書くのは`kind="block"`だけ。`kind="reference"`は`BlockPresence::Live { owns_body: false }`として
本文編集を`NoBody`で拒否するが、参照先本文の表示は未実装でreadは`Corrupt`になる。`aliases`、`trash`、`legacy`、
`relations`、`relationTypes`、`deletedIds`はまだ書かず、未知のkindは推測せず`Corrupt`で拒否する。
SQLiteとLoroのどちらかのschemaが`1`でなければ開かずに`SchemaMismatch`、他アプリのDBは`NotWorkspace`を返す。

**検証が残る点:**
保存PoCでは、通常削除のUndoや復元でLoroがTreeIDを作り直すことを観測した。本文をnode
metadataのLoroTextに置くため、そのとき本文containerが保たれるかは、削除・Undoを実装するT-07/#383で実Loroで確認する。
保たれない場合は本書で決めず、schemaの見直しとして報告する。
G2前の開発データは互換を保証しない。形式を変えたら版を上げ、旧開発DBは手動で削除する。

## 4. 検証

[検証計画](v3-verification-plan.md)のV01に対応する。

- **P/S** `crates/radiora-core/tests/app_coordinator.rs`: plannerの全分岐、Fingerprintの区別、
  coordinatorの状態機械PBT（256ケース、最長40操作）。制御可能なportで保存前失敗・保存後応答喪失・
  部分適用・再open・再送・古い版を注入し、公開版≦耐久版、未保存値の非公開、同一起動中の二重適用なし、
  要求ごとの耐久化は一度だけ、を検査する。retryのreceipt照合を外す誤実装で失敗することを確認した。
- **I** `crates/radiora-infra/tests/workspace_store.rs`（14件）: 製品の入口`DocumentCoordinator`を
  実`WorkspaceStore`（実Loro/SQLite）に載せて検査する。保存失敗は別connectionのSQLite
  triggerで注入し、
  製品codeに試験用hookを置かない。本文の往復、再送、ID再利用、内容不変、古い版、未知/重複Block、
  保存失敗→retry、未保存変更の喪失と非公開、schema不一致・他アプリDBの拒否、WAL、共有schema
  v1の保存形式。
- **adapter単体** `src/workspace/tests.rs`: 公開APIでは作れない保存後応答喪失を、メモリ上の状態を
  保存前へ戻して再現し、receiptと`acknowledge_durable`で決着することを確認する。

## 5. 未対応（後続）

- V01のN（実Tauriの縦断）はB3〜B5。commit直前/直後のkill、snapshot集約中断は#383。
- snapshot集約と取込済みupdateの削除、`applied_request`の保持期間（#383）。
- crash/停電、1万Block規模、WAL実容量の測定（#383）。
- 共通Undo、構造操作、ゴミ箱/完全削除（T-07・#286）。commit originは`user:body-slice`。
- Blockの検索は全node走査。補完・索引は段階C以降で別の派生索引にする。
- 版はworkspace全体の粒度。複数paneの同時編集で不要な`StaleVersion`が出るため、段階Cで粒度を見直す。
- 単一processの保証（二重起動の排他）とcoordinatorのthread間共有はdesktop側（B3）で扱う。
