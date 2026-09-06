# リファクタリング・バックログ

更新日: 2026-09-05。調査基点: `a74efc8`（調査開始時の working tree に変更なし）。

責務、state ownership、I/O、transaction の変更理由に沿って、挙動を維持したまま整理する計画。
ファイルを短くすること自体は目的にしない。既存のタスク ID は追跡のため維持する。

## 今回の調査と判断

`src` の production TypeScript/Svelte/CSS を行数で棚卸しし、既存候補の実装、呼び出し側、
関連テスト、storage bootstrap、quality task、Editor の mutation 調査文書を確認した。
行数は空行・コメント・style を含む物理行数で、quality gate の実装行数とは異なる。
全関数の精査と実行時プロファイルは調査対象外。A0 のUI操作検証は下記の今週実績を参照。

| 対象                                    | 現在の行数 | 実装からの判断                                                      |
| --------------------------------------- | ---------: | ------------------------------------------------------------------- |
| `src/ui/App.svelte`                     |      2,594 | View 分離後も起動、履歴、比較、query、tag、日付投影、操作処理が残る |
| `src/storage/memory_store.ts`           |        824 | protected 配列群を JSON/SQLite の永続化が共有する                   |
| `src/storage/json_store.ts`             |        547 | 版判定・旧版保護・保存・操作別 rollback が同居                      |
| `src/storage/sqlite_store.ts`           |        361 | mutation queue と rollback が集約済み。継承元変更の回帰対象         |
| `src/ui/tree_layout.ts`                 |        715 | lineage/cycle、lane、画面集約、edge 構築の純粋計算が同居            |
| `src/ui/PhylogeneticTree.svelte`        |        694 | pointer/camera/描画の責務を次回分離候補に維持                       |
| `src/ui/GlobalLineage.svelte`           |        169 | Sidebar と各 Pane は分離済み。旧649行の前提を撤回                   |
| `src/ui/editor_controller.svelte.ts`    |        595 | autosave coordinator は既存。completion の独立性を優先調査          |
| `src/services/inline_semantic_link.ts`  |        647 | Markdown 除外領域の走査と意味リンク文法が同居                       |
| `src/storage/graph_state_validation.ts` |        456 | record 別関数は既存。全体を一から分割する計画は縮小                 |
| `src/ui/styles.css`                     |        325 | 旧2,866行から大幅整理済み。残存 selector の所有確認に縮小           |

根拠は以下の実装箇所。行番号はこの調査基点での位置とし、実施時は symbol で再確認する。

- `App.svelte:203,743,1454` と `OutlineView.svelte:61,113`: `draggedId`
  が親子それぞれにある。子で開始した drag を、親の `dropOn` が親の値で判定する。 state ownership
  の不整合を静的に確認し、A0 でdrop後にRPCが発生しないことを再現・修正した。
- `App.svelte:1224–1351`: revisions/work lineage/comparison に個別の request counter
  と結果反映判定。 選択変更、応答順逆転、失敗時の扱いを保つ単位で分離する。
- `App.svelte:518–721`: startup cache、起動監視、初期ロード、reload が同居。
- `discovery_operations.ts` の `runRuleQuery` / `buildQueryProjectionNodes`: Work から代表
  occurrence への変換と query 投影が残る。 `listEmergenceSuggestions`
  も取得→計算→materialize→ranking を所有しており、D5 だけでは D6 は完了しない。
- `storage_bootstrap.ts` の `bootstrapStorage`: 既定は SQLite。Surreal は legacy migration 側。
  `turso_store.ts` は SQLite の互換 export であり、別の永続化実装として分割しない。
- `sqlite_store.ts` の `mutate` / `closeDatabase`: queue、snapshot、差分保存、rollback、close
  待機を集約済み。 `json_store.ts` は通常保存と restore で手順が異なるため、両者の policy
  を安易に共通化しない。
- `graph_state_validation.ts:43–95`: container 確認、既定 relation type
  補完、重複検査、参照検査を順序付け。 各 record validator は既に private
  関数であり、抽出のためだけに公開しない。

2026-08-31 の旧記録（40 clones、認知複雑度超過44関数、50行超過36関数、400実装行超過12ファイル）は
履歴値であり、現在値ではない。初回調査では再計測していない。今週の検証値は下記に記録し、異なる指標間の改善率は算出しない。

## 推奨着手順

1. **A0（完了）**: Outline の drag 状態不整合を再現し、専用の修正差分と回帰テストで解消した。
2. **A1a**: 履歴・比較の状態 owner を分離する。既存の応答順制御を最初の契約にする。
3. **D5 → D6 → A1b**: query の service と UI を順に整理する。
4. **S0 → S1 → S2**: SQLite/JSON の永続化契約を固定してから共有 Memory 状態を整理する。
5. **R1**: Editor の completion と既存 autosave coordinator の責務を分離する。
6. **A4 → A1c → A5**: startup、残りの feature 状態、composition の順で整理する。
7. **S3 → S4、T1〜T3、P1〜P4**: 当該 feature を変更する機会に一つずつ進める。
8. **G、O、C、残る R**: 明確な変更理由が生じるまで後順位。

A1a は Discovery に依存しない。旧「D6 完了まで App 全体を待つ」依存は撤回する。 R1 と Storage は App
と別ファイルで進められるが、同じファイルを触るタスクは同時に開始しない。 今週のA0は完了。次回は
**A1a（履歴・比較の状態所有分離）** を一作業単位にする。

## 運用・難易度

週に1日を目安に専用 branch/worktree（Jujutsu では workspace/change）で進める。
難易度1〜2は最大2タスク、3以上は原則1タスク。各回、対象確認→必要な契約テスト→構造変更→検証まで完結する。
難易度は 1=局所移動、2=小さな seam、3=複数利用側/非同期、4=状態/永続化再設計、5=段階移行必須。
所要日数の保証はしない。仕様変更・不具合修正は構造変更と別差分にする。

## 完了済み・部分完了の訂正

- [x] Phylogenetic Tree の camera 計算と空間 index を `tree_camera.ts` / `tree_spatial_index.ts`
      へ分離。
- [x] Today/Stub/Unplaced/Tags/Trash/Options、確認/Palette/Licenses の View を分離。
- [x] editor/navigation/work の Controller、Surreal の composition/repository/mapper/query/migration
      を分離。
- [x] Memory の純粋操作を `memory_store_operations.ts` へ分離し、service の依存を feature port
      へ縮小。
- [x] D1〜D4: search 契約と ranking、emergence 計算と persistence を分離。
- [x] A2 の描画部分: `OutlineView.svelte` / `OutlineRowItem.svelte` に分離。 drag の状態所有は A0
      で解消。残る Outline 操作は A2 に残す。
- [x] A3: `InspectorView.svelte` と Overview/Relation/History/Query の View を分離。 履歴や query
      の非同期状態は A1 の対象であり、A3 の再実装は不要。
- [x] A1 の emergence 部分: `emergence_controller.svelte.ts` と Vitest 契約テストが存在。
- [x] T4 の Sidebar/Inspector/Filter/Displayed 描画部分を分離。Tree 全体の状態整理は T3 に残す。
- [x] R5: `OutlineFilterBar.svelte` に Today/Unplaced の表示・入力を共有。
- [x] S3 の旧版保護ファイル作成を `protectVersionInput` へ集約。

これらは初回調査時の実装配置の確認記録。今週再実行した検証の範囲は以下に記録する。

## 今週の実績（2026-09-05、A0完了）

作業ブランチ:
`codex/weekly-outline-drag`。今週の対象は、着手前に指定したA0の再現・修正・回帰テスト。
A1a以降やF/Hの清掃には着手しておらず、Surreal削除の公開後条件とLog保持方針も維持する。

- 再現: 3行の固定fixtureをAppに渡し、実際のOutlineRowItem→OutlineView→Appのイベント経路で drag
  start/drop/endを実行。修正前は移動元の表示が変わっても `moveItem` の呼出しが0件だった。
- 判断: 移動元IDをdrop callbackだけに渡す案では、Appの空白クリック抑止が同じ状態を見られない。
  `outline_drag_controller.svelte.ts` を唯一のstate ownerとし、Viewへ値とstart/end
  callbackを渡す案を採用。
- 修正: drop時に移動元を確定してdrag状態を解除し、保存後も同じIDでreload・選択・focusを復元。
  同一行/移動元なしのdropは保存せず、保存失敗は既存エラー表示へ渡す。 OutlineViewのunmount
  cleanupでもdragを解除する。新規 `$effect`、DOM listener、timerは追加していない。
- 回帰証明: `tests/ui/outline-drag.spec.ts` の4件で遅延保存、同一行・取消、空白クリック、
  ネイティブdragでの保存失敗、画面離脱を検証。RPCと読込データはfixtureであり、DBの並べ替え自体を
  このブラウザテストで再実装・検証してはいない。
- Controller直接テスト: `vitest/outline_drag_controller.svelte.test.ts` の2件で、
  保存待ち中に始まった次のdragを古い保存完了が消さないことと、失敗時の通知/非reloadを固定。
- 継続実行: `npm run test:ui` を追加し、既存Chromium CIジョブからも実行する。
  初回Vite/Svelteコンパイルに約36秒かかったためテスト全体の上限は60秒、個々のassertionの上限は据え置き。

検証結果:

| 検証                                                     | 結果                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `deno task verify`                                       | 成功。Deno 746件（4 steps）、Vitest 65件（9 files）、build成功 |
| `svelte-check`（verify内）                               | 0 errors / 0 warnings                                          |
| `npm run test:ui`                                        | Chromiumで4件成功                                              |
| `deno task quality`（baseline更新後）                    | 208 production filesで成功                                     |
| 文書/追加configの `deno fmt --check`、`git diff --check` | 成功                                                           |

Appの実装行baselineを既存上限2,816から実測2,421へ更新した。この差全体を今週の削減量とは扱わない。
magic-number ratchetは281 current/281 baseline、duplicate ratchetは34 current/36 baselineで成功。
既存のlint警告とbuildのchunk size警告は残るが、今回の検証にエラーはない。

## A: App の状態所有と composition

- [x] **A0: Outline drag 契約の再確認** — 難易度2、最優先
  - 対象: `App.svelte` の `dropOn` /
    `deselectFromBlank`、`OutlineView.svelte`、`OutlineRowItem.svelte`、`outline_row_types.ts`。
  - drag start→drop→end、同一行への drop、空白クリックを実際のイベント経路で確認する。
  - owner を一箇所に置く案と、drop callback に移動元 ID を渡す案を比較し、最小の変更を選ぶ。
  - 完了条件: View で開始した drag の移動元が操作側へ届き、終了時にクリアされる回帰テストがある。
    不具合が再現した場合は修正を別差分で先行し、現在の不具合を保存すべき仕様としない。
- [ ] **A1a: 履歴・比較の feature Controller** — 難易度4
  - 対象: revisions/recovery/work lineage と comparison のロード処理。履歴と比較は別の state owner
    とする。
  - `selectedId`/snapshot を複製せず、現在の選択を getter または入力で受け取る。
  - 完了条件: App に結果配列・loading・request counter が残らず、選択変更/逆順応答/失敗を Vitest
    で固定。 shared counter を別々の owner に分ける際は comparison 同士の排他性を維持する。
- [ ] **A1b: rule query Controller** — 難易度3、依存 D5
  - source/name/result/error/saved query と sparse projection の状態遷移を所有する。
  - 完了条件: `InspectorQueryPanel` は表示と callback のみ、query の一時ノードを永続化しない。
- [ ] **A1c: tag・alias・日付投影の残存状態を整理** — 難易度3
  - `saveAlias`、tag 操作、`loadDateProjection` を各既存 feature に帰属させ、一つずつ移す。
  - 完了条件: 無関係な状態を巨大な analysis Controller に集めず、既存 emergence owner を維持する。
- [ ] **A2: Outline 操作の残作業** — 難易度3、依存 A0
  - indent/outdent/sibling move/drop の操作を既存 editor/navigation の責務と比較して移す。
  - 完了条件: 選択・drag の owner が一意で、分離済み View に RPC を入れない。View
    分割をやり直さない。
- [x] **A3: Inspector View 分離** — 上記完了記録を参照。
- [ ] **A4: startup lifecycle と preference I/O** — 難易度4
  - cache 復元→起動監視→実データ読込→retry、unmount の取消を一つの startup owner にまとめる。
  - 既存 `startup_snapshot_cache.ts` と preference helper を再利用。preference
    は別の小さな作業単位にする。
  - 完了条件: cache 有無/失敗、retry、unmount 後応答の契約があり、timer/listener の cleanup
    が明示される。
  - A1〜A3 全完了は必須ではない。App の同時編集を避けるため順に着手する。
- [ ] **A5: composition root の最終整理** — 難易度3、依存 A1/A2/A4
  - bootstrap、feature 接続、View 選択を残す。単なる行数目標や巨大 props bag を作らない。
  - 完了条件: 残る `$effect` の目的・依存・cleanup と feature 間の依存方向を説明できる。

## D: Discovery Operations

- [x] **D1**: search/emergence/rule query の責務別契約テスト。
- [x] **D2**: `search_operations.ts` と純粋 `search_ranking.ts`。
- [x] **D3**: `emergence_suggestion_calculator.ts` の候補計算・ranking。
- [x] **D4**: `emergence_persistence.ts` の materialize/resolve lifecycle。
- [ ] **D5: rule query operations を抽出** — 難易度3
  - `runRuleQuery`、saved query CRUD、query projection を一つの module にする。
  - query に必要な port のみを渡し、代表 occurrence の選択順と implicit FROM link の扱いを維持する。
  - 完了条件: `discovery_rule_query_operations_test.ts` の正常/無効入力/非永続化契約が同じ interface
    で通る。
- [ ] **D6: 残る emergence orchestration と facade を整理** — 難易度3、依存 D5
  - `listEmergenceSuggestions` の取得→search→候補→materialize→rank を emergence 側へ移す。
  - 完了条件: `DiscoveryOperations` は配線と委譲のみで、graph
    traversal、ranking、永続化判断を持たない。
  - 公開 binding を維持し、search/emergence の既存契約テストで代表経路を確認する。

## S: Memory / SQLite / JSON Storage

Surreal の repository 数を模倣せず、現在の GraphStore port と transaction を基準にする。

- [ ] **S0: 永続化契約の対応表を作る** — 難易度2、S1 の前提
  - 全 mutation と状態フィールドについて Memory/SQLite/JSON
    の保存・復元経路と既存テストを対応付ける。
  - SQLite の差分保存、失敗時 rollback、並行 mutation、close 待機は
    `tests/sqlite_store_contract_test.ts` に既存テストあり。
  - JSON restore の write/rename 失敗は `src/storage/json_backup_restore_test.ts` に既存テストあり。
  - 完了条件: 不足した契約だけを追加する。JSON の通常保存を SQLite と同じ保証だと仮定しない。
- [ ] **S1: Memory state container** — 難易度4、依存 S0
  - protected 配列群、export/restore、JSON の個別 capture/rollback の依存を同時に棚卸しする。
  - 完了条件: 状態 owner は一つ。relation type、resume、feedback 等を含む round-trip が全 adapter
    で維持される。
- [ ] **S2: feature 操作の内部抽出** — 難易度4、依存 S1
  - 変更理由が独立する操作から一つずつ抽出し、既存 `memory_store_operations.ts` を再利用する。
  - 完了条件: 一つの mutation を複数 repository が勝手に commit せず、SQLite queue/rollback
    を維持する。
- [ ] **S3: JSON codec/version guard** — 難易度3、S2 から独立
  - unknown 入力の版判定、migration、検証を I/O から分離。既存 `backup_migrations.ts` を再利用する。
  - 完了条件: V0〜V7、未来版、壊れた入力、旧版保護の契約を fixture で検証できる。 validation
    強化で受理入力やエラーを変える場合は別の挙動変更として扱う。
- [ ] **S4: JSON persistence policy** — 難易度4、依存 S0/S3、S1/S2 と同時編集しない
  - 通常保存、batch/import、atomic restore の保証を区別したまま重複手順を整理する。
  - 完了条件: 失敗時の memory/disk/一時ファイルの契約が維持される。全面 atomic 化は別仕様とする。
  - SQLite の既存 `mutate` を再実装せず、JSON と共通の抽象基底 class を新設しない。

## R1: Editor completion（再レビューから実施候補へ）

- [ ] **R1: completion の state ownership を分離** — 難易度3
  - 根拠: `editor_controller.svelte.ts:81–145` は保存状態、二種類の補完、backlink を同時に所有する。
    autosave/resume は既に coordinator に委譲済みなので、保存処理の再抽出は不要。
  - `docs/mutation-testing/editor-controller.md` の未到達箇所の指摘を起点に、completion の
    request/cancel/commit を一つずつ抽出する。
  - 完了条件: cancel 後・別 item 選択後の古い応答が反映されず、挿入範囲と caret、保存・resume
    の契約が維持される。
  - 既存 `vitest/editor_controller.svelte.test.ts` と coordinator
    テストを使い、内部変数を公開してテストしない。 mutation score の向上は再計測後にのみ報告する。

## T: Tree UI / Layout

- [ ] **T1: graph projection の抽出** — 難易度4
  - `calculateLineageProjection` / cycle 判定と lane ordering を変更理由ごとに分ける。
  - 完了条件: `tree_layout_test.ts` と `tests/high_density_tree_layout_test.ts`
    で循環、順序、座標/集約契約を維持。
- [ ] **T2: hit testing / pointer interaction** — 難易度3
  - DOM 座標変換、純粋 hit 判定、drag/pan の状態を区別。すべてを純粋関数にする旧条件は撤回する。
  - 完了条件: 純粋判定は直接テスト、pointer capture と cleanup は実イベント経路で確認する。
- [ ] **T3: camera/filter の owner 確認** — 難易度3
  - GlobalLineage の filter は props/callback、cluster と sidebar tab
    はローカル状態という既存構造を起点にする。
  - 完了条件: camera と選択の所有が重複せず、既存 `tree_camera.ts` を再利用。万能 tree Controller
    を作らない。
- [x] **T4: Sidebar/Inspector/legend 周辺 View の抽出** — 描画分離済み。残る操作状態は T2/T3。

## P / G / O: Parser と検証

- [ ] **P1** — 難易度3: escape、未完入力、source range、Markdown
      除外領域の既存テストを確認し不足だけ補強。
- [ ] **P2** — 難易度3、依存 P1: fence/code/link/URL の走査を意味リンク文法から分離。 Markdown
      parser と契約が一致する箇所だけ共有する。token 列の新設は必須としない。
- [ ] **P3** — 難易度3、依存 P2: endpoint/type/reason の文法を整理。小さな scanner 関数で足りるなら
      parser framework は作らない。
- [ ] **P4** — 難易度2、依存 P3: diagnostics
      の独立した変更理由が残る場合だけ抽出。公開位置・診断文言を維持。
- [ ] **G1** — 難易度2: 既存 snapshot 検証テストに、複数不正時のエラー順・既定 relation
      type・入力不変の不足ケースを補う。
- [ ] **G2** — 難易度3、依存 G1: schema の形状検査と参照/DAG
      不変条件の依存を確認し、必要な集合だけ抽出。 既存 record
      関数を一律に個別ファイル化しない。入口の検証順と返却値を固定する。
- [ ] **O1** — 難易度2: `opml_test.ts` の namespace/属性/入れ子/空要素/不正 XML の不足を確認。
- [ ] **O2** — 難易度3、依存 O1: element 走査と import model
      変換の独立した変更理由がある場合に限定して抽出。

## C: Styles（全面移行から残存確認へ縮小）

- [ ] **C1** — 難易度1: `.section-title` / `.hint` / `.empty` の利用側、 `.app-main > .inspector`
      の親子依存、`.work-lineage-workspace` の所有を確認する。 現状の325行をすべて基盤 CSS
      と認定しない。
- [ ] **C2** — 難易度2、依存 C1: feature 固有分だけ所有 View へ移す。 layout の親子接続は
      wrapper/custom property を検討し、style だけ別ファイルに出して行数を減らさない。 完了条件:
      Outline/Inspector/Lineage の desktop/狭幅と light/dark を目視または visual test で確認する。

## その他の再レビュー候補

以下は行数だけで実施へ昇格させない。今回、詳細な分離設計までは行っていない。

- [ ] **R2**: `branch_service.ts` — branch/working copy/revision/recovery の transaction
      を保てるか。
- [ ] **R3**: `occurrence_operations.ts` — 移動/複製/削除の不変条件の独立性。
- [ ] **R4**: `models.ts` — 型カタログだけなら維持。循環依存の証拠が出た場合のみ分割。
- [x] **R5**: Today/Unplaced filter bar 分離済み。
- [ ] **R6**: Surreal merge validation の個別整理は F2/F3
      に統合。削除予定実装のリファクタリングは行わない。
- [ ] **R7**: Markdown export / sparse outline — traversal と投影条件の分離に実益があるか。
- [ ] **R8**: Markdown editor adapter — selection/scroll 復元の同一契約がある場合だけ内部共有。
- [ ] **R9**: `sqlite_records.ts`（421行）— row codec/差分 plan/SQL transaction の変更理由を確認。
      `tests/sqlite_records_test.ts` と差分 statement trace を維持し、S0 の結果を見て実施判断する。

Map 構築だけの汎用 helper、全 feature 共通 Controller、Surreal/SQLite/JSON 共通 repository
framework、 Turso 互換名や保存パスの改名は今回の計画に含めない。

## F: 不要ファイルと旧資産の清掃

2026-09-05 の追加方針: Surreal 関連は **次バージョン公開後**に、DB
移行用スクリプトを除いて削除する。
v0.4以前の保有者はいないと見込む、という製品判断を前提に通常運用の互換実装を廃止する。
利用者数を実測した事実とは扱わない。公開前は棚卸しと移行専用化を進め、削除は公開後の別差分にする。
次バージョンの番号は実施時のリリース記録で確定する。

- [ ] **F1: 削除候補と保持依存を一覧化** — 難易度2、公開前から実施可
  - `src/storage/surreal_*.ts`、`src/desktop/surreal_process.ts`、関連 scripts/test/fixture、
    package/lockfile、Deno task、CI、配布用 binary/ライセンス生成への参照を追跡する。
  - 移行の入口は `scripts/migrate_legacy_surreal.ts`。現在は `legacy_surreal_exporter.ts` → 動的
    import の `surreal_store.ts` → repository 群に依存している。
    ファイル名の一致だけで削除を決めない。
  - 完了条件: 各候補に通常運用用・移行専用・共有・未使用の分類、参照元、削除時期がある。
    一時生成物や未使用 fixture も調べるが、ユーザーデータ/DB/バックアップと Log は清掃対象外。
- [ ] **F2: 移行ツールを通常運用の Store から独立させる** — 難易度4、依存 F1
  - exporter が必要とする旧DBの読込・snapshot 変換・process 起動/終了を移行専用の実装へ集約する。
  - 移行用スクリプトの例外には、その実行に必要な最小の module、依存 package/binary、fixture、
    テストと手順を含める。通常運用の全 repository を例外として残し続けない。
  - `turso_migration.ts` の backup/marker 検証と `storage_bootstrap.ts` の旧DB検出も参照を確認する。
    旧DBを誤って新規DBとして扱う変更や、ユーザーの旧DB削除はこの清掃に含めない。
  - 完了条件: 実際の exporter を使う移行 fixture で snapshot/SQLite round-trip を確認し、
    失敗時の原本保全・再実行・process cleanup を検証する。mock exporter だけでは完了としない。
- [ ] **F3: 次バージョン公開後に Surreal 通常運用資産を削除** — 難易度3、依存 F2 と公開完了
  - 通常運用
    Store/repository、専用テスト、不要になった開発スクリプト・task・CI・配布処理を削除する。
  - 移行専用に必要な package/binary はツール側に限定し、不要な依存のみ lockfile と一緒に除去する。
  - 完了条件: 公開済みタグ/日付を記録し、通常アプリから旧 Store への import がなく、
    移行コマンド・SQLite 起動・build・`deno task verify` が通る。削除したコードの baseline
    も除去する。
  - R6 の Surreal merge validation リファクタリングは取りやめ、移行に残るコードだけ F2 で扱う。
- [ ] **F4: その他の不要ファイルを段階削除** — 難易度2、依存 F1 の棚卸し方法
  - production/test/story/script/config の参照と生成元を照合し、置換済み実装・用途を失った fixture・
    不要な追跡済み生成物を一種類ずつ削除する。未参照でも動的読込や配布用途があれば保持する。
  - 完了条件: 削除理由と代替先または用途終了を記録し、対応する import/task/build/link
    が切れていない。

アプリの v0.4 というバージョンと、backup/schema version の数値は別物。 旧JSON codec/fixture
の廃止を番号だけで自動的に含めず、移行ツールが読む形式を F1/F2 で確定する。

## H: docs の現行仕様への整理

**Log は保持する。**
それ以外の古い文書は順次統合・更新・削除し、現行仕様を探す際の重複や矛盾を減らす。 古い文書を一律に
Log へ移して残す運用にはしない。日付だけで仕様や将来提案の有効性を判断しない。

- [ ] **H1: 仕様の正本と旧文書を棚卸し** — 難易度2、今から実施可
  - README と docs
    のリンクを辿り、現行仕様・運用手順・未実装提案・旧計画・Log・ライセンスに分類する。 Log
    の実際の配置と用途を確認して保持対象を明示する。
  - 最初の対象:
    `docs/2026-07-31_design_improve_plan.md`、`docs/2026-08-06_tree_view_improve_plam.md`、
    `docs/2026-08-22_outline_bulk_semantic_link_selection.md`、`docs/2026-08-22_implicit_from_relations.md`、
    `docs/design/phase-0-baseline.md`。
  - `docs/design/product-direction.md` は draft、`docs/design/sync-storage-schema.md` は proposed。
    現行実装の仕様と混ぜず、現在も有効な提案かを確認する。
  - 完了条件: 各文書に保持/更新/統合/削除の判断と、必要な情報の移管先がある。
- [ ] **H2: 旧計画・仕様の統合と削除** — 難易度2、依存 H1
  - 完了済み計画の現行仕様は正本へ、未完了の有効な作業は現行バックログへ統合して旧文書を削除する。
  - `docs/design/schema-evolution.md` の現行規則と旧Surreal/Phase 0の説明を区別し、
    移行に必要な旧形式の説明は移行手順へ集約する。Surreal 廃止を前提とする更新は F3 と揃える。
  - 完了条件: 同じ仕様の正本が複数なく、README・docs・コード/テスト内の参照を更新済み。 Log
    の本文を改変してリンク切れを直すのではなく、必要な場合は現行側に後継先の対応を示す。
- [ ] **H3: 継続清掃の完了条件化** — 難易度1、依存 H2
  - feature/phase/release の完了時に、対応する非Log文書の旧計画・重複記述を見直す。
  - mutation 調査文書は現行の改善判断に使う部分だけ更新・統合する。履歴記録としての Log は保持する。
    `docs/licenses` と有効な配布手順は古い日付だけで削除しない。
  - 完了条件: 仕様参照の入口から現行仕様へ辿れ、未実装案と実装済み仕様を区別できる。 変更文書の
    format とローカルリンク/anchor を検査する。docs だけなら production test の再実行は不要。

F1/H1 は他の候補と独立して開始できる。H2 は一文書群ずつ通常開発に組み込み、F3 は公開後に実施する。
清掃は「挙動を保つ構造変更」と別の作業種別であり、F3
で明示した旧運用の廃止は意図的な対象縮小とする。

## 検証と共通完了条件

実装時は変更対象の契約テストを先に実行し、不足する観測可能な挙動だけを追加する。

- UI Controller: 対象の `vitest/*.svelte.test.ts` を `npx vitest run --project unit <path>` で実行。
- Storage:
  `deno test -A tests/graph_store_contract_test.ts tests/graph_store_port_contract_test.ts tests/sqlite_store_contract_test.ts src/storage/sqlite_store_test.ts src/storage/json_store_test.ts src/storage/json_backup_restore_test.ts`。
- Discovery:
  `deno test -A src/services/discovery_search_operations_test.ts src/services/discovery_emergence_operations_test.ts src/services/discovery_rule_query_operations_test.ts`。
- Tree/Parser: 対応する既存の直接テストと高密度 fixture。View
  を変える場合は実イベント・表示も確認する。

各実装差分の完了条件（F/H の清掃には上記の廃止・文書統合条件を適用）:

- 公開挙動、UI 文言、保存形式、エラー順序、transaction の保証を維持する。
- state owner は feature ごとに一つで、View に RPC/DB/ファイル I/O を移さない。
- 新しい純粋 module は interface 経由でテストする。通過だけの facade を増やさない。
- `$effect`/timer/listener の目的・依存・cleanup と古い応答の扱いを確認する。
- 対象の duplicate/complexity/line baseline を増やさず、解消した登録だけ削除する。
- `deno task verify` が成功する。UI の変更では必要な visual/a11y 検証も加える。

計画更新と今週のA0実装・検証を完了。`verify`
のformat対象にはdocsが含まれないため、文書は別途確認した。
