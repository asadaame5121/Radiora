---
title: Radiora sync storage schema boundary
date: 2026-08-10
status: proposed
tags:
  - radiora
  - design
  - schema
  - sync
---

# Radiora sync storage schema boundary

## 1. 結論

DomainOperation同期をRadioraへ組み込む段階ではDB schema変更が必要になる。ただし、Labで使った
master用tableをそのままdesktopのローカルDBへ追加してはならない。同期では少なくとも次の三つの
永続化境界を分ける。

1. 既存の`work`、`branch`、`working_copy`、`occurrence`などのdomain projection
2. 各deviceが所有するlocal sync state
3. masterだけが所有する判定結果とaccepted operation log

既存domain tableは最初のvertical sliceで直ちに作り替えず、同期operationを適用した結果の
projectionとして使う。最初に増えるのはlocal/masterの同期状態であり、Work全体へ同期用version fieldを
足す設計にはしない。

## 2. Versionを混同しない

同期導入後は、既存のstorage/backup versionに加えて次を区別する。

| Version                  | 所有者                   | 意味                                                              |
| ------------------------ | ------------------------ | ----------------------------------------------------------------- |
| storage schema version   | desktop local DB         | domain projectionとlocal sync stateの物理schema                   |
| backup schema version    | JSON backup              | 利用者がexport/restoreするdomain dataの形式                       |
| master schema version    | sync service             | receipt、device progress、scope version、accepted logの物理schema |
| operation schema version | DomainOperation wire形式 | operation kindごとのpayloadと意味                                 |
| sync protocol version    | client/server handshake  | push/pull、receipt、checkpointの通信契約                          |

`operationSchemaVersion`をRadiora DBのmigration判断に流用しない。またmaster schema versionを
desktopの`schema_metadata:radiora`へ記録しない。masterには独立したmetadataとmigration列を持たせる。

## 3. Local DBで必要になる構造

最小のlocal sync stateは次の責務を持つ。

| Logical table          | 主な内容                                    | 不変条件                                       |
| ---------------------- | ------------------------------------------- | ---------------------------------------------- |
| `sync_device`          | device ID、次に採番するdevice sequence      | device IDはbackup/cloneで複製しない            |
| `sync_outbox`          | 未確定のDomainOperation、payload hash、状態 | `(device_id, device_sequence)`と`op_id`は一意  |
| `sync_receipt`         | accepted/rejectedの最終判定                 | rejectも判定済みとして保持する                 |
| `sync_pull_checkpoint` | `last_applied_server_sequence`              | accepted logをprojectionへ反映した後だけ進める |

outboxから削除できる条件はfinal receiptをlocal transactionで保存できた場合だけとする。通信失敗や
retryable failureでは残す。reject receiptはoutboxを完了させるが、projectionへoperationを適用しない。

pullでは「projection更新」と`last_applied_server_sequence`更新を同一transactionに置く。途中で失敗した
場合はどちらも確定せず、同じaccepted operationを再取得できるようにする。

楽観的UIを採る場合でも、永続projectionへ先に書いて後から巻き戻す設計を既定にしない。まずoutboxを
overlayとして表示へ合成し、accepted pull後にcanonical projectionへ反映する。永続的なoptimistic
projectionが必要になった時だけ、replay baseや適用済みoperation集合を追加設計する。

## 4. Master DBで必要になる構造

master側には少なくとも次が必要になる。

| Logical table             | 主な内容                              | 不変条件                                             |
| ------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `sync_device_progress`    | `last_processed_device_sequence`      | rejectでも進む。gapや未確定errorでは進まない         |
| `sync_scope_version`      | `(scope_type, scope_id)`ごとのversion | operationの全preconditionを一transactionで検査・更新 |
| `sync_operation_receipt`  | op ID、payload hash、final result     | 同じop IDの異なるpayloadを拒否する                   |
| `sync_accepted_operation` | server sequenceとoperation envelope   | acceptedだけを追記し、server sequenceは単調増加      |

domain reducerによるprojection更新、scope version更新、accepted log、receipt、device
progressは一つの master transactionで確定する。rejected operationはreceiptとdevice
progressだけを確定し、server sequenceを発行せずaccepted logへ入れない。

`serverSequence`は順序を表すが連続性を要求しない。sequence allocatorがrollback不能な場合に生じる
gapをpull欠損と誤認しない。

## 5. 既存schemaへの影響

Labの`workingCopy.updateText`と`occurrence.move`は、現行の`working_copy`と`occurrence`をprojection
として利用できる。この段階ではdomain tableへaggregate versionを埋め込まない。競合単位は独立した
`sync_scope_version`で表し、次のようにoperationごとに選ぶ。

- 本文更新: `working-copy:<branchId>`と`occurrence-selector:<occurrenceId>`
- 配置移動: target/parent occurrenceとsource/destination sibling container

これにより同じWorkの別Branch本文や本文と配置を不要に競合させずに済む。一方、scopeを細かくした結果
壊れ得るdomain invariantはmaster reducerのvalidationで拒否する。

## 6. Migration方針

同期実装をRadiora本体へ入れる最初の変更は、次の順序で行う。

1. operation/protocol contractとlocal/master portsを確定する
2. local sync stateだけを追加する一段のstorage migrationを作る
3. master schemaを別packageまたはserviceの独立migrationとして作る
4. existing version fixtureから、同期tableが空の状態へ移行できることを検証する
5. 新規device IDを生成し、既存domain projectionを初回同期するbootstrap方式を検証する
6. その後に最初のRadiora operation familyを有効化する

現在のstorage schema versionは`6`なので、local sync stateを本体へ導入するmigrationは`6 -> 7`の
候補になる。ただし本書の追加だけではversionを上げない。物理tableを追加する実装PRでversion、fixture、
validationを同時に更新する。

sync stateは端末固有・再構築可能な運用metadataなので、通常のJSON backupへ含めない。このためlocal
sync tableだけの追加ではbackup schema versionを上げない。domain dataの形式や意味も変える場合に限り、
対応するbackup migrationを別途追加する。

## 7. 実装前に決める必要がある点

- masterをローカルSurrealDBとは別の常設serviceとして運用するか
- 初回接続時に既存projectionをoperationへ変換するか、server snapshotとしてbootstrapするか
- server logの保持期間と、古いcheckpointを持つdeviceへのsnapshot再配布方法
- device identityの再発行、端末clone、sign-out時の扱い
- operation schema/protocolの互換範囲と、古いclientを拒否するhandshake
- server側backup、restore、監査、個人データ削除時にaccepted logをどう扱うか

特にbootstrapとlog compactionを決めずにoutboxだけを実装すると、新規deviceの完全同期と長期離脱端末の
復帰が定義できない。`outline.createItem`の次へ進む前に、この二点をacceptance scenarioへ追加する。
