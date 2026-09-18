# テスト監査 — 2026-09-12

対象: Radiora `16df242`、監査開始時の working tree は clean。 テスト・production
code・依存関係の変更は行っていない。

## 判定

不要なテストはある。ただし、最大の問題は件数そのものではなく、古い期待値による失敗、
ソース文字列検査への偏り、Controller の未実行経路、カバレッジ集計の不備である。 fast-check
は純粋計算の3領域から限定導入を推奨する。全テストの置換は勧めない。

## 実測と範囲

| 対象                                 | 結果                           | 解釈                                                                       |
| ------------------------------------ | ------------------------------ | -------------------------------------------------------------------------- |
| Deno `src tests scripts`             | 742 passed、12 failed、4 steps | coverage 付き実行。初回1分14秒、独立出力先での再実行1分4秒。同じ12件が失敗 |
| Vitest unit                          | 9ファイル、65件成功、7.59秒    | 行39.04%（440/1127）、分岐25.47%（200/785）                                |
| Editor Controller                    | 行9.74%、分岐1.30%             | unit test は内部参照補完の1ケース                                          |
| Work Controller                      | 行24.79%、分岐11.11%           | unit test は初期状態・理由文字列・候補除外・未配置本文更新の4ケース        |
| Deno coverage                        | 全体率は確定不可               | 新規出力先でも主要28ファイルが Missing transpiled source code で除外された |
| Storybook / Playwright / 実SurrealDB | 今回は未実行                   | テストコードとCI配線を静的確認。現在の成功を保証しない                     |
| Mutation                             | 今回は未実行                   | 既存成果物と設定を確認。過去スコアを現在値として使用しない                 |

ローカルDenoは2.9.6、CI指定は2.9.3。Vitestは4.1.10。
Vitest初回はサンドボックスの親ディレクトリアクセス制限で起動失敗し、許可された再実行で成功した。

テストファイルは168（`src` 76、`tests` 79、`scripts` 4、`vitest` 9）。 これは `_test.ts` /
`.test.ts` / `.spec.ts` の集計であり、Storybookは別枠。 Storybookは11ファイルに26個の `play` 定義。
`contract_test` を名前に含む36ファイルは計2,652行、`Deno.test` の宣言114個。
この集合には有用なDB契約テストも含まれるため、36ファイル全体を削除候補とはしない。
`Deno.readTextFile` 使用51ファイルもfixture読み込みを含み、不要テスト数ではない。

## 優先度の高い指摘

### 1. バックアップの12件は削除ではなく期待値の保守が必要

根拠:

- `src/services/json_backup.ts:26` は現行backup schemaを8と定義。
- `src/services/json_backup_test.ts:52` は出力を7と期待。
- 同ファイル`:148` は8を「未来版」として拒否させている。
- `src/storage/json_store_test.ts:47` ほか9ケースが7を期待。
- 同ファイル`:99` の「未来版8」も現在は対応版。
- `tests/historical_time_storage_test.ts` にはv8出力と歴史日時の保存・移行テストがあり、今回成功。

12件の内訳は、出力版の期待値不一致10件、未来版の前提不一致2件。
観測した失敗は現行v8への追従漏れで説明できるが、最初のassertで停止した後の検証まで成功したとは言えない。
単にテストを削除したりskipしたりせず、修正後に後続assertまで実行する必要がある。

「現在版を出力する」「未対応の未来版を拒否する」テストは現行定数／現行定数+1で追従させる。
一方、v0〜v7の入力fixtureや、その版の変換仕様・原本バックアップの期待値は固定して残す。
現行定数だけに依存すると版そのものの誤設定は検出できないので、v8という公開形式の契約も1箇所で明示する。
DB側のmigration番号とbackup版は別の契約なので、一括置換しない。

### 2. カバレッジ率の母集団が不安定

`vitest.config.ts` は `coverage.include` 未指定。 Vitest
v4の既定は実行時にimportされたファイルのみで、未importのproduction fileは集計外となる。
今回の39.04%はアプリ全体の率ではない。 逆にunit側で0%の `inline_link.ts` や `markdown_parser.ts`
にはDenoの直接テストがあるので、 その0%だけを見てテストを追加すると重複する。

推奨: Controller、純粋domain/service、storage、Viewを分け、担当runnerと集計対象を固定する。
率の単純平均で全体率を作らない。tests/support・fixtureはproduction coverageから除外する。

Denoの新規計測では `json_store.ts`、`sqlite_store.ts`、`json_backup.ts`、 `historical_calendar.ts`
等28ファイルが変換済みソース不足として省略された。
残った104レコードの計算値は行82.20%／分岐84.71%だが、欠損込みの部分値にすぎない。 さらに
`tests/support/graph_store_contract.ts` と `high_density_graph_fixture.ts` が含まれる。
この数字を現行の全体カバレッジや改善実績として使ってはいけない。
新規出力先でも再現するため、既存coverageディレクトリの混在だけが原因とは判断できない。
変換キャッシュ・Denoバージョン等の根本原因の特定は今回の監査では未完了。

`scripts/quality/coverage_ratchet.ts` はLCOVの合計だけを読み、対象ファイルの欠落を確認しない。
欠損・空LCOVで成功し得る（分母0は100%）。必須ファイルと非空の検査が先。
baselineはunit行30.19%／分岐18.77%、Deno行78.73%／分岐83.06%。
自動的に前回値へ更新される仕組みではなく、保存された下限との比較である。 今回 `coverage:deno`
はテスト失敗でLCOV生成まで到達せず、ratchet成功は確認していない。

### 3. Editor / Work の公開操作を優先して補う

`vitest/editor_controller.svelte.test.ts:58` は補完候補の取得・選択移動・取消だけ。
`src/ui/editor_controller.svelte.ts:142` 以降の本文更新からautosaveへの接続、
補完確定・非同期結果の競合・失敗時の状態保護は別途確認が必要。
autosaveサービス自身のDenoテストを複製せず、Controllerとサービスの接続を検証する。

`vitest/work_controller.svelte.test.ts:36` 以降の4ケースには、 quick
captureの保存失敗、trash/purge確認、merge失敗時の画面状態等がない。
実行された公開操作の結果として「失敗時に入力を失わない」「承認前に破壊的APIを呼ばない」を優先する。
内部変数や呼出回数だけのテストは増やさない。

### 4. Storybookの操作テストを全件回すCI経路がない

`package.json` には `test:storybook` があるが、確認したworkflowに呼出しがない。 PRの
`deno task verify` はunitのみ。別jobのUI操作とa11yもStorybook全件の代替ではない。
週次visualは特定storyを開くためそのstoryのplayは動き得るが、
`ArrowLoop`、`DisabledSkip`、`EscapeCloses` など全storyを網羅する構成ではない。

`stories/command-palette.stories.ts:62` 等の既存操作テストをCIで実行してから、
それで代替できる文字列検査を削る。Storybookを動かさず文字列テストだけ削ると検知が消える。

### 5. Mutationは計測用途であり回帰防止ゲートではない

PRは5batchとも `--dryRunOnly`、週次は本実行だが `thresholds.break: 0`。
終了コード成功は欠陥検出力の合格を意味しない。 storage batchは旧Surreal系とmigration中心で、現用
`sqlite_store.ts` は直接のmutation対象に入っていない。
実行時間を使うなら、現用storageのrollback・保存境界を対象に含める価値が高い。
ただし今回CI時間やmutation全実行時間は測っておらず、節約秒数は推定しない。

既存 `reports/mutation/controllers.json` は2026-08-17更新で、Editorの埋込ソースは現行と不一致。
`docs/mutation-testing/controller-overview.md`
は表でEmergence成功を示す一方、本文に未実施の記述が残り、
合計も本文と表が不一致。現在の判断材料として使う前に整理する。

## 削減・統合候補

| 対象                                                              | 判断                   | 削減条件                                                                                                                              |
| ----------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/relation_type_controller_test.ts:4`                        | 即削除候補             | `assertEquals(true, true)` のみ。実体はVitestにあり今回成功                                                                           |
| `tests/blank_click_deselect_contract_test.ts:11`                  | 操作テストへ集約       | `tests/ui/outline-drag.spec.ts` が選択解除・blur・drag中抑止・右クリックを検証。textareaのfocusによる選択も補ってから文字列検査を除く |
| `tests/tree_layout_test.ts:438` と `src/ui/tree_layout_test.ts:7` | 重なるassertを統合     | cluster IDのpan安定性が重複。並べ替え安定性、count保存、セル境界、低倍率の幅予約はそれぞれ保持                                        |
| `tests/button_style_contract_test.ts`                             | ブラウザでの外観確認へ | CSSの文字列・selector位置ではcascade後の見た目を保証できない。該当buttonのfocus/disabled/dark表示を確認してから置換                   |
| `tests/theme_ui_contract_test.ts`                                 | 挙動と見た目へ分離     | 色コード・関数名の文字列検査を整理。theme Controller、a11y、必要なtheme別visualへ。現visualはテーマ全組合せを保証しない               |
| `tests/trash_confirmation_dialog_test.ts`                         | 一部重複を整理         | Confirmationの状態遷移とstoryの操作検証を使う。ただしWork側の承認とAPI接続は別途残す                                                  |
| `tests/graph_store_port_contract_test.ts`                         | 意図を保ち簡素化       | 「包括的GraphStoreへ依存しない」は有用。サービスごとの全port名リスト・正確なimport文字列の固定は減らせる                              |

UI文字列検査の問題は、同じ断片がコメントや到達不能コードに残っても通り、
変数名変更やCSS移動だけで落ちること。全件をPlaywrightへ移すと別の維持費が生じるため、
既存story・Controllerへ寄せ、App接続が重要な少数の利用者操作だけブラウザで残す。

削ってはいけないもの:

- Memory / JSON / SQLiteの共有GraphStore契約。同じ契約を異なるadapterへ適用するのは意図した重複。
- `tests/sqlite_store_contract_test.ts:328` の保存失敗rollbackと`:432` の並行mutation・close待機。
- 旧版backupの原本保護、移行、再open、未来版の無書込み拒否。
- Markdown/OPML/JSONを横断する日本語の往復fixture、OverTypeとCommonMarkの既知差分。
- dense graphの不変性と性能budget。今回不安定さは観測しておらず、削除理由はない。

## fast-checkの採用方針

限定採用を推奨。既存Deno.testの中で使えるのでrunner追加は不要。
導入の主目的はテスト件数や行カバレッジではなく、手書き例が漏らす入力の組合せと最小反例の発見。

| 順序 | 対象                                | 検証する性質                                            | 入力の制約                                                                     |
| ---- | ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | `src/domain/historical_calendar.ts` | 有効日付→座標→日付で一致、連続日の単調性                | 対応年範囲、実在日。BCE・年0・閏年・月末は固定例も残す                         |
| 2    | `src/services/revision_diff.ts`     | equal+removeで左原文、equal+addで右原文を再構成         | CRLF/CRは仕様どおり正規化。空文字は0行として扱い、行数・文字数を上限付きにする |
| 3    | `src/services/opml.ts`              | export→parseで本文・階層・兄弟順を保存                  | 一意ID、存在する親、非循環の小さい木。対応するUnicode・改行・XML記号           |
| 後続 | parser / tree projection            | rangeが入力境界内、入力を変えない、並替えに対する安定性 | 成立する契約だけ。layoutの全順序・全座標を無条件に不変とはしない               |

既存の日付テストは12年×4月の15日と年末境界を手動列挙しているため、PBTとの相性が特に良い。
日付の往復だけでは両関数の同じ誤りを検出できないので、既知の閏年・紀元境界の例は残す。
diffも再構成だけでは最短性や同点時のremove優先を保証しないので、その固定例は残す。
OPMLも自前のexport/parserだけで相互運用性を保証できないので、外部OPMLの固定例を残す。

初期の運用案: propertyごとにPRで100例、必要なら週次で1,000例。
失敗時のseedとpathを保存して再現し、最小反例を通常の回帰例として追加する。
有効な入力を直接生成し、filterでほぼ全件捨てるgeneratorや、実装を写した期待値計算は避ける。 UI
snapshot・CSS文字列・単純な設定読み出しをPBTへ変換する必要はない。
状態機械ベースのDB操作列や非同期schedulerは、最初の3領域で効果を確認してから検討する。
fast-checkのインストールとテスト追加は今回行っていない。

## 推奨実施順

1. 12件の古い期待値を修正し、全assertが成功する状態へ戻す。
2. 無意味な1件を削除。重複は代替側の実行・契約網羅を確認して統合する。
3. coverage欠損の原因を修正し、母集団を固定。Storybook全件をCIへ配線する。
4. Editor / Workの重要な失敗経路を少数の公開操作テストで補う。
5. 日付・diff・OPMLにfast-checkを限定導入し、反例発見と実行時間で継続判断する。

## 再現と出典

実行:

```sh
deno task coverage:deno
npm run coverage:unit
deno test -A --coverage=reports/coverage/audit-20260912-fresh src tests scripts
deno coverage --lcov --output=reports/coverage/audit-20260912-fresh.lcov reports/coverage/audit-20260912-fresh
```

ローカル成果物: `reports/test-audit-deno.log`、`reports/test-audit-deno-fresh.log`、
`reports/test-audit-vitest.log`、`coverage/coverage-summary.json`。
LCOVは欠損を含む参考資料。テスト削除、依存追加、CI変更、mutation再実行は未実施。

公式資料（2026-09-12確認）:

- [Vitest v4 coverage: importされたファイルとincludeの範囲](https://v4.vitest.dev/guide/coverage)
- [fast-check: 生成と失敗入力の縮小](https://fast-check.dev/docs/introduction/)
- [fast-check: 既存runnerでの導入](https://fast-check.dev/docs/introduction/getting-started/)
- [fast-check: seed・path・numRuns](https://fast-check.dev/docs/api/interfaces/Parameters/)
