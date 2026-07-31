# リファクタリング計画（実施完了）

- 作成日: 2026-07-30
- 完了日: 2026-07-30
- 状態: 完了
- 対象: UI の表示導出、低依存パネル、`OutlineService`、`SurrealGraphStore`、RPC transport

## 目的

大きくなった実装を、振る舞いと公開契約を保ったまま責務単位に分離する。目的は機能追加の
容易化、単体テスト可能な境界の確立、並列作業時の競合面積の縮小である。既存の
`GraphStore` 契約、永続データ、UI 操作の意味を変更しない「抽出優先」の計画とする。

## 対象外

- `GraphStore` 公開インターフェースの変更、schema / migration の追加・変更
- Work・Occurrence・Revision・Semantic Link の意味や整合性規則の変更
- 大規模な Svelte 状態管理方式の置換、画面設計・UI 文言の再設計
- 性能問題を理由とするアルゴリズム変更（計測結果を親が採否判断する）
- #58 の未確定変更、#59 の schema / storage / migration 変更の取り込み

これらが必要になった場合は、当該 work package を停止し、親が別の設計・実装タスクとして
扱う。

## 現状根拠

| 観点 | 現状 | 根拠 |
|---|---|---|
| UI | `src/ui/App.svelte` は約100 KBで、RPC transport、状態、派生値、イベント、複数画面のマークアップを持つ | `api` の `Proxy`、`buildVisibleRows`、各 view mode とパネルが同居している |
| 表示導出 | 通常アウトラインの行生成は `buildVisibleRows` で、snapshot・閲覧投影・一時展開状態から導出できる | `App.svelte` の `$derived.by` と同ファイル内関数 |
| サービス | `OutlineService` は Occurrence 操作、検索 / Query 投影、Semantic Link、発見候補などをまとめて公開する | `src/services/outline_service.ts` の公開メソッド群。既存の `outline_service_test.ts` と `sparse_outline_test.ts` が振る舞いを覆う |
| 永続化 | `SurrealGraphStore` は row→domain 変換、SurrealQL 組み立て、集約の読み書きを同居させる | `src/storage/surreal_store.ts` の `*FromRow` 関数、transaction / query、クラスメソッド |
| 通信 | `App.svelte` と `AdvancedLinkEditor.svelte` に似た RPC `Proxy` がある | `/api/rpc/<method>` への `fetch` を各コンポーネント内で生成 |
| 回帰境界 | UI 契約、サービス単体、Surreal store、投影のテストが既にある | `tests/*_ui_contract_test.ts`、`src/services/*_test.ts`、`src/storage/surreal_store_test.ts` |

## 優先順位と依存関係

```text
#58 完了 ──> WP1 View Model 抽出 ──> WP2 低依存パネル分割
         └────────────────────────> WP5 RPC adapter 抽出

#60 高密度テスト ──────────> WP3 OutlineService 段階分離
#59 完了 ──────────┬───────> WP3 OutlineService 段階分離
                  └───────> WP4 SurrealGraphStore 分離
```

1. **WP0: #60 の高密度テストを性能基準線にする**。探索・投影の分離前に、検索結果数、祖先文脈、順位理由、実行時間の観測基準を固定する。
2. **WP1: outline view model の純粋関数抽出**。#58 完了後、最小の新規ファイル中心で、`App.svelte` の責務を安全に減らす。
3. **WP2: 低依存パネル分割**。WP1 の表示境界を使い、画面単位でコンポーネントを切り出す。#58 が `App.svelte`、bindings、vocabulary を変更中のため、#58 完了・親の統合確認後にのみ着手する。
4. **WP3: `OutlineService` を façade のまま段階分離**。#59 と #60 完了後に、公開 API を保ったまま内部協調だけを Occurrence / Semantic Link / Discovery に分ける。
5. **WP4: `SurrealGraphStore` の mapper / query 分離**。#59 が schema、storage、migration に触るため、#59 完了後の schema を基準に着手する。
6. **WP5: RPC adapter 抽出**。#58 完了後、WP2 と同時に `App.svelte` を編集しない時期を選び、コンポーネントから通信詳細を外す。

WP1 と WP3 は異なる新規ファイルを排他的に所有できる場合のみ並行可能とする。WP1、WP2、
WP4、WP5 は hot spot に触れるため、同じ領域の変更と重ねず逐次実施する。

## 実施結果

| Package | change | bookmark | 結果 |
|---|---|---|---|
| WP0 | `llvsnosl` / `8d74ab0e` | `codex/refactor-wp0-density-baseline` | 3,000 Work・500一致・24,000リンクの共通fixtureと、検索・Sparse Outlineの性能回帰境界を追加 |
| WP1 | `lrqlrrnp` / `eae2e131` | `codex/refactor-wp1-outline-view-model` | 通常アウトラインの行導出を純粋view modelへ抽出し、collapse・stash・hoist・reference stubを単体テスト化 |
| WP2 | `vklouqyn` / `0b9a87de` | `codex/refactor-wp2-duplicate-panel` | 重複候補画面をprops / callback境界へ分離し、RPC・状態・確認処理を親へ維持 |
| WP3 | `plnqossy` / `45a1d634` | `codex/refactor-wp3-outline-facade` | `OutlineService`の公開APIを保ち、Occurrence / Semantic Link / Discoveryを独立モジュールへ分離 |
| WP4 | `xmyywpuw` / `e477c329` | `codex/refactor-wp4-surreal-boundaries` | Surreal row mapper・Record ID正規化・transaction query builderをI/O本体から分離 |
| WP5 | `norxxowu` / `fd8aa6bb` | `codex/refactor-wp5-rpc-adapter` | UIのRPC transportを共有adapterへ集約し、両コンポーネントのエラー契約を統一 |

各packageは確定前に`deno task verify`を通し、最後のWP5時点で356テスト、Svelte型検査、
本番ビルドが成功した。`GraphStore`、schema、migration、`RadioraBindings`の公開契約は変更して
いない。

## 作業パッケージ

### WP0: 高密度テストを性能基準線にする

- **対象責務**: `searchItems` と Sparse Outline 投影の性能・選択文脈を、決定的 fixture で観測する。
- **想定ファイル**: 新規 `tests/high_density_search_performance_test.ts`、新規 `tests/support/high_density_graph_fixture.ts`。既存テストの変更は親の承認を必要とする。
- **不変条件**: fixture 生成時間を測定に含めない。検索結果の score / reasons、祖先、直接リンク文脈を失わない。性能劣化を見つけても本体実装はこの package で変更しない。
- **既知のギャップ**: `buildSparseOutline` は祖先ノードを生成するが、UI が選択後の祖先展開に使う `breadcrumb` を設定しない。UI の再展開まで #60 に含める場合は、テスト追加と本体修正を分けて親が判断する。
- **検証**: 高密度テストの単独実行、`sparse_outline_test.ts`、`outline_service_test.ts`。閾値、fixture 規模、中央値の取り方は、実装着手前に親が #60 の受け入れ条件として確定する。
- **停止条件**: テストを成立させるため production code の変更、閾値の再定義、`breadcrumb` を含む UI 選択状態の仕様判断が必要になった場合。
- **推奨担当**: Codex Cloud（既定は読み取り専用。実装時も新規テスト・fixture の排他的範囲のみ）またはローカル子。

### WP1: outline view model の純粋関数抽出

- **対象責務**: `buildVisibleRows`、stash の扱い、`referenceStub` による子孫抑止、collapse と一時展開、`projectBrowsingOutline` の結果からの行列挙を UI 非依存の関数へ移す。
- **想定ファイル**: 新規 `src/ui/outline_view_model.ts`、新規 `src/ui/outline_view_model_test.ts`、変更 `src/ui/App.svelte`。`VisibleRow` 型も新規モジュールから export する。
- **不変条件**: `orderKey` 順、hoist 中は stash を表示しないこと、reference stub の子を展開しないこと、永続化を行わないこと、選択・閲覧履歴の状態遷移を変えないこと。
- **検証**: view model のユニットテスト（根、子、collapse、一時展開、stash、hoist、reference stub）、既存の browsing state / UI 契約テスト、親による全体 `deno task verify`。
- **停止条件**: `App.svelte` 外へ Svelte rune / DOM / RPC 状態を移す必要が出た場合、既存 UI の表示差を説明できない場合、`App.svelte` が他担当の編集範囲である場合。
- **推奨担当**: ローカル子（`App.svelte` は親が排他的所有を確認してから）。Cloud はまず抽出候補・テスト表の読み取り調査のみ。

### WP2: App の低依存パネル分割

- **対象責務**: `unplaced`、`stubs`、`duplicates`、`trash`、Inspector 内の独立パネルを、props と callback を持つ表示コンポーネントへ段階的に分離する。最初は `duplicates` または `stubs` の一画面だけに限定する。
- **想定ファイル**: 新規 `src/ui/<PanelName>Panel.svelte`、新規対応 contract test、変更 `src/ui/App.svelte`。既存の `AdvancedLinkEditor.svelte`、`SparseOutlineView.svelte` を形式上の先例とする。
- **不変条件**: 親だけが RPC 呼び出し、グローバル状態、navigation state、confirmation dialog を保持する。UI 文言は vocabulary 経由。候補の採用・却下・統合などの明示操作は #58 の意味を維持する。
- **検証**: 抽出対象の UI 契約テスト、親から渡す props / callback の単体確認、既存 `duplicate_candidates_ui_contract_test.ts` 等、親による全体 `deno task verify`。
- **停止条件**: bindings / `ui_vocabulary.ts` / `App.svelte` を別担当が変更中の場合、共有状態の所有者が二重になる場合、表示のために domain 型または RPC 契約を変える必要がある場合。
- **推奨担当**: 親が設計と `App.svelte` の差分をレビューし、ローカル子が一パネルずつ実装。Cloud は各パネルの依存グラフ・抽出順の調査に限定。

### WP3: OutlineService を façade のまま段階分離

- **対象責務**: `OutlineService` の公開メソッドを維持しつつ、(a) Occurrence / Work 操作、(b) Semantic Link、(c) 検索・Saved Query・Discovery / emergence の内部協調へ切り出す。
- **想定ファイル**: 新規 `src/services/occurrence_operations.ts`、`semantic_link_operations.ts`、`discovery_operations.ts`（名称は着手時に確定）、各ユニットテスト、変更 `src/services/outline_service.ts`。既存個別サービスを再利用し、重複実装しない。
- **不変条件**: `RadioraBindings` と `GraphStore` の公開契約を変えない。Work / Occurrence / Revision の原子性、Semantic Link の `origin`・`status`・`reason`、検索の score / reasons、投影が store に書き込まないことを維持する。
- **検証**: `outline_service_test.ts`、`sparse_outline_test.ts`、検索・発見候補・リンク比較関連の既存テスト。各抽出モジュールは dependency を fake store で単体テストし、親が全体 `deno task verify`。
- **停止条件**: 依存の循環、公開 API の変更、複数 store 実装にまたがる修正、transaction の意味変更、#59 と対象領域が重なる場合。
- **推奨担当**: 親が分割境界と constructor 依存を決定。ローカル子は一責務・新規ファイルのみ実装。Cloud は事前に public-method-to-dependency 表と既存テスト対応表を作る。

### WP4: SurrealGraphStore の row mapper / transaction query 分離

- **対象責務**: `Row` から domain model への変換、Record ID 正規化、SurrealQL の statement / transaction 組み立てを、store 本体から分離する。集約単位の永続化メソッドは `SurrealGraphStore` に残す。
- **想定ファイル**: 新規 `src/storage/surreal_row_mapper.ts`、新規 `src/storage/surreal_queries.ts`、各テスト、変更 `src/storage/surreal_store.ts` と既存 `surreal_store_test.ts`。実際の型・関数の移動単位は #59 完了時点の構造に従う。
- **不変条件**: `domainId` と optional Record ID の検証、null / optional field の変換、query variables の使用、transaction の全成否、migration 実行順、既存 schema を保持する。mapper は I/O を持たず、query builder は DB 接続を持たない。
- **検証**: mapper の table-driven test、query の文字列・variables 契約テスト、既存 `surreal_store_test.ts`、利用可能な Surreal integration test、親による全体 `deno task verify`。
- **停止条件**: schema / migration / `GraphStore` の変更が必要な場合、既存 transaction を部分的にしか再現できない場合、#59 が未統合または storage を編集中の場合。
- **推奨担当**: 親または Sol・medium が transaction 境界をレビュー。ローカル子は mapper または query module のどちらか一方を排他的に実装。Cloud は #59 後の row / query inventory を読み取り調査する。

### WP5: RPC adapter 抽出

- **対象責務**: `/api/rpc/<method>` への `fetch` とエラー正規化を、コンポーネントから共有 adapter に移す。`App.svelte` と `AdvancedLinkEditor.svelte` は同じ生成規則を使う。
- **想定ファイル**: 新規 `src/ui/rpc_adapter.ts`、新規 `src/ui/rpc_adapter_test.ts`、変更 `src/ui/App.svelte`、`src/ui/AdvancedLinkEditor.svelte`。必要になるまでは bindings の変更を含めない。
- **不変条件**: method path、POST、JSON body `{ args }`、`content-type`、成功時の `payload.result`、失敗時の `payload.message` 優先のエラーを維持する。コンポーネントは `RadioraBindings` 型を保つ。
- **検証**: fetch mock を使う adapter 単体テスト（成功、JSON error、HTTP error、method name）、既存 UI 契約テスト、親による全体 `deno task verify`。
- **停止条件**: 認証、streaming、retry / timeout 方針など transport 意味の新規設計が必要な場合、RPC path / payload の後方互換性を変える必要がある場合。
- **推奨担当**: ローカル子。Cloud は二つの既存 Proxy の差分調査とテストケース提案のみ。

## 競合回避と分業

- 着手前に親が `jj status` と `jj diff --git` を確認し、base revision と編集可能ファイルを担当ごとに固定する。
- `App.svelte`、`src/domain/models.ts`、`src/shared/bindings.ts`、`src/shared/ui_vocabulary.ts`、`src/storage/graph_store.ts`、migration 登録、lockfile は hot spot とし、同時編集しない。
- #58 が触れる App / bindings / vocabulary は完了まで予約領域とする。#59 が触れる schema / migration / storage は WP4 着手まで予約領域とする。
- Cloud は既定で読み取り専用とする。実装を依頼する場合でも、新規ファイルまたは明示された排他的範囲だけを編集可能にし、base revision、不変条件、検証、停止条件を指示に含める。
- ローカル子は一つの work package の一つの責務だけを担当し、共有ファイルの接続変更は親レビュー後に行う。親は Cloud の成果を自動統合しない。
- 生成物、性能測定ログ、診断ファイルは作業ツリーに残さず、コミット対象にしない。

## 完了条件

- WP0 で探索・投影の性能・文脈保持を回帰検知できる。
- WP1 で通常アウトライン表示の導出が純粋関数として単体テストされ、既存表示規則を維持する。
- WP2 で少なくとも一つの低依存パネルが明確な props / callback 境界へ移り、親の状態・RPC 所有が一元化されている。
- WP3 で `OutlineService` は後方互換な façade として残り、内部の責務がテスト可能なモジュールに分離されている。
- WP4 で mapper と query / transaction 構築が分離され、Surreal の変換・原子性・migration 契約がテストで守られる。
- WP5 で RPC transport が一か所に集約され、両 UI から同じエラー契約で利用される。
- 各 package の差分が不変条件・停止条件に反しないことを親がレビューし、統合前に `deno task verify` が成功する。
