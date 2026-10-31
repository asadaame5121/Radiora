# フロントエンドDenoテスト移植の実施記録

実施日: 2026-10-31
計画: [frontend-deno-test-migration-plan.md](frontend-deno-test-migration-plan.md)
状態: F1〜F3を実施し、F4の照合結果をこの文書に記録する。

対象はユーザー指定によりフロントエンドに限定する。Tauriホスト、Rustバックエンド、
Loro/旧データ移行、配布、リポジトリ全体のDeno撤去は扱わない。

## 1. 到達点

- `src/ui` のDenoテスト7本と、`tests/` のフロントエンドテスト66本（285件の`Deno.test`宣言、
  実行286ケース）を `vitest/frontend/` へ移し、元ファイルを削除した。テストの二重保守は残していない。
- Denoを使わない実行経路として `npm run verify:frontend:deno-free` を追加した。
  svelte-check、テスト用の型検査、既存Vitest unitプロジェクト、Vite buildを順に実行する。
- CIに `frontend-deno-free` jobを追加した。miseもDenoも使わず、`actions/setup-node` と
  `npm ci` だけで完結する。`required-checks` の集約対象にも加えた。
- Deno側にはバックエンド・デスクトップ・ストレージ・品質スクリプトのテスト111本をそのまま残した。
- 7本の `@ts-nocheck`（Deno import回避用）は全て解消した。

## 2. 移植対応表（F-S1）

旧Denoテストの全ケースに対応先がある。ケース数は旧ファイルの`Deno.test`宣言数で、
`command_service.test.ts`の1件はループで2ケースを生成するため実行数は286になる。

### 2.1 `src/ui`（7本）

| 旧 | 新 | ケース数 |
| --- | --- | --- |
| `src/ui/manuscript_metrics_test.ts` | `vitest/frontend/src/ui/manuscript_metrics.test.ts` | 2 |
| `src/ui/outline_view_model_test.ts` | `vitest/frontend/src/ui/outline_view_model.test.ts` | 11 |
| `src/ui/rpc_adapter_test.ts` | `vitest/frontend/src/ui/rpc_adapter.test.ts` | 2 |
| `src/ui/tree_camera_test.ts` | `vitest/frontend/src/ui/tree_camera.test.ts` | 4 |
| `src/ui/tree_filter_preference_test.ts` | `vitest/frontend/src/ui/tree_filter_preference.test.ts` | 6 |
| `src/ui/tree_layout_test.ts` | `vitest/frontend/src/ui/tree_layout.test.ts` | 3 |
| `src/ui/tree_spatial_index_test.ts` | `vitest/frontend/src/ui/tree_spatial_index.test.ts` | 2 |

### 2.2 `tests/`（66本）

| 旧 | 新 | ケース数 |
| --- | --- | --- |
| `tests/blank_click_deselect_contract_test.ts` | `vitest/frontend/tests/blank_click_deselect_contract.test.ts` | 3 |
| `tests/browsing_navigation_ui_contract_test.ts` | `vitest/frontend/tests/browsing_navigation_ui_contract.test.ts` | 3 |
| `tests/button_style_contract_test.ts` | `vitest/frontend/tests/button_style_contract.test.ts` | 1 |
| `tests/command_ui_contract_test.ts` | `vitest/frontend/tests/command_ui_contract.test.ts` | 4 |
| `tests/commonmark_editor_fixture_test.ts` | `vitest/frontend/tests/commonmark_editor_fixture.test.ts` | 1 |
| `tests/comparison_pane_contract_test.ts` | `vitest/frontend/tests/comparison_pane_contract.test.ts` | 3 |
| `tests/context_menu_ui_contract_test.ts` | `vitest/frontend/tests/context_menu_ui_contract.test.ts` | 3 |
| `tests/date_projection_ui_contract_test.ts` | `vitest/frontend/tests/date_projection_ui_contract.test.ts` | 1 |
| `tests/dogfood_ui_fixes_contract_test.ts` | `vitest/frontend/tests/dogfood_ui_fixes_contract.test.ts` | 3 |
| `tests/duplicate_candidates_ui_contract_test.ts` | `vitest/frontend/tests/duplicate_candidates_ui_contract.test.ts` | 3 |
| `tests/emergence_suggestion_ui_contract_test.ts` | `vitest/frontend/tests/emergence_suggestion_ui_contract.test.ts` | 1 |
| `tests/inline_link_ui_contract_test.ts` | `vitest/frontend/tests/inline_link_ui_contract.test.ts` | 2 |
| `tests/inspector_tabs_ui_contract_test.ts` | `vitest/frontend/tests/inspector_tabs_ui_contract.test.ts` | 5 |
| `tests/internal_reference_ui_contract_test.ts` | `vitest/frontend/tests/internal_reference_ui_contract.test.ts` | 2 |
| `tests/in_app_help_test.ts` | `vitest/frontend/tests/in_app_help.test.ts` | 1 |
| `tests/json_backup_ui_contract_test.ts` | `vitest/frontend/tests/json_backup_ui_contract.test.ts` | 3 |
| `tests/lineage_views_contract_test.ts` | `vitest/frontend/tests/lineage_views_contract.test.ts` | 12 |
| `tests/link_editor_ui_contract_test.ts` | `vitest/frontend/tests/link_editor_ui_contract.test.ts` | 2 |
| `tests/markdown_editor_adapter_contract_test.ts` | `vitest/frontend/tests/markdown_editor_adapter_contract.test.ts` | 3 |
| `tests/markdown_export_ui_contract_test.ts` | `vitest/frontend/tests/markdown_export_ui_contract.test.ts` | 5 |
| `tests/omniwindow_ui_contract_test.ts` | `vitest/frontend/tests/omniwindow_ui_contract.test.ts` | 4 |
| `tests/opml_ui_contract_test.ts` | `vitest/frontend/tests/opml_ui_contract.test.ts` | 2 |
| `tests/options_ui_contract_test.ts` | `vitest/frontend/tests/options_ui_contract.test.ts` | 3 |
| `tests/outline_filter_bar_ui_contract_test.ts` | `vitest/frontend/tests/outline_filter_bar_ui_contract.test.ts` | 1 |
| `tests/quick_capture_ui_contract_test.ts` | `vitest/frontend/tests/quick_capture_ui_contract.test.ts` | 1 |
| `tests/recovery_snapshot_contract_test.ts` | `vitest/frontend/tests/recovery_snapshot_contract.test.ts` | 1 |
| `tests/relation_type_controller_test.ts` | `vitest/frontend/tests/relation_type_controller.test.ts` | 1 |
| `tests/revision_comparison_contract_test.ts` | `vitest/frontend/tests/revision_comparison_contract.test.ts` | 1 |
| `tests/stub_ui_contract_test.ts` | `vitest/frontend/tests/stub_ui_contract.test.ts` | 2 |
| `tests/tag_browser_ui_contract_test.ts` | `vitest/frontend/tests/tag_browser_ui_contract.test.ts` | 1 |
| `tests/theme_ui_contract_test.ts` | `vitest/frontend/tests/theme_ui_contract.test.ts` | 7 |
| `tests/trash_confirmation_dialog_test.ts` | `vitest/frontend/tests/trash_confirmation_dialog.test.ts` | 1 |
| `tests/ui_vocabulary_context_test.ts` | `vitest/frontend/tests/ui_vocabulary_context.test.ts` | 1 |
| `tests/unplaced_inbox_ui_contract_test.ts` | `vitest/frontend/tests/unplaced_inbox_ui_contract.test.ts` | 1 |
| `tests/sparse_outline_view_contract_test.ts` | `vitest/frontend/tests/sparse_outline_view_contract.test.ts` | 19 |
| `tests/manuscript_view_contract_test.ts` | `vitest/frontend/tests/manuscript_view_contract.test.ts` | 1 |
| `tests/app_composition_acceptance_test.ts` | `vitest/frontend/tests/app_composition_acceptance.test.ts` | 6 |
| `tests/tree_layout_test.ts` | `vitest/frontend/tests/tree_layout.test.ts` | 28 |
| `tests/tree_spatial_aggregation_test.ts` | `vitest/frontend/tests/tree_spatial_aggregation.test.ts` | 4 |
| `tests/tree_highlight_test.ts` | `vitest/frontend/tests/tree_highlight.test.ts` | 2 |
| `tests/tree_label_visibility_test.ts` | `vitest/frontend/tests/tree_label_visibility.test.ts` | 2 |
| `tests/tree_collision_contract_test.ts` | `vitest/frontend/tests/tree_collision_contract.test.ts` | 1 |
| `tests/tree_lineage_cycles_test.ts` | `vitest/frontend/tests/tree_lineage_cycles.test.ts` | 2 |
| `tests/virtual_outline_viewport_test.ts` | `vitest/frontend/tests/virtual_outline_viewport.test.ts` | 9 |
| `tests/historical_time_test.ts` | `vitest/frontend/tests/historical_time.test.ts` | 4 |
| `tests/historical_calendar_property_test.ts` | `vitest/frontend/tests/historical_calendar_property.test.ts` | 6 |
| `tests/historical_timeline_test.ts` | `vitest/frontend/tests/historical_timeline.test.ts` | 5 |
| `tests/navigation_state_test.ts` | `vitest/frontend/tests/navigation_state.test.ts` | 3 |
| `tests/theme_preference_test.ts` | `vitest/frontend/tests/theme_preference.test.ts` | 7 |
| `tests/markdown_export_preference_test.ts` | `vitest/frontend/tests/markdown_export_preference.test.ts` | 6 |
| `tests/quick_capture_preference_test.ts` | `vitest/frontend/tests/quick_capture_preference.test.ts` | 4 |
| `tests/tree_projection_preference_test.ts` | `vitest/frontend/tests/tree_projection_preference.test.ts` | 5 |
| `tests/ui_layout_preference_test.ts` | `vitest/frontend/tests/ui_layout_preference.test.ts` | 4 |
| `tests/inline_link_completion_test.ts` | `vitest/frontend/tests/inline_link_completion.test.ts` | 6 |
| `tests/recent_edited_items_test.ts` | `vitest/frontend/tests/recent_edited_items.test.ts` | 8 |
| `tests/command_palette_test.ts` | `vitest/frontend/tests/command_palette.test.ts` | 5 |
| `tests/command_service_test.ts` | `vitest/frontend/tests/command_service.test.ts` | 6 |
| `tests/editor_working_copy_test.ts` | `vitest/frontend/tests/editor_working_copy.test.ts` | 1 |
| `tests/overtype_markdown_editor_adapter_test.ts` | `vitest/frontend/tests/overtype_markdown_editor_adapter.test.ts` | 1 |
| `tests/emergence_toast_test.ts` | `vitest/frontend/tests/emergence_toast.test.ts` | 1 |
| `tests/advanced_link_selection_test.ts` | `vitest/frontend/tests/advanced_link_selection.test.ts` | 2 |
| `tests/high_density_tree_layout_test.ts` | `vitest/frontend/tests/high_density_tree_layout.test.ts` | 2 |
| `tests/sparse_outline_dense_test.ts` | `vitest/frontend/tests/sparse_outline_dense.test.ts` | 1 |
| `tests/ui_concepts_test.ts` | `vitest/frontend/tests/ui_concepts.test.ts` | 2 |
| `tests/ui_vocabulary_test.ts` | `vitest/frontend/tests/ui_vocabulary.test.ts` | 1 |
| `tests/relation_type_definition_test.ts` | `vitest/frontend/tests/relation_type_definition.test.ts` | 13 |

## 3. Deno側に残したテストと理由

### 3.1 `tests/` の30本

| 分類 | ファイル | 残した理由 |
| --- | --- | --- |
| デスクトップ/配布 | `desktop_backup_roundtrip_test.ts`, `desktop_build_backend_test.ts`, `desktop_devtools_contract_test.ts`, `desktop_hmr_contract_test.ts`, `desktop_launcher_integrity_test.ts` | 旧Desktop起動・HMR・配布は計画の対象外。Deno実行と一時ディレクトリに依存する |
| ストレージ/永続化/移行 | `durable_knot_commit_test.ts`, `graph_batch_isolation_test.ts`, `graph_state_relation_types_test.ts`, `graph_store_contract_test.ts`, `graph_store_port_contract_test.ts`, `historical_time_storage_test.ts`, `json_graph_codec_test.ts`, `json_graph_initialization_test.ts`, `legacy_migration_cli_test.ts`, `legacy_surreal_exporter_test.ts`, `legacy_surreal_migration_reader_test.ts`, `memory_store_knot_reconciliation_test.ts`, `portable_content_roundtrip_test.ts`, `schemas_test.ts`, `sqlite_records_test.ts`, `sqlite_store_contract_test.ts`, `sqlite_targeted_failure_contract_test.ts`, `startup_snapshot_cache_test.ts`, `storage_bootstrap_test.ts`, `storage_repository_boundary_test.ts`, `turso_migration_fault_test.ts` | 旧backend実行依存（SQLite/Turso/Deno API/一時ディレクトリ）。ブラウザ側のgraphには公開していない |
| backend結合の受理・性能・配布物 | `deep_outline_acceptance_test.ts`, `high_density_search_performance_test.ts`, `license_index_test.ts`, `performance_fixture_test.ts` | サービスとストレージを組み合わせた受理試験・fixture生成。UI単体では代替できない |

### 3.2 `src/` と `scripts/` の81本

`src/services`・`src/storage`・`src/desktop`・`scripts` のcolocated Denoテストは、
Deno実行・ファイルI/O・ストレージ契約を検証しているため移していない。
UIが利用する純粋なhelper（`recent_edited_items`、`advanced_link_parser`、`sparse_outline`、
`branch_service` など）は、それを検証していた `tests/` 側のテストをVitestへ移しており、
サービス自身のDeno契約テストは元の場所に残している。

## 4. 実行経路（F-S4）

```sh
npm ci
npm run verify:frontend:deno-free
```

| 手順 | コマンド | Deno依存 |
| --- | --- | --- |
| Svelte/TS型検査 | `npm run check`（`svelte-check`） | なし |
| 移植テストの型検査 | `npm run check:frontend-tests`（`tsc -p tsconfig.frontend-tests.json`） | なし |
| Vitest unit | `npm run test:svelte`（`vitest run --project unit`） | なし |
| 本番ビルド | `npm run build`（`vite build`） | なし |

- 新しいランナーやprojectは増やしていない。既存の`unit` projectのinclude
  （`vitest/**/*.test.ts`）が`vitest/frontend/`をそのまま収集する。
- `tsconfig.frontend-tests.json`は`vitest/frontend/**/*.ts`を明示対象にし、
  そこからimportされる`src/domain`・`src/shared`・`src/ui`のproduction codeも型検査する。
  `lib`にES2024を足すのは、`src/storage/invocation_queue.ts`が使う
  `Promise.withResolvers`を型解決するためで、ブラウザ側へDeno型やNode型は足していない。
- CI job `frontend-deno-free`（`.github/workflows/ci.yml`）は
  `actions/setup-node` + `npm ci` + `npm run verify:frontend:deno-free` のみを実行する。
  mise・Deno cache・JSR解決・Deno製wrapperは使わない。

## 5. 成功基準の証拠（F-S1〜F-S8）

| ID | 証拠 | 状態 |
| --- | --- | --- |
| F-S1 対象の網羅 | 第2節の対応表、第3節の対象外理由。未分類の旧テストはない | 完了 |
| F-S2 回帰保全 | 移植286ケースをVitestで実行し全件通過。skip/todoの新設、assertion削除、期待値の緩和なし。既知失敗はなし | 完了 |
| F-S3 型安全 | 7本の`@ts-nocheck`を削除。`tsc -p tsconfig.frontend-tests.json`が0エラー | 完了 |
| F-S4 Deno不要 | `frontend-deno-free` job。Deno未導入のrunnerで依存導入→テスト→型検査→build | 完了 |
| F-S5 実行境界 | テスト内のファイル読取りは`node:fs/promises`の`readFile(new URL(...), "utf8")`のみ。ブラウザ実行graph（`index.html` → `src/ui/main.ts`）にDeno/JSR/Node I/Oは入らない | 完了 |
| F-S6 分離と失敗検知 | Vitestの既定どおり失敗で非ゼロ終了。`localStorage`差替えは既存fixture、`fetch`ポート注入は`rpc_adapter`で毎回ローカルに閉じる | 完了 |
| F-S7 既存gate保全 | 旧Deno suiteは対象外111本を維持。移したファイルは削除済みで、unitプロジェクトとDeno suiteのどちらにも二重収集されない | 完了 |
| F-S8 計測の説明 | 移動分は`unit`集計へ移った。`coverage:frontend`のbaseline更新はrunner差の確認後に行うfollow-up | 一部未完了 |

## 6. 移植時に意図的に変えた点

- **テストAPI**: `Deno.test` → `test`、`jsr:@std/assert` → `vitest`の`expect`。
  `assertEquals`/`assertNotEquals`/`assertStrictEquals`/`assertNotStrictEquals`は
  それぞれ`toEqual`/`not.toEqual`/`toBe`/`not.toBe`へ対応させた。
  `assertMatch`/`assertNotMatch` → `toMatch`/`not.toMatch`、`assertStringIncludes` → `toContain`、
  `assertFalse` → `toBe(false)`、`assertExists` → `toBeDefined`。
  深い比較と参照同一性の区別は維持している。
- **throw/rejection**: `assertThrows`/`assertRejects`は、型とメッセージ部分一致を
  1回の実行で検査するため`vitest/frontend/support/expect_errors.ts`の
  `expectThrown`/`expectRejected`へ移した。内部はネイティブの`expect`で、
  Deno APIの互換層ではない。関数の二重実行はしない。
- **narrowing**: Denoの`assert`はTypeScriptのassertion signatureを持つため
  `assert(value)`の後で値が絞り込まれていた。Vitestの`expect`にはその性質がないので、
  絞り込みが必要な箇所だけ明示的なガード（`if (!value) throw new Error(...)`）に置き換えた。
  検査内容とメッセージは同じ。
- **ソース読取り**: `Deno.readTextFile(new URL(...))` → `readFile(new URL(...), "utf8")`
  （`node:fs/promises`）。cwd依存は増やさず、パスは`import.meta.url`基準のまま。
- **型宣言**: `commonmark`は型宣言を同梱しないため、fixtureテストが使うAPIだけを
  `vitest/frontend/support/commonmark.d.ts`に宣言した（パッケージ追加はしていない）。
- **nocheck**: `// @ts-nocheck`は全て削除し、テストも型検査対象にした。

## 7. 変更した配線

| 対象 | 変更 |
| --- | --- |
| `package.json` | `check:frontend-tests`、`verify:frontend:deno-free`、`test:mutation:tree` を追加 |
| `.github/workflows/ci.yml` | `frontend-deno-free` jobと`required-checks`のneedsを追加。mutation matrixに`tree`を追加 |
| `tsconfig.frontend-tests.json` | 新規。テストと、そこから届くproduction codeの型検査 |
| `stryker.tree.config.mjs` | 新規。`tree_camera`/`tree_layout`/`tree_spatial_index`を既存のVitest runnerでmutation対象にする |
| `stryker.projections.config.mjs` | 上記3モジュールをDeno command runnerのbatchから外した |
| `mise.toml` | mutation batchのusageに`tree`を追加 |
| `vitest.unit.config.ts` / `tsconfig.json` | 変更なし（既存のincludeで足りる） |
| `deno.json` / `mise run verify:frontend` | 変更なし。広い既存gateはDenoを維持する |

## 8. この計画の範囲外として残るDeno依存

- `deno task test`（`src`・`tests`・`scripts`のDeno suite 111本）
- `mise run verify:frontend`のDenoステップ（`deno check`、Denoテスト、qualityスクリプト）
- `coverage:deno`と`coverage:ratchet`、`test:changed`/`test:staged`のDeno wrapper
- desktop/HMR/配布（`scripts/desktop_*`、`src/desktop`）
- mutationの`parsers`/`projections`/`domain`/`storage` batch（Deno command runner）
- Storybook/Playwrightは既存のまま（今回のrunner変更の影響を受けない）

これらは「フロントの限定経路がDeno不要」になったことを意味し、
「リポジトリ全体がDeno不要」「Tauri移行完了」ではない。
