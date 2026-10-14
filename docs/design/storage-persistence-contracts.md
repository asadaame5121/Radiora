---
title: Radiora 永続化契約・保存復元対応表
date: 2026-10-14
status: accepted
tags:
  - radiora
  - design
  - storage
  - persistence
  - contract
---

# Radiora 永続化契約・保存復元対応表 (S0)

## 1. 目的

本書は、リファクタリング計画 S（Memory / SQLite / JSON Storage）の着手前提として、 `GraphStore`
の全状態フィールド（16フィールド + 関係型定義）および全 mutation メソッド（37操作）について、 Memory
/ SQLite / JSON の 3
つのバックエンドにおける保存・復元経路、トランザクション保証、ロールバック挙動、
および対応するテストを体系的に整理・対応付けた永続化契約の正本である。

JSON の通常保存を SQLite と同等の ACID /
キュー保証と仮定せず、各バックエンドが提供する固有の保証と制約を明確化する。

P3 の照合対象は #347 (`9a3358d`)、契約テスト #342 (`830b98a`)、文書 #343 (`adde36c`)。
以下にはレビュー後の局所更新・永続化境界の修正も含む。main への反映とは区別する。

---

## 2. 状態フィールド永続化対応表 (State Field Matrix)

`GraphStateSnapshot` に含まれる全フィールドの各バックエンドにおける対応:

| フィールド名              | Memory                                           | SQLite (Table / Schema v2)  | JSON (Backup V8 envelope)      | 検証テスト                                                      |
| :------------------------ | :----------------------------------------------- | :-------------------------- | :----------------------------- | :-------------------------------------------------------------- |
| `works`                   | `Work[]`                                         | `works`                     | `data.works`                   | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `branches`                | `Branch[]`                                       | `branches`                  | `data.branches`                | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `workingCopies`           | `WorkingCopy[]`                                  | `working_copies`            | `data.workingCopies`           | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `occurrences`             | `Occurrence[]`                                   | `occurrences`               | `data.occurrences`             | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `links`                   | `OutlineLink[]`                                  | `outline_links`             | `data.links`                   | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `systemRelations`         | `SystemRelation[]`                               | `system_relations`          | `data.systemRelations`         | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `knots`                   | `Knot[]`                                         | `knots`                     | `data.knots`                   | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `aliases`                 | `SearchAlias[]`                                  | `search_aliases`            | `data.aliases`                 | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `emergenceFeedback`       | `Record<string, "accept" \| "dismiss" \| "pin">` | `emergence_feedback`        | `data.emergenceFeedback`       | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `emergenceSuggestions`    | `EmergenceSuggestion[]`                          | `emergence_suggestions`     | `data.emergenceSuggestions`    | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `savedRuleQueries`        | `SavedRuleQuery[]`                               | `saved_rule_queries`        | `data.savedRuleQueries`        | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `purgeManifests`          | `PurgeManifest[]`                                | `purge_manifests`           | `data.purgeManifests`          | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `revisions`               | `Revision[]`                                     | `revisions`                 | `data.revisions`               | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `recoverySnapshots`       | `RecoverySnapshot[]`                             | `recovery_snapshots`        | `data.recoverySnapshots`       | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `bookmarks`               | `Bookmark[]`                                     | `bookmarks`                 | `data.bookmarks`               | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `resumePosition`          | `ResumePosition \| null`                         | `resume_position` (単一row) | `data.resumePosition`          | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |
| `relationTypeDefinitions` | `RelationTypeDefinition[]`                       | `relation_type_definitions` | `data.relationTypeDefinitions` | `graph_store_contract_test.ts`, `sqlite_store_contract_test.ts` |

---

## 3. ミューテーション操作と永続化・ロールバック契約 (Mutation Matrix)

各 mutation 操作に対する各バックエンドの挙動:

SQLite の `mutate()` / `mutateTargeted()` / `batch()` は `SqlitePersistence` が所有する。
局所更新もバッチ内では個別保存せず、外側の全差分コミットへ参加する。

| 操作分類          | メソッド名                     | Memory 挙動                    | SQLite 挙動                                                                                                 | JSON 挙動                                                                                                      | 主な検証テスト                                                                  |
| :---------------- | :----------------------------- | :----------------------------- | :---------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| **Work Bundle**   | `createWorkBundle`             | 同期インメモリ追加             | `mutate()`: queue 直列化, 差分保存, エラー時メモリ復元                                                      | `super` 実行後 `persist()` 全体書き出し                                                                        | `graph_store_contract_test.ts`                                                  |
|                   | `importWorkBundles`            | 一括検証後に追加               | `mutate()`                                                                                                  | `captureAllState()` で退避、失敗時 `restoreAllState()`                                                         | `work_bundle_import_test.ts`                                                    |
|                   | `createUnplacedWork`           | 未配置 Work/Branch/Copy 追加   | `mutate()`                                                                                                  | 退避後 `persist()`、失敗時 rollback                                                                            | `unplaced_inbox_ui_contract_test.ts`                                            |
|                   | `resolveWorkStub`              | stub 属性解除と更新日反映      | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `stub_ui_contract_test.ts`                                                      |
|                   | `mergeWorks`                   | 分岐統合、リンク・配置の書換   | `mutate()`                                                                                                  | `captureAllState()` で退避、失敗時 rollback                                                                    | `memory_store_operations_test.ts`                                               |
|                   | `setWorkHistoricalTime`        | 歴史年代の付与/解除            | `mutate()`                                                                                                  | `captureAllState()` で退避、失敗時 rollback                                                                    | `sqlite_store_contract_test.ts`                                                 |
| **Branch / Copy** | `createBranch`                 | Branch / Copy 追加             | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `updateBranch`                 | headRevisionId / name 更新     | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `updateBranchWorkingCopy`      | 本文 / updatedAt 更新          | `mutateTargeted()`: 対象行 + metadata、失敗時局所 rollback                                                  | `super` 実行後 `persist()`                                                                                     | `sqlite_store_contract_test.ts`, `sqlite_targeted_failure_contract_test.ts`     |
|                   | `updateWorkingCopy`            | main 本文更新                  | `mutateTargeted()`: 対象行 + metadata、失敗時局所 rollback                                                  | `super` 実行後 `persist()`                                                                                     | `sqlite_store_contract_test.ts`, `sqlite_targeted_failure_contract_test.ts`     |
| **Revision**      | `createRevision`               | DAG 不変条件検証後に追加       | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
| **Recovery**      | `createRecoverySnapshot`       | snapshot 追加                  | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `applyRecoverySnapshot`        | Working Copy へ復元            | `mutate()`                                                                                                  | `captureRecoveryMutationState()` で退避、失敗時 rollback                                                       | `graph_store_contract_test.ts`                                                  |
|                   | `restoreRecoverySnapshot`      | 退避 snapshot 作成の上で復元   | `mutate()`                                                                                                  | `captureRecoveryMutationState()` で退避、失敗時 rollback                                                       | `graph_store_contract_test.ts`                                                  |
|                   | `promoteRecoverySnapshot`      | snapshot を Revision へ昇格    | `mutate()`                                                                                                  | `captureRecoveryMutationState()` で退避、失敗時 rollback                                                       | `graph_store_contract_test.ts`                                                  |
| **Trash / Purge** | `trashWork`                    | `deletedAt` 設定               | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `restoreWork`                  | `deletedAt = null`             | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `purgeWork`                    | 関連全実体削除 & manifest 生成 | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
| **Occurrence**    | `createOccurrence`             | 配置レコード追加               | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `updateOccurrence`             | 順序・折畳・見出し等更新       | `mutateTargeted()`: 局所検証・更新、構造変更時は Knot 再構築と全差分保存                                    | `super` 実行後 `persist()`                                                                                     | `sqlite_targeted_mutations_test.ts`, `sqlite_targeted_failure_contract_test.ts` |
|                   | `deleteOccurrence`             | 配置レコード削除               | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
| **Bookmark**      | `createBookmark`               | 栞レコード追加                 | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `deleteBookmark`               | 栞レコード削除                 | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
| **Resume**        | `setResumePosition`            | 単一再開位置更新               | `mutateTargeted()`: 対象行 + metadata、失敗時局所 rollback                                                  | `super` 実行後 `persist()`                                                                                     | `sqlite_store_contract_test.ts`, `sqlite_targeted_failure_contract_test.ts`     |
|                   | `clearResumePosition`          | 再開位置 null 設定             | `mutateTargeted()`: 対象行 + metadata、失敗時局所 rollback                                                  | `super` 実行後 `persist()`                                                                                     | `sqlite_store_contract_test.ts`, `sqlite_targeted_failure_contract_test.ts`     |
| **Relation**      | `createLink`                   | 意味リンク追加                 | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `deleteLink`                   | 意味リンク削除                 | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `replaceKnots`                 | 循環 Knot 一括置換             | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
| **Discovery**     | `upsertAlias`                  | 検索別名追加/更新              | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `deleteAlias`                  | 検索別名削除                   | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `setEmergenceFeedback`         | フィードバック記録             | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `upsertEmergenceSuggestion`    | 提案レコード追加/更新          | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `resolveEmergenceSuggestion`   | 提案状態遷移・リンク生成       | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `upsertSavedRuleQuery`         | 保存クエリ追加/更新            | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
|                   | `deleteSavedRuleQuery`         | 保存クエリ削除                 | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
| **Relation Type** | `createRelationTypeDefinition` | カスタム関係型追加             | `mutate()`                                                                                                  | `super` 実行後 `persist()`                                                                                     | `graph_store_contract_test.ts`                                                  |
| **Batch**         | `batch`                        | 同期/非同期例外時 rollback     | `batch()`: `AsyncLocalStorage` 文脈, 単一トランザクション差分コミット, 外部操作キュー待機, 失敗時メモリ復元 | `batch()`: `AsyncLocalStorage` 文脈, 一時ファイル (`.batch-*.tmp`) 出力 → アトミック `rename`, 失敗時 rollback | `sqlite_store_contract_test.ts`, `json_persistence_contract_test.ts`            |
| **Restore**       | `restoreGraphState`            | 全状態のスナップショット置換   | `mutate()` (差分計算しテーブルへ一括反映)                                                                   | 一時ファイル `.tmp` 出力 → アトミック `rename`、失敗時 `remove`                                                | `json_backup_restore_test.ts`, `sqlite_store_contract_test.ts`                  |

---

## 4. バックエンドごとの保証と非保証 (Guarantees & Non-guarantees)

### 4.1 SqliteGraphStore（現行本番 backend）

- **保証**:
  1. **直列化キュー (`mutationQueue`)**: すべての外部非同期 mutation は内部キューにより 1
     つずつ順序通りに実行される。
  2. **`AsyncLocalStorage` による非同期実行文脈分離 (C05)**:
     - 各 store インスタンスの `SqlitePersistence` が独立した `batchContext`
       を保持し、`batch(operation)` の実行文脈を追跡する。
     - バッチ内部の mutation はキューを迂回してインメモリ状態のみ更新し、バッチ終了時に単一の SQLite
       トランザクションで差分を一括適用する。
     - バッチ実行中に外部から発行された mutation
       はキューで待機し、バッチ完了（コミットまたはロールバック）後に順次実行される。バッチのロールバックが外部更新を巻き込むことはない。
     - ネストした `batch()` は親文脈を共有し、二重キャプチャやトランザクションの多重開始を防止する。
     - バッチ文脈が終了した後に遅延発行された mutation（期限切れ文脈）は明示的に reject される。
  3. **キュー内での先行変更反映 (C06, C07)**:
     - `replaceKnots` の同値判定はキュー取得後に最新メモリ状態と比較して判定され、先行 mutation
       の影響を正しく反映する（C06）。
     - `updateWorkingCopy` は実行計画内で最新の `main` Branch を探索し、直前の `createWorkBundle`
       等で生成された Branch を確実に検出する（C07）。
  4. **局所保存と参照整合性検証 (C04, C08)**:
     - 本文更新、ResumePosition 更新・解除、親 / Work を変更しない Occurrence 更新は
       `mutateTargeted()` と `applySqliteDiffOperations()` で対象レコードと metadata のみ保存する。
       全状態の clone・検証・比較は行わないが、対象探索の配列走査は残る。
     - 親 / Work が変わる Occurrence 更新も同じ局所プランで検証・適用する。Knot 投影を dirty にし、
       非バッチ時は `commitFullMutation()`、バッチ内では外側のコミットで一度再構築・全差分保存する。
     - 更新対象の Occurrence が存在しない場合は no-op として正常終了し、例外を投げない（C08）。
     - 対象が存在する場合は、shape 検証に加えて Work 存在、Branch または pinned Revision
       存在、および Bookmark / ResumePosition
       との参照整合性を厳格に検証し、不正参照の保存を拒否する（C04）。
  5. **ACID トランザクションと自動ロールバック**:
     - `persistSqliteDiff()` と `applySqliteDiffOperations()` は変更がある場合に単一の SQLite
       トランザクションを実行し、成功時のみコミットする。空の差分は書き込まない。
     - 局所保存の失敗は `TargetedMutationStep.rollback()` で対象レコードを元に戻す。
       全差分保存・バッチの失敗は `before` 全状態をメモリへ復元し、Knot の dirty 状態も解除する。
     - transaction 開始、SQL 適用後、COMMIT の障害、次の queued mutation、再起動時の整合性は
       `sqlite_targeted_failure_contract_test.ts` で検証する。
  6. **クローズ契約**:
     - `close()` 呼び出し時はキュー内の先行 mutation がすべて完了するのを待機し、WAL
       チェックポイント（`TRUNCATE`）および `journal_mode = DELETE`
       を実行して安全にファイルを閉じる。
     - クローズ開始後に発行された新規 mutation は直ちに reject される。
     - 自身のデッドロックを防ぐため、アクティブなバッチ内部からの `close()` 呼び出しは明示的に
       reject される。
- **非保証**:
  - 外部プロセスによる同一 SQLite
    ファイルへの同時排他制御（単一デスクトップアプリインスタンスによる専有利用を前提とする）。

### 4.2 JsonGraphStore（バックアップ・可搬用 / 旧ローカル backend）

- **保証**:
  1. **直列化キュー (`mutationQueue`)**:
     - `JsonPersistence` は gate 方式の単一キューを持ち、すべての外部 `mutate` /
       `mutateWithRollback` / `persist` / `batch` / `restoreGraphState` の実行順序を固定する。
  2. **`AsyncLocalStorage` による非同期再入・文脈管理 (C02)**:
     - 内部 mutation（例: `super.updateWorkingCopy` から呼ばれる別
       override）はアクティブ文脈を検知して余分なキューイング・二重保存を行わずメモリ操作のみを実行する。
     - ネストした操作は外側のコミットで一度だけ永続化される。
  3. **アトミック batch 永続化 (C02)**:
     - `batch(operation)` はバッチ中の途中保存をスキップし、完了後にフォーマット V8 の完全 JSON
       を一意な一時ファイル（`${path}.batch-${uuid}.tmp`）へ出力後、ファイルシステムの `rename`
       操作でアトミックに置換する。
     - コールバックや書き込みが失敗した場合は一時ファイルを cleanup し、インメモリ状態を `before`
       スナップショットへロールバックする。
  4. **アトミック復元 (`restoreGraphState`)**:
     - 復元時は直接ファイルを上書きせず、一時ファイル（`${path}.restore-${uuid}.tmp`）へ書き出してから
       `rename` 操作でアトミックに置換する。失敗時は一時ファイルを削除し、メモリ状態を `before`
       へ戻す。
  5. **クローズ契約**:
     - `JsonGraphStore.close()` は `persistence.close()`
       へ委譲し、キュー内の未完了保存が完了するのを待機する。
     - クローズ開始後の新規保存要求は拒否される。
     - アクティブなバッチ内部からの `close()` は明示的に reject される。
- **非保証**:
  - **通常保存時の ACID トランザクション**: 通常の個別 mutation
    はキューで直列化されるが、ファイルへの直接書き込み（direct
    write）であり、書き込み失敗時の自動ロールバックは複合操作（`importWorkBundles`
    等）を除き提供しない（変更後のインメモリ状態が保持される）。トランザクション境界とアトミック性が必要な場合は
    `batch()` を使用する。

### 4.3 MemoryGraphStore（参照・インメモリ backend）

- **保証**:
  1. **高速性・I/O フリー**: 全状態がメモリ上の配列/オブジェクトとして保持され、ファイル I/O や DB
     コールが発生しない。
  2. **ドメイン不変条件の厳格な検証**: Revision の DAG
     不変条件（循環参照・存在しない親・多重親など）、WorkBundle
     の一意性、関係型定義の正当性などをメモリ上で即座に検証・拒否する。
  3. **`batch()` の直列化と例外耐性**: `OutlineBatch` は独立したバッチをキューで直列化し、
     ネストした呼び出しだけを同じ非同期文脈へ参加させる。同期 throw・非同期 reject で全状態を
     ロールバックする。`graph_batch_isolation_test.ts` が並行要求と復元を検証する。
- **非保証**:
  - **永続性（Durability）**: プロセス終了時にデータは消失する。
  - **個別 mutation の排他**: バッチ以外の直接 mutation は永続化層のようなキューへは載らない。

### 4.4 RPC 境界の入力検証契約 (C03)

- **保証**:
  - デスクトップ RPC エントリポイント（`src/desktop/register_bindings.ts`）において、Valibot
    スキーマを用いて外部入力を厳格に検証する。
  - `setCollapsedBatch` RPC では、空でない文字列 ID の配列と真偽値フラグを検証する。 `IdSchema` は
    UUID 形式を要求せず、`occ-1` 等も有効とする。不正な型や空文字列は
    ドメイン層やストレージ層へ到達する前に拒否する。既存の `register_bindings_test.ts` が C03
    を検証する。

---

## 5. リファクタリング次ステップへの接続

- **S1（Memory state container）**: 現在 `MemoryGraphStore` に `protected` 配列として散在している 17
  個のフィールドを独立した `MemoryStateContainer` へ集約する。これにより、`JsonGraphStore`
  が基底クラスの内部プロパティを直接参照・退避（`this.works = before.works`
  等）している不整合を解消し、統一されたスナップショット / ロールバック境界を提供する。
- **S2（Feature 操作の内部抽出）**: `MemoryGraphStore` に集中している 37
  個の操作から、変更理由ごとに Work、Branch、Occurrence、Relation、Discovery
  の操作ロジックを抽出・整理する。
- **S3（JSON codec / version guard）**: `JsonGraphStore.initialize()` および `JsonBackupService`
  に重複している V0〜V8 のバージョン判定・マイグレーション・検証ロジックを pure な codec
  モジュールとして I/O から分離する。
