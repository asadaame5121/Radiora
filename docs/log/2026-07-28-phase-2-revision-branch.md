# Phase 2 版・別稿・復旧履歴

- 実施日: 2026-07-28
- storage schema: `1 -> 2`
- backup schema: `1 -> 2`
- 対象Issue: `#25`, `#26`–`#37`

## 実装した境界

- Branchごとに独立したWorking Copyを持ち、通常保存と自動保存ではRevisionを作らない
- Revisionは変更不能で、既存の同一Work Revisionだけを親にできるDAGとして保存する
- 明示的な版保存、確認済みの全面改稿、Branchの切替・保管・main化・独立Work化を
  service境界で分離する
- 手動の混成稿は2件以上の確定Revisionを親にし、親本文を自動結合しない
- Recovery Snapshotの生成・保持判断を差し替え可能なpolicyへ分離する
- Snapshot復元では現在のWorking Copyを先に保存し、履歴やBranch headを巻き戻さずに
  過去本文をWorking Copyへ再適用する
- Snapshotの版への昇格では、元Snapshotを保護し、Revision作成とBranch head更新を
  Store境界で不可分にする
- 全体系統はWorkと意味リンクを中心にし、明示昇格済みBranchと確定済み先端版だけを補助表示する
- Work内版系統は、そのWorkのRevision、Branch、merge親だけを表示する
- Revision本文の行単位Diffを共通化し、任意2版とSnapshot復元前プレビューで使用する

## 永続化と互換性

storage version 2では、version 1のWork、Branch、Working Copy、Occurrence、意味リンクを保持したまま、
RevisionとRecovery Snapshotを追加する。JSON backup envelopeもversion 2へ移行し、version 1入力は
内容を失わずに展開する。

Snapshot復元と版への昇格はMemory、JSON、SurrealDBで共通契約にする。JSONは永続化失敗時に
メモリ状態を戻し、SurrealDBはtransaction内で関連書き込みを行う。完全消去ではRevisionと
Snapshot本文を削除し、影響manifestにはIDと件数だけを残す。

## 現行PoCで到達できる操作

通常アプリでは、選択した思索から全体系統、版系統、任意2版の比較、既存Snapshotの差分確認、
復元、版への昇格へ到達できる。

版保存、Branch lifecycle、手動merge、独立Work化、自動Snapshot生成・間引きはservice／policyと
自動テストまで実装している。現行UIにはこれらの操作導線をまだ接続していないため、
利用可能な画面操作としては扱わない。

## 検証

- 明示保存以外の通常保存、autosave、Snapshot作成・復元がRevisionを作らないこと
- 全面改稿のキャンセルがRevision、Branch、Working Copyを作らないこと
- Branchのdirty／archive／headなし状態をmain化・独立Work化しないこと
- 手動mergeが親順と手編集本文を保ち、無効な親を永続化前に拒否すること
- Snapshotの保持境界、保護、復元前保存、版昇格、Store間の共通契約
- 日本語、空行、末尾改行を含む決定的な行単位Diff
- 通常Revisionや他Workを全体系統・Work内版系統へ混在させないこと

## 既知の制約

- Revision単独の重要度属性はまだなく、全体系統の重要版は昇格済みBranchの確定headとして表示する
- 行単位DiffはLCSを使うため、非常に長い本文では時間・メモリ使用量が二次的に増える
- SurrealDBの復元・昇格はtransaction query契約まで検証し、実DBを使った統合試験は未実施
- Snapshot自動生成・間引きpolicyはruntimeへ未接続

