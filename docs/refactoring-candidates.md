# リファクタリング・バックログ

大型ファイルの責務を、挙動を維持したまま段階的に分割するためのロードマップ。
構造変更と仕様変更は同じ差分に混ぜず、各タスクで `deno task verify` を通す。

行数はこのロードマップ更新時点の概数。行数だけで分割を決めず、state ownership、I/O 境界、
変更理由の異なる責務が同居しているかを優先して判断する。

2026-08-31 の静的解析 baseline 調査では、jscpd 40 clones、認知複雑度超過 44 関数、 50 行超過 36
関数、400 実装行超過 12 ファイルを確認した。これらは優先順位付けと改善確認に使うが、
数値を減らすためだけの共通 helper や shallow module
は作らない。同じ不変条件・変更理由を持つ実装だけを 同じ seam の内側へ集約し、触れた範囲の baseline
を ratchet する。

## 難易度

| 表記      | 目安     | 判断基準                                             |
| --------- | -------- | ---------------------------------------------------- |
| 1: 低     | 半日以内 | 純粋な移動が中心で、公開 API と状態所有を変えない    |
| 2: やや低 | 0.5〜1日 | 小さな境界設計と直接テストが必要                     |
| 3: 中     | 1〜2日   | 複数の利用側、非同期処理、共有状態のいずれかに触れる |
| 4: 高     | 2〜4日   | state ownership や永続化境界を再設計する             |
| 5: 最高   | 4日以上  | UI・状態・I/O を横断し、段階移行が必要               |

難易度は工数の保証ではなく、レビュー時に必要な注意量の目安とする。

## 運用方針

週に1日をリファクタリング日にし、通常の機能開発とは専用の branch/worktree（Jujutsu では 専用
workspace/change）を分けて少しずつ進める。

- 1回の作業範囲は、難易度1〜2なら最大2タスク、難易度3以上なら原則1タスクとする
- 各回は「対象確認 → characterization test → 構造変更 → `deno task verify`」まで完結させる
- 挙動変更や新機能が必要になった場合は、その場で混ぜず別タスク・別 change に切り出す
- 完了したタスクはチェックを付け、実測行数や新しく判明した依存関係をバックログへ反映する
- 専用作業領域は定期的に開発元へ追随し、長期間の差分を一括で統合しない
- 並行作業は異なるファイル境界に限定し、同じ巨大ファイルを複数担当で同時編集しない

### 週次サイクル

1. 今週扱うタスクを一つ選び、完了条件と変更対象を再確認する
2. 必要なら単純な調査・テスト追加・機械的な移動をサブエージェントへ分担する
3. state ownership、公開 API、I/O 境界に関わる設計判断を主担当でレビューする
4. 対象テストと `deno task verify` を通し、一つの説明可能な change として区切る
5. バックログを更新し、次回の先頭タスクを一つだけ決める

最初の週は **D1: 現行契約を責務別テストで固定する** を扱う。余力があれば D2 の境界設計までに
留め、実装範囲を無理に広げない。

## 完了済み

- [x] `PhylogeneticTree.svelte` からカメラ計算を `tree_camera.ts` へ分離
- [x] `PhylogeneticTree.svelte` からラベル衝突用空間インデックスを `tree_spatial_index.ts` へ分離
- [x] `App.svelte` から Today、Stub List、Unplaced、Tags、Trash、Options の各 View を分離
- [x] 確認フロー、Command Palette、Licenses のダイアログ描画を分離
- [x] `App.svelte` から editor/navigation/work 操作を feature controller へ分離
- [x] `surreal_store.ts` を接続と repository 群を束ねる composition root へ縮小
- [x] Surreal 永続化を outline/work/revision/relation/discovery/backup repository へ分離
- [x] row mapper、query、migration、DDL、graph validation を独立した境界へ分離
- [x] `memory_store.ts` から純粋ドメイン操作・投影処理を `memory_store_operations.ts` へ分離
- [x] サービス層の依存を feature-specific store port へ縮小

## 推奨着手順

1. Discovery Operations を分割し、analysis 系 UI が依存するサービス境界を固定する
2. `App.svelte` の analysis、Outline、Inspector を順に分離する
3. Memory/JSON Store を、確定済みの feature port に沿って分割する
4. graph snapshot validation を characterization test で固定して分割する
5. Tree UI と tree layout を純粋計算、状態、View に分ける
6. inline semantic link parser を characterization test で固定して分割する
7. OPML parser、CSS、追加候補を再レビューする

依存しないタスクは並行実施できる。特に Storage、Tree、Parser は、Discovery/App 系と別担当で
進められる。ただし同じファイルを触るタスクは同時に開始しない。

## D: Discovery Operations

対象: `src/services/discovery_operations.ts`（約 243 行）

検索、prefix suggestion、alias、emergence suggestion、feedback、rule query、query projection が
同居している。外向け API を保つ薄い facade を残し、次の順で分ける。

- [x] **D1: 現行契約を責務別テストで固定する** — 難易度 2
  - search、emergence、rule query の既存テストを分類し、各境界の入力・出力・副作用を明示する
  - 完了条件: 分割後にどのテストを移すか判断でき、主要な異常系が固定されている
  - 実績: test support を共有しつつ3責務の契約テストへ分け、無効入力、stale suggestion、 missing
    saved query と失敗時に永続化されないことを固定した
- [x] **D2: search operations を分離する** — 難易度 3
  - prefix suggestion、lexical search、alias 展開・保存を所有する
  - 完了条件: search が `DiscoveryStorePort` と必要最小限の参照 port のみに依存する
  - 依存: D1
  - 実績: I/O を `search_operations.ts`、alias 展開と ranking を純粋な `search_ranking.ts`
    へ分け、互換 facade と store なしの直接テストを維持した
- [x] **D3: emergence suggestion 計算を分離する** — 難易度 4
  - neighbor、ancestor、候補 ranking などの純粋計算と、データ取得を分ける
  - 完了条件: 候補計算を store なしで直接テストできる
  - 依存: D1、D2 の search API
  - 実績: 永続化前の候補計算と最終 ranking を `emergence_suggestion_calculator.ts` へ分け、3候補種と
    pinned/score/limit 順序を直接テストした
- [x] **D4: emergence persistence/resolution を分離する** — 難易度 3
  - feedback、accept/dismiss/pin、asserted link 作成のトランザクション境界を所有する
  - 完了条件: 候補計算と更新コマンドが互いの内部状態を共有しない
  - 依存: D1
  - 実績: 候補計算から materialize/legacy feedback/resolve lifecycle を分離し、公開 interface
    と既存の stale・pin・dismiss・accept 契約を維持した
- [ ] **D5: rule query operations を分離する** — 難易度 3
  - query 実行、saved query、query projection を所有する
  - 完了条件: rule query が search/emergence 実装へ依存しない
  - 依存: D1
- [ ] **D6: `DiscoveryOperations` を互換 facade に縮小する** — 難易度 2
  - RPC/binding の公開形を維持し、分割した operation を委譲する
  - 完了条件: facade に ranking、graph traversal、永続化判断が残っていない
  - 依存: D2〜D5

## A: App Composition

対象: `src/ui/App.svelte`（約 2,960 行）

最終的な責務は、アプリの bootstrap、feature 間の接続、トップレベル View の選択に限定する。 共有 Rune
の state owner は `*.svelte.ts` の Controller/ViewModel に置く。

- [ ] **A1: analysis controller を分離する** — 難易度 4
  - tags、rules、emergence、lineage、comparison、revisions の状態と操作を移す
  - 完了条件: `App.svelte` が analysis の非同期状態遷移を直接所有しない
  - 依存: D6
- [ ] **A2: Outline workspace View を分離する** — 難易度 4
  - Outline 本体、選択、drag/drop、編集イベントを明示的な props/callback にする
  - 完了条件: 子 View に RPC/DB 呼び出しがなく、状態所有者が一意である
  - 依存: editor/navigation controller の既存 API
- [ ] **A3: Inspector View を分離する** — 難易度 3
  - 選択対象の詳細、リンク、履歴等の表示とローカル入力をまとめる
  - 完了条件: Inspector が選択状態を複製せず、外部更新は callback 経由である
  - 依存: A2 と並行可。ただし同時編集は避ける
- [ ] **A4: lifecycle と preference I/O を境界化する** — 難易度 4
  - 初期ロード、再読込、local preference、cleanup を controller/adapter へ寄せる
  - 完了条件: `$effect` ごとに目的・依存・cleanup の要否を説明できる
  - 依存: A1〜A3 後を推奨
- [ ] **A5: `App.svelte` を composition root として整理する** — 難易度 3
  - 不要な中継関数と重複 derived state を除去する
  - 完了条件: View、Controller、Service の依存方向が一方向で、残存責務を文書化している
  - 依存: A1〜A4

## S: Memory/JSON Storage

対象: `src/storage/memory_store.ts`（約 793 行）、`src/storage/json_store.ts`（約 554 行）

Surreal 側で確定した feature port を基準にする。共有配列を複数 repository が直接変更する形には
せず、メモリ状態の owner は一つに保つ。

- [ ] **S1: Memory Store の state container を明示する** — 難易度 4
  - snapshot/restore と各 feature 操作が共有する状態を一つの内部コンテナにまとめる
  - 完了条件: 状態所有は一箇所のまま、操作コードが feature 単位に分離可能である
- [ ] **S2: Memory Store 操作を feature port 単位へ分離する** — 難易度 4
  - outline/work/revision/relation/discovery/backup の委譲先を作る
  - 完了条件: `MemoryGraphStore` は port の合成と state container の所有に集中する
  - 依存: S1
- [ ] **S3: JSON codec と version guard を分離する** — 難易度 3
  - parse/serialize、schema version 判定、旧版入力保護をファイル I/O から切り離す
  - [x] 版別 migration 前に重複しているバックアップファイル作成を、一つの内部処理へ集約する
  - 完了条件: fixture だけで codec と各 version guard を直接テストできる
- [ ] **S4: JSON persistence policy を分離する** — 難易度 4
  - mutation 後の persist、rollback、atomic write の責務を集約する
  - 完了条件: 各 override が同じ保存手順を重複実装せず、失敗時の状態が契約テストで固定される
  - 依存: S2、S3

## T: Tree UI / Layout

対象: `src/ui/PhylogeneticTree.svelte`（約 688 行）、`src/ui/GlobalLineage.svelte`（約 649 行）、
`src/ui/tree_layout.ts`（約 703 行）

- [ ] **T1: tree layout の graph projection を分離する** — 難易度 4
  - lineage projection、component/lane ordering、raw edge 構築を独立した純粋モジュールにする
  - 完了条件: 各アルゴリズムを小さな graph fixture で直接テストできる
- [ ] **T2: hit testing と pointer interaction を分離する** — 難易度 3
  - rectangle hit、selection、drag/pan 判定を View から移す
  - 完了条件: DOM event から座標への変換以外が純粋関数としてテストされている
- [ ] **T3: camera/controls/filter の state owner を決める** — 難易度 4
  - Phylogenetic Tree と Global Lineage の共有可能部分と feature 固有部分を分ける
  - 完了条件: 同じ状態を親子双方が所有せず、Rune の配置理由が明確である
  - 依存: T1、T2 と並行可
- [ ] **T4: Tree inspector/legend View を分離する** — 難易度 2
  - 選択詳細、凡例、操作パネルを表示コンポーネントへ移す
  - 完了条件: 分離 View はレイアウト計算や store を参照しない
  - 依存: T3

## P: Inline Semantic Link Parser

対象: `src/services/inline_semantic_link.ts`（約 636 行）

- [ ] **P1: parser の characterization test を補強する** — 難易度 3
  - escape、未完入力、曖昧な token、範囲位置、複数 error の現行挙動を固定する
  - `markdown_parser.ts` との重複部分について、入力・source range・error 契約が同一かを先に比較する
- [ ] **P2: scanner/tokenizer を分離する** — 難易度 3
  - 文字列走査と source range の生成だけを担当する
  - 両 parser の契約が同一と確認できた字句走査だけを共有し、文法や診断は共通化しない
  - 依存: P1
- [ ] **P3: grammar/parser を分離する** — 難易度 4
  - token 列から意味リンク表現を組み立て、UI や診断文言に依存しない
  - 依存: P2
- [ ] **P4: diagnostics と補完情報を分離する** — 難易度 3
  - parse error、notice、候補提示用情報への変換を担当する
  - 依存: P3

## G: Graph Snapshot Validation

対象: `src/storage/graph_state_validation.ts`

- [ ] **G1: snapshot validation の characterization test を責務別に補強する** — 難易度 3
  - top-level shape、各 record、参照整合性、重複、不正 ID の現行 error を固定する
- [ ] **G2: record validation と cross-record validation を分離する** — 難易度 4
  - `validatedGraphStateSnapshot` は検証順序と結果組み立てだけを所有する
  - 完了条件: 各 record validator と参照整合性を小さな fixture で直接テストできる
  - 依存: G1

## O: OPML Parser

対象: `src/services/opml.ts`

- [ ] **O1: element parser の characterization test を補強する** — 難易度 2
  - namespace、属性、入れ子、空要素、不正 XML の現行挙動を固定する
- [ ] **O2: element 走査と outline 変換を分離する** — 難易度 3
  - XML element の走査と Radiora の import model への変換を別の純粋処理にする
  - 依存: O1

## C: Styles

対象: `src/ui/styles.css`（約 2,866 行）

- [ ] **C1: selector ownership を棚卸しする** — 難易度 2
  - feature、共有 primitive、legacy/未使用の三種に分類する
  - 完了条件: 移動先と削除候補が一覧化され、見た目変更を伴わない
- [ ] **C2: feature 固有 CSS を component/feature 単位へ移す** — 難易度 3
  - 一度に全面移行せず、分離済み View ごとに小さく移す
  - 完了条件: global selector の必要性を説明でき、主要画面を目視確認している
  - 依存: C1。App/Tree の View 分割後が安全

## 再レビュー候補

次は行数だけでは即分割しない。先に責務と変更頻度を調べ、独立した変更理由が二つ以上ある場合に
個別タスクへ昇格する。

- [ ] **R1: `editor_controller.svelte.ts`（約 572 行）をレビュー** — 難易度 2
  - autosave、resume position、inline link completion の state ownership が一つで妥当か確認する
  - completion と autosave が独立した変更理由を持つ場合だけ、内部 module へ分離する
- [ ] **R2: `branch_service.ts`（約 448 行）をレビュー** — 難易度 2
  - branch、working copy、revision、recovery の transaction 境界を確認する
- [ ] **R3: `occurrence_operations.ts`（約 363 行）をレビュー** — 難易度 1
  - 長さではなく、移動・複製・削除の不変条件が一責務としてまとまっているか確認する
- [ ] **R4: `models.ts`（約 397 行）をレビュー** — 難易度 1
  - 型カタログであるだけなら維持し、循環依存や feature 間漏洩がある場合のみ分割する
- [x] **R5: Today/Unplaced の filter bar をレビュー** — 難易度 1
  - 入力項目、文言、無効条件が同じ場合だけ小さな View として共有し、一覧の絞り込み処理は各 feature
    に残す
  - 実績: `OutlineFilterBar.svelte` へ表示と入力だけを移し、filter計算とstate
    ownershipは親Viewに維持した
- [ ] **R6: `surreal_work_repository.ts` の merge validation 重複をレビュー** — 難易度 2
  - legacy migration で現在も通る経路だけを対象にし、将来用の抽象化は追加しない
  - 共通化する場合は Memory Store 実装へ依存させず、merge の不変条件を所有する小さな domain module
    に置く
- [ ] **R7: Markdown export と sparse outline の複雑度をレビュー** — 難易度 2
  - tree traversal
    と表示形式、祖先復元と採用条件が独立した変更理由かを確認し、同居が妥当なら維持する
- [ ] **R8: Markdown editor adapter の自己重複をレビュー** — 難易度 1
  - OverType adapter と fallback adapter が共有する selection/scroll 復元を、既存 interface
    を広げず内部 helper にできるか確認する

`advanced_link_resolver.ts`、`date_projection.ts`、Markdown/OPML export にある Map
構築は、現時点では
それぞれの処理に近い単純な実装として維持する。共通の不変条件が見つからない限り、汎用 collection
module には昇格しない。

## 共通の完了条件

- 公開されている挙動、UI 文言、保存形式を変更していない
- RPC と永続化の呼び出し位置が意図せず View に移っていない
- feature ごとの state ownership が一箇所である
- 新しい純粋ロジックには直接テストがある
- 対象の契約テストを新しいファイル境界へ追随させている
- 対象に対応する duplicate/complexity/line baseline が増加せず、解消した登録は削除されている
- `$effect` を追加・移動した場合、目的、依存、cleanup の要否をレビューしている
- `deno task verify` が成功する
