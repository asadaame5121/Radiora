# ADR 0003: 編集セッションの Undo/Redo に Loro を限定導入する

## ステータス

Proposed（このブランチのレビューで確定し、main 反映時に Accepted へ更新する）

この文書と設計メモ・実験結果レポートの base は `origin/main` `8dc2eb8`（ブランチ
`docs/loro-edit-session`）。実行コードは main に置かず、PoC ブランチ `poc/loro-undo`
（commit `7cd6826` / `44118b8`）にだけ置く。

## 日付

2026-10-16

## コンテキスト

Radiora v2 には、いまエディタの「元に戻す／やり直す」が無い。`src` に undo/redo
の実装は存在せず（`grep undo|redo` が production で 0 件）、textarea の標準 undo が本文入力に効く
だけで、項目の追加・移動・削除のような構造操作には取り消し手段が無い。

一方で、**永続する履歴**の担当はすでに決まっている。

- `product-direction.md` §4.2 は Revision を「ある時点で成立した、変更不能な本文の版」とし、
  確定後の本文を変更しない（[product-direction](../design/product-direction.md) 123 行）。
- §4.3 は Recovery Snapshot を「クラッシュ、誤編集、Undo のための細粒度履歴」とし、Revision と
  分離する。作成条件（編集停止 10 秒、同一 Working Copy で最短 1 分、内容不変なら作らない、
  破壊的操作・Import・migration・restore の直前は必ず作る）、間引き、保護、Revision への昇格まで
  決まっている（同 144 行）。実装は `src/services/snapshot_policy.ts:3` の
  `SNAPSHOT_EDIT_IDLE_MS = 10_000` と `shouldCreate`、`src/services/recovery_snapshot_service.ts`
  の restore（復元直前に現在状態を snapshot として保存し、履歴を巻き戻さない）、
  `sqlite_schema.ts:8` の `recovery_snapshot` テーブルまで存在する。
- §4.5 は Working Copy を自動保存の対象とし、Revision は利用者が「版として残す」を実行した場合
  だけ作ると定める（同 215 行）。現行実装の書込経路は
  `EditorController.updateLocalText`（`src/ui/editor_controller.svelte.ts:70`）→ live state 更新 →
  `WorkingCopyAutosaveCoordinator`（`src/services/working_copy_autosave.ts:54`、既定 250 ms）→
  `api.updateItemText`（`src/services/occurrence_operations.ts:125`、実体は
  `updateBranchWorkingCopy`。pinned 配置は読み取り専用として拒否する）→ branch の Working Copy、
  である。
- 既存の Revision 契約は既にこの分担を明文化している。`RevisionService` の宣言は
  「Explicit, append-only creation of a Revision from a Branch's current Working Copy. Saving a
  Working Copy, creating a Recovery Snapshot, and restoring a Snapshot must not call this
  service.」であり、永続化の変更は `createRevision` だけである
  （`src/services/revision_service.ts:23`）。現行 main で Revision を作れる実行時経路は
  `promoteRecoverySnapshot`（復旧スナップショットの昇格）と `rewriteAsNewBranch`
  （未確定の Working Copy を checkpoint してから分岐）だけで、`createCheckpoint` 単体は
  RPC（`src/shared/bindings.ts:109`〜`135`）に露出していない。
- §9.6 はリアルタイム共同編集を実装フェーズに含めない（同 766 行）。

つまり欠けているのは **セッション内の直前操作を取り消す層**であり、これは §4.3 の Recovery
Snapshot では代替できない。Snapshot は秒〜分単位で DB を往復し、復元は「新しい現在状態の適用」で
あって、redo も打鍵単位の粒度も持たない。Ctrl+Z の期待に応える層が別に要る。

本 ADR は、その層の実装手段として CRDT ライブラリ Loro（`loro-crdt`、MIT）の組み込み
`UndoManager` を採るかどうかを決める。判断材料として、製品コード非侵入の PoC
（実行コードは `poc/loro-undo` ブランチ、実測は
[実験結果レポート](../loro-undo-experiment-2026-10-16.md)）で次を実測した。

- ツリー構造（追加・移動・削除）とテキスト編集の両方が、1 操作 = 1 ステップで undo/redo できる。
  複合操作は `groupStart/groupEnd` で 1 ステップにまとまり、undo ラベルも付く。
- undo はローカルで、他ピアの変更を巻き戻さず、両者は収束する。`excludeOriginPrefixes` で
  正規化などの内部変更を undo 対象外にできる。
- **削除の undo は「復元」ではなく「再作成」**で、TreeID は新しい値になる（アプリ側 ID は不変）。
  並行する他ピアの編集はそのノードでは併合されない。
- undo スタックはスナップショットに含まれない（復元後の `canUndo` は false）。素の `checkout` は
  undo/redo スタックを破棄するため、履歴プレビューは `pause/resume` で包む必要がある。
- 実ブラウザ（Vite dev / production）で undo/redo が動作する。ただし dev には 2 設定が必要
  （`resolve.conditions` から `development` を外す、`optimizeDeps.exclude`）、production entry は
  同期 XHR で wasm を読む。ビルド出力は wasm 3,398.78 kB（gzip 1,130.46 kB）+ JS 95.68 kB。

## 比較と決定

| 候補                                   | 今回の用途との適合                                                                                                                                     | 判断                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 既存 Recovery Snapshot の復元のみ      | 秒〜分単位、DB 往復、redo なし。打鍵・操作単位の取り消しには粒度が合わない。既に永続履歴の担当として存在する                                           | 採用しない（担当は維持）   |
| 独自コマンドスタック                   | 依存を増やさず必要な操作だけ逆操作を書ける。ただし構造操作の種類分だけ逆操作・選択復元・統合・ラベルを自作し、feature 追加ごとに保守が増える            | 採用しない（比較対象）     |
| Loro を文書の正本として導入            | undo は最も自然に成立するが、Revision / Recovery Snapshot / Occurrence / schema / RPC の正本を移す大規模移行になり、§9.6 の範囲外の同期機能まで抱える | 今回は採用しない           |
| Loro を編集セッションの live state に限定導入 | 正本は DB のまま。undo/redo・グループ化・ラベル・他ペイン変更の除外をライブラリから得る。コストは wasm ペイロード、Vite 設定、セッション境界の設計 | **採用**              |

## 決定事項

1. **Loro は `loro-crdt` を厳密固定で導入し、編集セッションの live state の内部表現としてのみ
   使う。** 保存済みデータの正本は従来どおり backend / storage（SQLite）であり、
   Revision・Recovery Snapshot・Branch・Occurrence・link の意味論と保存先は変更しない。
   Loro doc は §4.5 の Working Copy を編集中の live state の実装詳細であって、DB の代替ではない。
2. **役割分担を固定する。** セッション内の直前操作（Ctrl+Z）は Loro、時間をおいた誤編集・
   クラッシュ復帰は Recovery Snapshot、確定した版は Revision。細粒度の取り消しを Revision や
   Snapshot の生成に流用しない。既存の `RevisionService` の宣言
   （「Saving a Working Copy, creating a Recovery Snapshot, and restoring a Snapshot must not
   call this service.」`src/services/revision_service.ts:23`）と同じ方向を保ち、Loro の undo からも
   `createRevision` を呼ばない。
3. **undo は「新しい現在状態の適用」として扱う。** 過去の内容を新しい現在状態として書き込み、
   完了済みの DB 書込を巻き戻さない（`product-direction.md` §4.3 の復元と同じ思想、
   `ui-state-ownership.md` の「DBへの完了済み書込はUI要求の失効で巻き戻さない」とも整合）。
4. **undo 対象は自分のセッションの操作だけ。** 他ペイン・他ウィンドウ・API 経由で入った変更は
   除外し、undo で巻き戻さない（PoC F5）。
5. **Loro の識別子を永続化しない。** TreeID / op ID を DB や RPC に載せず、`workId` /
   `branchId` / `itemId` / `occurrenceId` で同定する。undo 後のハンドルをキャッシュしない（PoC F6）。
6. **削除 undo の意味論を契約に含める。** 削除の undo は削除前のローカル内容で再作成し、
   同じ項目への他者編集は併合されない。UI は取り消し後にその旨を告知できる形にする（PoC F7）。
7. **undo スタックはセッション内のみ。** 再起動・復元・Branch 切替をまたいだ undo は約束しない。
   永続履歴が必要な場合は既存の Snapshot / Revision を使う（PoC F10）。
8. **共同編集・複数端末同期は対象外。** §9.6 の範囲を広げない。Loro の同期機能は使わず、
   セッション内の undo/redo と構造差分に用途を限定する。
9. **依存は feature-specific port の背後に閉じる。** `loro-crdt` を `domain` / `storage` /
   `bindings` / View から直接 import しない。セッションの生成・投影・解放は 1 つの Controller が
   所有し、undo の公開操作はその Controller の port にだけ置く。
10. **Commit と投影の境界を既存の保存境界に合わせる。** 構造操作は操作ごとに 1 commit、本文入力は
    既存の autosave 境界（既定 250 ms）と `mergeInterval` に従い、投影は既存の API
    （`updateItemText` 等）を通す。投影の失敗は dirty として保持し、retry する。

## 結果と影響

得るもの:

- 構造操作と本文入力の取り消しを、逆操作の自作なしに一貫した粒度で提供できる。
- undo のラベル（「項目を移動」等）をライブラリのメタデータから得られ、command / 語彙と接続できる。
- 他ペイン変更の除外・グループ化・段数制限が、既存の要求世代・失効の規約と同じ語彙で説明できる。

支払うもの:

- wasm 3.24 MiB（gzip 1.08 MiB）が配布物に加わる。CI に bundle size の gate は無いので、
  採用時は build 出力の記録を残す仕組みを別途追加する。
- Vite dev に 2 設定が必要。production entry は同期 XHR で wasm を読むため、Worker 利用と
  デスクトップ（CEF/Tauri）のカスタムプロトコル配信は実測確認が要る。
- セッション live state と DB 投影の二重管理が生じる。単一 writer、投影順序、再構築条件を
  設計メモで固定し、逸脱を検出できるようにする。

## 段階導入の計画

1. **Phase 1（本文と構造の undo/redo）**: 1 つの編集セッション（選択中 Work / Branch）に対象を
   絞り、`undo` / `redo` / `canUndo` / `canRedo` / ラベルを port として公開する。DB 書込経路は
   変えず、投影は既存 API を呼ぶ。他ペイン変更の除外と、境界イベントでの再構築を実装する。
2. **Phase 2（粒度と選択の回復）**: 入力の統合粒度、`transaction` による複合操作の 1 ステップ化、
   caret / 選択の回復（`onPush` の cursors）を詰める。必要になった時点で Working Copy の保存形式
   （`text` 文字列）を Loro スナップショットへ置き換えるかを `schema-evolution.md` の手続きで判断する。
3. **Phase 3（見直し）**: 端末間同期やオフラインファーストが製品要件になった時点で、文書の正本を
   Loro へ移すかを別 ADR で判断する。本 ADR はその時点で supersede される。

拡大は操作境界ごとの別 PR で行い、Phase 1 の完了条件は設計メモ
（[loro-edit-session](../design/loro-edit-session.md)）に置く。

## 参考

- 実験結果レポート:
  [Loro（loro-crdt）の UndoManager でアウトライン Undo/Redo を作る実験（2026-10-16）](../loro-undo-experiment-2026-10-16.md)
  （実測 F1〜F15。実行コードは main に置かず、`poc/loro-undo` ブランチ commit `7cd6826` /
  `44118b8`。採用時に `vitest/**` か `src/**/*_test.ts` へ移す）
- 設計: [編集セッションの Loro 導入契約](../design/loro-edit-session.md)
- 製品仕様: [product-direction](../design/product-direction.md) §4.2 / §4.3 / §4.5 / §9.6
- 所有契約: [UI state ownership](../design/ui-state-ownership.md)、
  [storage-persistence-contracts](../design/storage-persistence-contracts.md)
- [Loro docs](https://loro.dev) / [loro-crdt (npm)](https://www.npmjs.com/package/loro-crdt) /
  [loro-dev/loro](https://github.com/loro-dev/loro)
- [Vite: WebAssembly](https://vite.dev/guide/features.html#webassembly)
