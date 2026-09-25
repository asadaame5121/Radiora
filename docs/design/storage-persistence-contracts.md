---
title: Radiora 永続化契約・保存復元対応表
date: 2026-09-25
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

| 操作分類          | メソッド名                     | Memory 挙動                    | SQLite 挙動                                            | JSON 挙動                                                       | 主な検証テスト                                                 |
| :---------------- | :----------------------------- | :----------------------------- | :----------------------------------------------------- | :-------------------------------------------------------------- | :------------------------------------------------------------- |
| **Work Bundle**   | `createWorkBundle`             | 同期インメモリ追加             | `mutate()`: queue 直列化, 差分保存, エラー時メモリ復元 | `super` 実行後 `persist()` 全体書き出し                         | `graph_store_contract_test.ts`                                 |
|                   | `importWorkBundles`            | 一括検証後に追加               | `mutate()`                                             | `captureAllState()` で退避、失敗時 `restoreAllState()`          | `work_bundle_import_test.ts`                                   |
|                   | `createUnplacedWork`           | 未配置 Work/Branch/Copy 追加   | `mutate()`                                             | 退避後 `persist()`、失敗時 rollback                             | `unplaced_inbox_ui_contract_test.ts`                           |
|                   | `resolveWorkStub`              | stub 属性解除と更新日反映      | `mutate()`                                             | `super` 実行後 `persist()`                                      | `stub_ui_contract_test.ts`                                     |
|                   | `mergeWorks`                   | 分岐統合、リンク・配置の書換   | `mutate()`                                             | `captureAllState()` で退避、失敗時 rollback                     | `memory_store_operations_test.ts`                              |
|                   | `setWorkHistoricalTime`        | 歴史年代の付与/解除            | `mutate()`                                             | `captureAllState()` で退避、失敗時 rollback                     | `sqlite_store_contract_test.ts`                                |
| **Branch / Copy** | `createBranch`                 | Branch / Copy 追加             | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `updateBranch`                 | headRevisionId / name 更新     | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `updateBranchWorkingCopy`      | 本文 / updatedAt 更新          | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `updateWorkingCopy`            | main 本文更新                  | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
| **Revision**      | `createRevision`               | DAG 不変条件検証後に追加       | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
| **Recovery**      | `createRecoverySnapshot`       | snapshot 追加                  | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `applyRecoverySnapshot`        | Working Copy へ復元            | `mutate()`                                             | `captureRecoveryMutationState()` で退避、失敗時 rollback        | `graph_store_contract_test.ts`                                 |
|                   | `restoreRecoverySnapshot`      | 退避 snapshot 作成の上で復元   | `mutate()`                                             | `captureRecoveryMutationState()` で退避、失敗時 rollback        | `graph_store_contract_test.ts`                                 |
|                   | `promoteRecoverySnapshot`      | snapshot を Revision へ昇格    | `mutate()`                                             | `captureRecoveryMutationState()` で退避、失敗時 rollback        | `graph_store_contract_test.ts`                                 |
| **Trash / Purge** | `trashWork`                    | `deletedAt` 設定               | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `restoreWork`                  | `deletedAt = null`             | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `purgeWork`                    | 関連全実体削除 & manifest 生成 | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
| **Occurrence**    | `createOccurrence`             | 配置レコード追加               | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `updateOccurrence`             | 順序・折畳・見出し等更新       | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `deleteOccurrence`             | 配置レコード削除               | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
| **Bookmark**      | `createBookmark`               | 栞レコード追加                 | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `deleteBookmark`               | 栞レコード削除                 | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
| **Resume**        | `setResumePosition`            | 単一再開位置更新               | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `clearResumePosition`          | 再開位置 null 設定             | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
| **Relation**      | `createLink`                   | 意味リンク追加                 | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `deleteLink`                   | 意味リンク削除                 | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `replaceKnots`                 | 循環 Knot 一括置換             | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
| **Discovery**     | `upsertAlias`                  | 検索別名追加/更新              | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `deleteAlias`                  | 検索別名削除                   | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `setEmergenceFeedback`         | フィードバック記録             | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `upsertEmergenceSuggestion`    | 提案レコード追加/更新          | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `resolveEmergenceSuggestion`   | 提案状態遷移・リンク生成       | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `upsertSavedRuleQuery`         | 保存クエリ追加/更新            | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
|                   | `deleteSavedRuleQuery`         | 保存クエリ削除                 | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
| **Relation Type** | `createRelationTypeDefinition` | カスタム関係型追加             | `mutate()`                                             | `super` 実行後 `persist()`                                      | `graph_store_contract_test.ts`                                 |
| **Restore**       | `restoreGraphState`            | 全状態のスナップショット置換   | `mutate()` (差分計算しテーブルへ一括反映)              | 一時ファイル `.tmp` 出力 → アトミック `rename`、失敗時 `remove` | `json_backup_restore_test.ts`, `sqlite_store_contract_test.ts` |

---

## 4. バックエンドごとの保証と非保証 (Guarantees & Non-guarantees)

### 4.1 SqliteGraphStore（現行本番 backend）

- **保証**:
  1. **直列化キュー (`mutationQueue`)**: すべての非同期 mutation は内部キューにより 1
     つずつ順序通りに実行される。
  2. **ACID トランザクション**: `persistSqliteDiff` は単一の SQLite
     トランザクション内で実行され、成功時のみコミットされる。
  3. **自動ロールバック**: DB 書き込みが失敗した場合、`mutate()` の catch 節で直ちに直前の `before`
     スナップショットへ `super.restoreGraphState(before)` を適用してインメモリ状態を巻き戻す。
  4. **クローズ待機**: `close()` 呼び出し時はキュー内の先行 mutation がすべて完了するのを待機し、WAL
     チェックポイント（`TRUNCATE`）および `journal_mode = DELETE` を実行して安全にファイルを閉じる。
- **非保証**:
  - 外部プロセスによる同一 SQLite
    ファイルへの同時排他制御（単一デスクトップアプリインスタンスによる専有利用を前提とする）。

### 4.2 JsonGraphStore（バックアップ・可搬用 / 旧ローカル backend）

- **保証**:
  1. **完全スナップショット出力**: 各 mutation 成功後にメモリ内の全状態をフォーマット V8 の JSON
     ファイルとして同期出力する。
  2. **アトミック復元 (`restoreGraphState`)**: 復元時は直接ファイルを上書きせず、一意な UUID
     を付与した一時ファイル（`${path}.restore-${uuid}.tmp`）へ完全に書き出してから、ファイルシステムの
     `rename` 操作でアトミックに置換する。失敗時は一時ファイルを削除し、メモリ状態を `before`
     へ戻す。
  3. **部分ロールバック**:
     `importWorkBundles`、`mergeWorks`、`createUnplacedWork`、`setWorkHistoricalTime`
     などの複合操作では、実行前に状態を capture し、失敗時に restore する。
- **非保証**:
  - **通常保存時のトランザクション/排他キュー**: 通常の `persist()`
    はファイルへの直接上書き（`Deno.writeTextFile`）であり、SQLite
    のような非同期キューや排他ロック機構を持たない。
  - **部分ロールバックの網羅性**: 軽微な
    mutation（単一レコード追加・削除など）では、ファイル書き込み失敗時にメモリ内の配列操作が完全には巻き戻されない場合がある（S1
    で `MemoryStateContainer` を導入し、全 mutation
    に対する統一的なスナップショット・ロールバック機構を確立する）。

### 4.3 MemoryGraphStore（参照・インメモリ backend）

- **保証**:
  1. **高速性・I/O フリー**: 全状態がメモリ上の配列/オブジェクトとして保持され、ファイル I/O や DB
     コールが発生しない。
  2. **ドメイン不変条件の厳格な検証**: Revision の DAG
     不変条件（循環参照・存在しない親・多重親など）、WorkBundle
     の一意性、関係型定義の正当性などをメモリ上で即座に検証・拒否する。
- **非保証**:
  - **永続性（Durability）**: プロセス終了時にデータは消失する。

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
