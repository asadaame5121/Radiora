---
title: Phase 0 現行PoC基準
date: 2026-07-27
status: accepted
tags:
  - radiora
  - schema
  - migration
---

# Phase 0 現行PoC基準

## 現行形式

現行SurrealDBとenvelopeのないJSONをschema version `0`として固定する。version `0`は
互換入力であり、Work / Occurrenceを導入する最初の正式形式をversion `1`とする。

基準fixtureは次の二つである。

- `tests/fixtures/storage-v0.surql`: SurrealDB schemaと代表データ
- `tests/fixtures/backup-v0.json`: envelopeのないJSON

両fixtureは同じ五項目と一つの意味リンクを持ち、日本語、改行、Markdown、
`radiora://`内部参照、時刻、折りたたみ、別名、保存済みクエリに加え、親が存在しない
孤児一件と相互参照する循環二件を含む。

## 現行DBの棚卸し

`SurrealGraphStore.initialize()`がversion `0`のtable、field、relation、indexを
`DEFINE ... IF NOT EXISTS`で用意する。永続データは次に分かれる。

| 種類               | SurrealDB                                 | JSON                |
| ------------------ | ----------------------------------------- | ------------------- |
| 本文と配置         | `outline_item`、`evolved_from`            | `items[].parentId`  |
| 意味リンク         | `liked`、`fixed`、`conflicted`、`in_knot` | `links`             |
| 循環隔離           | `knot`                                    | `knots`             |
| 検索別名           | `search_alias`                            | `aliases`           |
| 発見フィードバック | `emergence_feedback`                      | `emergenceFeedback` |
| 保存済みクエリ     | `saved_rule_query`                        | `savedRuleQueries`  |

Phase 0で`schema_metadata`と`migration_journal`の定義を追加するが、version `0`では metadata
recordを作らない。metadataがないDBはversion `0`として検出する。

## `OutlineItem.parentId`利用箇所

`parentId`は現在、配置と系譜を兼ねている。

- Domain / API: `src/domain/models.ts`
- Store契約と実装: `src/storage/graph_store.ts`、`memory_store.ts`、`json_store.ts`、
  `surreal_store.ts`
- 作成、移動、削除時の子昇格、祖先探索: `src/services/outline_service.ts`
- Queryの`parent` / `ancestor`: `src/services/rule_query.ts`
- Outlineのflatten、indent / outdent、drag and drop: `src/ui/App.svelte`
- Treeのlane、接続、選択近傍: `src/ui/tree_layout.ts`
- mock、probe、integration、unit test: `scripts/`、`src/**/*_test.ts`、`tests/`

Phase 1ではこれらをOccurrenceの配置参照とWorkの系譜参照へ一括で分離する。途中状態で
`parentId`を意味上の`FROM`へ複製しない。

## `FROM`方向の不変条件

version `0`では、親を起点、子を終点として保存・描画する。

```text
parent (SurrealDB in) -> evolved_from -> child (SurrealDB out)
parent (drawing source)             -> child (drawing target)
```

読み込みは子からincoming `evolved_from`を辿って親を得る。Phase 1でWork間の`FROM`へ
変換するときも正準方向を変えない。

## Migrationとロールバック

起動時は[[schema-evolution]]の手順に従い、一段ずつ`up`と`validate`を実行する。
versionを先に進めず、検証成功後だけ`schema_metadata`を更新する。開始、成功、失敗は
`migration_journal`へ記録する。

自動downgradeは実装しない。version `0 -> 1`の前にSurrealDBのDBディレクトリを 停止中に一度だけcold
backupし、失敗時はアプリとSurrealDBを停止してからそのバックアップを
丸ごと復元する。途中状態のDBは一意な`.migration-failed-*`パスへ退避し、診断に使用できる。
復元後はversion markerを削除し、次回起動で同じmigrationを最初から再実行する。

JSON importは入力を`.v0.bak`へ保護し、変換・検証成功後だけversion 1 envelopeを反映する。
復元完了までは移行後DBを通常storeとして公開しない。
