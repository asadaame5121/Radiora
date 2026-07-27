# Phase 1 実身・化身と関係分離

- 実施日: 2026-07-27
- storage schema: `0 -> 1`
- backup schema: `0 -> 1`

## 実装した境界

- `Work`が同一性とsoft delete状態を持つ
- 最小の`main Branch`と`WorkingCopy`が本文を持つ
- `Occurrence`が親子、順序、折りたたみ、Revision selector、`contextualHeading`を持つ
- 同じWorkを複数Occurrenceへ配置しても本文は一つのWorking Copyを共有する
- 意味リンクをWork／Revision端点の`semantic_link`へ移した
- `IN`を意味リンクから外し、`system_relation`へ移した
- `RELATED`、`FROM`、`LIKE`、`SUPPORT`、`VS`、`FIX`、`CITE`と
  `provisional`、`asserted`、`retracted`を導入した
- 化身削除、実身のゴミ箱、完全消去を別操作にした

Phase 2で複数Branch、Revision確定、Recovery Snapshotを追加する。Phase 1では本文をWorkへ
一時保存せず、`main` BranchのWorking Copyを先行導入した。

## version 0からの対応

各`outline_item`のIDを、tableで名前空間が分かれることを利用してWork、main Branch、
Working Copy、Occurrenceへ引き継ぐ。これにより内部参照と時刻を保ち、migration再実行時にも
同じ対象へ到達できる。

| version 0 | version 1 |
| --- | --- |
| `outline_item.text` | `working_copy.text` |
| `outline_item`の作成・更新時刻 | `work.created_at` / `updated_at` |
| `evolved_from` | `occurrence.parent_occurrence` |
| `liked` / `fixed` / `conflicted` | `semantic_link` |
| `in_knot` | `system_relation` |

`evolved_from`は配置としてだけ移し、意味上の`FROM`へ複製しない。既存意味リンクは
Work端点、`asserted`、`import`として移す。旧tableはPhase 1では削除せず、Expand / Migrate
状態を維持する。

## 保護と復旧

SurrealDBを起動する前に、version 1のsidecar markerがなく既存DBがある場合は、停止状態の
`main.db`を`migration-backups/storage-v0`へ一度だけコピーする。migrationと検証が完了した後に
markerを記録する。

JSON version 0を開く場合は、同じ場所へ`.v0.bak`を一度だけ保存してからversion 1 envelopeを
書き込む。移行失敗時は新DBを通常storeとして公開しない。

ロールバックではアプリとSurrealDBを停止し、`main.db`を保護コピーへ戻して
`storage-schema-version` markerを削除する。自動downgradeは行わない。

## 検証

- version 0のSurrealDB fixtureを実DBへ投入してmigration、再接続、CRUD、検索を確認
- version 0 JSONの日本語、改行、Markdown、`radiora://`、時刻、リンクを確認
- 共有本文、独立した子構造、移動と`FROM`の分離、循環・孤児のStash隔離を確認
- 化身削除、ゴミ箱、復元、完全消去後のID-only manifestを確認
- 保存方向`New FROM Old`とTree描画方向`Old -> New`を別々に確認
