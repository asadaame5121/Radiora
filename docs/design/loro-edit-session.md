# 編集セッションの Loro 導入契約

対象 ADR: [ADR 0003](../adr/0003-loro-edit-session-undo.md)。実測の根拠は
[実験結果レポート](../loro-undo-experiment-2026-10-16.md)（F1〜F15。実行コードは main に置かず、
PoC ブランチ `poc/loro-undo` commit `7cd6826` / `44118b8` にある）。

この文書は「採用した場合に何を契約として固定するか」を記録する。**未実装**であり、実装時は
この文書と [UI state ownership](ui-state-ownership.md) を同じ PR で更新する。

## 1. 範囲と非目標

範囲（Phase 1）:

- 選択中 Work / Branch の 1 編集セッションにおける、本文入力と Outline 構造操作の undo/redo。
- セッションの生成・投影・再構築・解放の条件。
- 他ペイン・API 経由の変更を undo 対象にしないこと。

非目標:

- リアルタイム共同編集、端末間同期、競合解決（`product-direction.md` §9.6 の範囲を広げない）。
- Revision / Recovery Snapshot / Branch / Occurrence / link の意味論・保存先の変更。
- 文書の正本を Loro へ移すこと（別 ADR。Phase 3 で判断）。
- 共同編集に伴う CRDT 収束を最終状態の保証として使うこと。

## 2. 用語

- **編集セッション**: 1 ペインが 1 つの Work / Branch を編集中の区間。§4.5 の Working Copy に束縛される。
- **live state**: 保存前を含む編集中の現在値。正本は保存済みデータ側にあり、live state は写しである
  （[UI所有契約](ui-state-ownership.md) の用語）。
- **投影（projection）**: live state の変化を既存 API 経由で DB へ書き込むこと。
- **再構築（rebuild）**: DB の保存済みデータから live state を作り直すこと。undo スタックを捨てる。

## 3. 状態所有表（Phase 1 で追加する行）

| 状態 / 正本 | owner | writer・公開操作 | 読み手 | 寿命 | 永続化先 | 失効条件 |
| --- | --- | --- | --- | --- | --- | --- |
| 編集セッションの live state（本文 + 構造）/ 編集中の写し | `LoroEditSession`（新規。`loro-crdt` を import する唯一の module） | `begin` / `applyText` / `insertItem` / `moveItem` / `removeItem` / `transaction` / `undo` / `redo` / `release` | MarkdownEditor、Outline live 表示、保存 status、command | App。選択中 Work / Branch に束縛し、`release` で破棄 | なし。投影は既存経路（本文は `WorkingCopyAutosaveCoordinator` へ queue、構造は既存の outline 操作 API） | `release`、Branch / Work 切替、restore / import / migration / backup 復元、他ペイン変更の検出、投影失敗の解消不能 |
| undo/redo スタック・ラベル / セッション内履歴 | `LoroEditSession` 内部の `UndoManager` | `undo` / `redo` と commit、`transaction`、`maxUndoSteps` | command、keyboard、Editor の表示（ラベル） | セッションと同じ寿命。セッションを跨がない | 保存なし（PoC F10。スナップショットにも含まれない） | セッションの `release` と再構築。新規ローカル操作で redo 側を破棄 |
| 本文 draft・save status・`editVersion` / 未保存入力（既存） | `createEditorController` + `WorkingCopyAutosaveCoordinator` | 既存の `updateLocalText` / `flushAutosave` / `flushForNavigation` / `retryAutosave` | MarkdownEditor、WorkingCopySaveStatus、reload、Workspace | App。保存成功まで draft 保持 | `updateItemText` 経由の branch working copy | 既存に同じ（新入力で version 更新。失敗・選択変更・reload で捨てない） |
| 保存済み Work / Branch / Revision / Recovery Snapshot / Occurrence / Link / backend（既存） | service / storage、UI は `api` 経由 | 既存 mutation API。transaction / rollback は storage | 各 feature の read model | 保存データの寿命 | SQLite | mutation、削除、backup 復元後に再取得 |

3 行目と 4 行目は既存の契約を再掲したもの。**Loro は 1 行目と 2 行目だけを所有し、3 行目・4 行目の
owner を置き換えない。**

## 4. 役割分担（何を戻せるか）

| 取り消したいこと | 粒度 | 担当 | 寿命 | 永続化 | 届く範囲 |
| --- | --- | --- | --- | --- | --- |
| 直前の打鍵・直前の構造操作 | 操作単位（本文は保存境界 + 統合） | Loro `UndoManager` | セッション内 | なし | その編集セッション（ペイン） |
| 数十秒〜分前の誤編集、クラッシュ復帰 | 編集停止 10 秒 / 最短 1 分 / 操作境界 | Recovery Snapshot（既存） | 7 日〜1 年（間引き・保護あり） | DB | Work / Branch（全ペイン・全端末） |
| 確定した版へ戻す | 明示操作 | Revision + 復元（既存） | 永久（不変） | DB | 系統樹 |
| 正規化・移行・復元適用などの内部変更 | — | undo 対象外（`system:*` origin） | — | — | — |

原則:

- 細粒度 undo を Revision / Recovery Snapshot の生成に流用しない（§4.2 / §4.3 / §4.5 の分担を守る）。
  これは既存契約の再確認である。`RevisionService` は
  「Saving a Working Copy, creating a Recovery Snapshot, and restoring a Snapshot must not call
  this service.」と宣言し、永続化の変更を `createRevision` だけに限っている
  （`src/services/revision_service.ts:23`）。Loro の commit / undo / redo から `createRevision` を
  呼ばない。
- undo スタックはセッション内のみ。再起動後に undo できるとは約束しない（PoC F10）。
- 永続 Undo が要るなら Recovery Snapshot の作成トリガを実装する。これは本 ADR の範囲外の
  既存ギャップであり、Loro の導入では埋まらない（`snapshot_policy.ts` の `shouldCreate` は
  実装済みだが、現行 main でこれを呼ぶ実行時経路が無い）。Revision 側も同じで、現行 main で
  Revision を作る実行時経路は `promoteRecoverySnapshot` と `rewriteAsNewBranch` だけで、
  `createCheckpoint` 単体は RPC（`src/shared/bindings.ts:109`〜`135`）に露出していない。

## 5. データ対応表

| Radiora | Loro | 備考 |
| --- | --- | --- |
| `OutlineItem`（`id` / `parentId` / `orderKey` / `collapsed`） | `LoroTree` のノードと兄弟順 | 並びは fractional index ではなく既存 `orderKey` の投影を優先する |
| `OutlineItem.workId` / `revisionSelector` | ノード metadata | アプリ側 ID を metadata に置く。**TreeID は永続化しない**（PoC F6） |
| branch の `WorkingCopy.text`（1 Branch 1 行） | **Branch ごとに 1 つの `LoroText`** | PoC の「ノードごとのタイトル」は簡略化。配置ごとに text を持つと同一 Branch の複数配置が分岐する（`src/ui/editor_working_copy.ts:3` の伝播規則と衝突する） |
| `OutlineItem.text`（branch 追従の表示値） | 上記 `LoroText` の投影 | 既存どおり、同じ Work / Branch の全配置へ同じ値を反映する |
| `revisionSelector.mode === "pinned"` の配置 | 載せない（読み取り専用の投影） | 固定 Revision の写しであり編集対象ではない |
| Link / SystemRelation / tag / `historicalTime` | Phase 1 では載せない | DB のまま。undo の対象外であることを UI で区別する |

## 6. ライフサイクル

生成:

1. 選択中 Work / Branch の Working Copy と、その Work を含む Outline の部分木を API の snapshot から読む。
2. `LoroEditSession.begin()` が Loro doc を組み立て、本文は branch ごとの `LoroText` に、構造は
   `LoroTree` に入れる。読み取り専用の pinned 配置は含めない。
3. 命令の適用前に、対象 Branch が `revisionSelector.mode === "branch"` であることを再確認する
   （既存の `updateLocalText` と同じ判定。`editor_controller.svelte.ts:70`）。

投影:

- 構造操作は 1 操作 = 1 commit とし、投影は既存の outline 操作 API を 1 回呼ぶ。
- 本文は **既存の `WorkingCopyAutosaveCoordinator` に同じ値を queue するだけ**にし、
  `updateItemText` を呼ぶ writer は coordinator のまま 1 つに保つ
  （`editor_controller.svelte.ts:78` の `autosave.queue` と同じ経路。session から直接 RPC を呼ばない）。
- commit の直後に投影を要求する。既存の prepare → 同期 commit → 描画後の有効性再確認の規約に従い、
  投影の途中に `await` を挟んで公開順序を入れ替えない。

再構築（undo スタックを捨てる）:

- restore / import / schema migration / backup 復元の適用後。
- 他ペイン・他ウィンドウ・API 経由で同じ Work / Branch の保存済みデータが変わったことを検出したとき。
- 投影失敗が retry で解消できないとき。
- Branch / Work 切替、編集セッションを持つ pane の unmount。

解放:

- `release()` で timer / listener / observer と Loro doc の handle を破棄し、undo スタックを捨てる。
- undo スタック・Loro の handle・TreeID を復帰文脈（startup cache / resume API）へ保存しない。

## 7. 書込・投影の順序と失敗時

1 操作の順序:

1. 入力受理（世代 `editVersion` を進める）。
2. live state へ適用し、commit（undo ステップ確定）。
3. 投影: 本文は既存の `WorkingCopyAutosaveCoordinator` へ queue（`updateItemText` の writer は
   coordinator のまま）、構造は既存の outline 操作 API を呼ぶ。
4. 成否は既存の save status に反映する。save status の owner は既存の
   `createEditorController` + coordinator のまま変更しない。

失敗時:

- live state は維持し、**巻き戻さない**（[UI所有契約](ui-state-ownership.md) の「DBへの完了済み書込は
  UI要求の失効で巻き戻さない」と同じ）。
- save status を `failed` にし、既存の `retryAutosave` と同じ操作で retry する。
- undo / redo の投影も同じ経路を通す。`updatedAt` は前進させ、過去へ戻さない（§4.3 の復元と同じ思想）。
- 他ペインが同じ Branch を更新していた場合は、投影結果を Loro の import として取り込み、
  undo スタックには入れない（PoC F5）。取り込みで構造の前提が崩れた場合は再構築する。

## 8. Undo の意味論

- 粒度: 構造操作は 1 操作 1 ステップ。本文は保存境界ごとに 1 ステップを既定とし、打鍵の統合は
  Phase 2 で判断する（PoC 実測: `mergeInterval` 1000 ms で連続編集が 1 ステップ、0 で操作ごと）。
- 複合操作:「分割」「貼り付け」「複数項目の移動」は `transaction`（`groupStart/groupEnd`）で 1 ステップにする。
- ラベル: commit の message に語彙（`src/shared/ui_vocabulary.ts`）から生成した操作名を入れる。
  UI は「元に戻す: <操作名>」を出せる。Git 用語を露出しない（§4.5）。
- 対象外: 他ペイン / 他ウィンドウ / API 経由の変更、`system:*` origin の内部変更（正規化・移行・復元適用）。
- 削除の undo: サブツリーは内容ごと戻るが、Loro 内部では再作成される（TreeID は変わる。アプリ側 ID は
  不変）。同じ項目への並行編集は併合されないため、取り消し後にその旨を告知する（PoC F6・F7）。
- redo: 新規ローカル操作で破棄される。UI の `redo` 無効化はこの規則に従う。
- 段数: `maxUndoSteps`（既定 100）を設定値として持ち、セッションを跨がない。

## 9. 選択・caret・focus

- undo / redo 後の選択は、対象 item の存在を描画後に再確認してから適用する。存在しない場合は
  選択を維持せず、削除補正と同じ内部権限で補正する（ユーザー選択として記録しない）。
- caret / 選択範囲の復元は Phase 2。Loro の `onPush` が返す cursors を使う余地がある（PoC では空配列）。
- focus は View の都合であり、セッションは focus を所有しない。

## 10. 複数ペイン・複数ウィンドウ

- セッションは「ペイン × Work × Branch」に 1 つ。peer id はセッションごとに発行し、永続化しない。
- 他ペインの変更は import として扱い、undo スタックに入れない。
- 同じ Working Copy を 2 ペインで同時に編集した場合の最終状態は、既存の保存順（DB が直列化する）に
  従う。Loro の収束を最終状態の保証として使わない（§9.6 の範囲を広げない）。
- ウィンドウ間は同期しない。他ウィンドウの変更は「保存済みデータが変わった」として再構築の対象にする。

## 11. 検証計画

契約テスト（採用時は `vitest/**` か `src/**/*_test.ts` へ移す）:

- 1 操作 = 1 ステップ、`transaction` = 1 ステップ、ラベルの語彙。
- 他ペイン変更が undo で巻き戻らず、両者が同じ保存済みデータへ収束する。
- 投影失敗で live state を巻き戻さず、retry 後に保存済みデータと一致する。
- restore / import / migration 後に再構築され、`canUndo` が false になる。
- `release` 後に undo / redo が無効で、timer / listener が残らない。
- 削除 undo 後の告知文言と、復元された項目の再選択規則。

回帰シナリオ（[UI所有契約](ui-state-ownership.md) の失効規約に対応）:

- 画面移動中・保存中・branch 切替直後に undo キーを押しても、他 owner の状態を書き換えない。
- 復元（Recovery Snapshot）直後の undo が、復元前の状態を復活させない。
- 削除した項目の undo 後に、削除済み item を参照する focus / caret 要求を適用しない。
- 同じ Work を 2 ペインで開いた状態で、片方の undo がもう片方の表示を壊さない。

計測:

- build 出力（wasm / bundle サイズ）と起動時間を記録する。CI に bundle size の gate が無いため、
  採用時は記録を残す仕組みを別途用意する。

## 12. 現状との差（実装時に触る箇所）

| 種別 | 対象 | 内容 |
| --- | --- | --- |
| 新規 | `src/services/loro_edit_session.ts` 相当 | セッションの状態遷移と `loro-crdt` の import を閉じ込める |
| 新規 | セッション Controller | `undo` / `redo` / `canUndo` / `canRedo` / ラベルを View へ公開する |
| 変更 | `src/ui/editor_controller.svelte.ts` | `updateLocalText` の live state 適用先をセッション経由にし、投影は既存の `autosave.queue` / `updateItemText` のまま維持する（writer を増やさない） |
| 変更 | `src/ui/outline_operations_controller.svelte.ts` | 構造操作をセッションの port 経由にし、1 操作 = 1 commit にする |
| 変更 | `src/main.ts` / `src/shared/bindings.ts` | composition と command の配線。RPC 契約は変えない |
| 変更 | `vite.config.ts` | `resolve.conditions` と `optimizeDeps.exclude`（ADR 0003 / PoC README §7.1） |
| 変更 | `src/ui/keyboard_commands.ts` | Ctrl+Z / Ctrl+Shift+Z の command 追加（既存の語彙で表示） |
| 変更 | `docs/design/ui-state-ownership.md` | §3 の行を追記し、既存の editor draft 行との関係を明記 |
| 未着手のまま | Recovery Snapshot の作成トリガ | `shouldCreate` を呼ぶ実行時経路が現行 main に無い。永続 Undo を名乗るなら別 Issue で実装する |
| 未着手のまま | 「版として残す」の露出 | `RevisionService.createCheckpoint` は実装済みだが RPC に無い。Revision は現状 `promoteRecoverySnapshot` と `rewriteAsNewBranch` 経由でのみ作られる。本 ADR の範囲外 |

## 13. 後続 Issue（案）と未決定事項

後続 Issue（案）:

1. 編集セッションの Loro port と投影（Phase 1）。
2. undo ラベルと command / 語彙の接続。
3. 他ペイン変更の取り込みと再構築の契約テスト。
4. bundle 出力と起動時間の記録（サイズ gate の要否を含む）。
5. 永続履歴の配線（本 ADR の範囲外だが、undo と併用する前提）: Recovery Snapshot の実行時作成
   トリガと、「版として残す」（`createCheckpoint`）の RPC / UI 露出。
6. デスクトップ（CEF/Tauri）での wasm 配信と同期 XHR の実測。

未決定:

- 本文入力の統合粒度（保存境界ごとか、`mergeInterval` で打鍵をまとめるか）。
- Loro の兄弟順を既存 `orderKey: number` へ投影する規則（再割当の刻み、既存値との衝突、移動後の
  再採番を避ける方法）。`OutlineItem` は `orderKey` を保存するため、構造操作のたびにここを決める
  必要がある。
- Working Copy の保存形式を `text` 文字列のままにするか、Loro スナップショットへ置き換えるか
  （Phase 2 で `schema-evolution.md` の手続きに沿って判断）。
- 選択・caret の復元を Phase 2 に含めるか。
- Worker（Tree レイアウト等）で Loro を扱う必要が生じた場合の入口（production entry は同期 XHR）。

## 14. PoC が証明したこと / していないこと

証明した（実測）:

- 構造とテキストの undo/redo、1 操作 = 1 ステップ、グループ化、ラベル、システム変更の除外。
- 他ピア変更を巻き戻さず収束すること、削除 undo の再作成と並行編集の非併合。
- スナップショットに履歴が含まれないこと、履歴プレビューが `pause/resume` を要すること。
- Vite dev / production と実ブラウザでの動作、Node / Deno での動作。

証明していない:

- 実アプリの DB 投影との統合（本メモの設計は未実装）。
- 複数ペイン同時編集、大規模アウトラインでの性能、tombstone の蓄積。
- デスクトップ（CEF/Tauri）と Worker での wasm 読み込み。
- undo → Recovery Snapshot → Revision という一連の操作の連続性。
