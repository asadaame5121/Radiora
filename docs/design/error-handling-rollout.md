# neverthrow の段階導入計画

更新日: 2026-09-22。 採用方針の正本は [ADR 0002](../adr/0002-selective-neverthrow-errors.md)。
タスクの進捗は [リファクタリング・バックログ E](../refactoring-candidates.md) で管理する。

## 現在地と着手条件

PR #202 では JSON バックアップ復元にだけ導入済み。以下は今後の実装計画であり、
この文書の追加で導入範囲を広げたわけではない。実施日・リリース番号は未定。

次の作業候補は E2（Working Copy autosave）。E1 のレビュー・取り込み後、 一つの操作境界を一つの PR
として進める。失敗の種類を増やす前に、利用側がその違いで
どの処理を変えるかを決める。単に同じメッセージを表示するだけなら、その境界の移行は保留する。

| 順位     | タスク | 対象と導入理由                                                                      | 着手の前提                                              |
| -------- | ------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1        | E2     | Working Copy autosave: 下書き保持、明示的な再保存、flush 時の中止を型付き結果で扱う | E1 の取り込み。保存状態の owner と既存呼び出し側を確認  |
| 2        | E3     | startup / storage bootstrap: 設定修正、移行案内、起動再試行を区別する               | A4 と同じ責務境界を使う。App の同時編集を避ける         |
| 3        | E4     | OPML import: 入力修正が必要な失敗と読込・保存の失敗を区別する                       | O1 の入力契約と既存 import の原子性を確認               |
| 条件付き | E5     | rule query: 構文修正と実行上限超過を区別する                                        | D5 / A1b を進める機会に、利用側の分岐に実益があるか判断 |

E3 と E4 は依存関係を持たないため、実際の feature 開発に合わせて順序を入れ替えてよい。
以下のエラー分類は候補であり、公開する code 名は各 PR で確定する。

## E2: Working Copy autosave

対象: `src/services/working_copy_autosave.ts` と `src/ui/editor_controller.svelte.ts` の接続部分。
現状は `#runWorker` が下書きと失敗状態を保持して再 throw し、timer 側がその rejection を
消費する。`flush` は全 Branch の完了を待ってから最初の失敗を返す。

- 内部 worker / flush の保存失敗を Result で伝播し、timer と明示 flush がそれぞれ結果を消費する。
  外部の Promise / 例外契約は、利用側の同時移行が必要な範囲を確定するまで互換境界で維持する。
- 保存失敗には該当する Work / Branch / Occurrence と cause を保持する。
  本文そのものをエラーやログへ複製しない。通信越しの失敗原因をメッセージから推測しない。
- 完了条件: 失敗時に未保存本文が残る、失敗した保存を saved 扱いしない、明示 retry で最新本文を
  保存できる、Branch ごとの直列化と flush の全件待機・最初の失敗の順序を維持する。
- 保存中の追加入力、選択変更、複数 Branch の一部失敗、timer 発火時の失敗も固定する。 callback
  の内部不具合を保存失敗として握りつぶさない。自動 retry は追加しない。
- 検証: `src/services/working_copy_autosave_test.ts` と
  `vitest/editor_controller.svelte.test.ts`。不足する失敗経路だけ追加する。

`resume_position_autosave.ts` は本文保存と重要度・通知方針が異なる。 既存の `onError`
で十分な間は移行を保留し、失敗を受けた側の処理を変更する必要が生じた場合だけ 別 PR
にする。本文保存とカーソル位置保存を一つの汎用 coordinator に統合しない。

## E3: startup / storage bootstrap

対象: `src/storage/storage_bootstrap.ts` と A4 で整理する startup owner。 設定不正、旧 Surreal
データの移行未完了、ストレージ初期化失敗を区別する。

- 設定不正は設定修正、移行未完了は移行案内、初期化失敗は診断と明示的な再試行へ接続する。 permission
  / disk-full / corruption 等の細分類は adapter が確実に判定できる場合だけ追加する。
- 完了条件: 初期化失敗後の close、元の失敗原因の保持、stop の冪等性、旧データの保護を維持する。
  close 失敗で初期化失敗を上書きしない。
- UI まで変更する場合は、cache 表示を起動成功と誤認しないこと、retry、unmount 後の応答破棄、 timer /
  listener の cleanup を A4 の契約として検証する。
- 検証: `tests/storage_bootstrap_test.ts`、`tests/startup_snapshot_cache_test.ts`、 startup owner
  の契約テスト。A4 未実施なら bootstrap の境界だけで止める。

## E4: OPML import

対象: `src/services/opml_service.ts` の `import`。
入力構文不正、項目なし、既存データ読込失敗、import 保存失敗を操作の段階で区別する。

- 既存 parser と `importWorkBundles` を使い、検証・bundle 構築・保存の責務を維持する。
- 完了条件: 不正入力では書き込まない。正常時の階層・並び順・件数を維持する。 保存失敗時の保証は
  Memory / JSON / SQLite ごとの既存契約を確認し、部分成功を隠さない。 Result
  化だけで原子性が向上したとは扱わず、保証不足の修正は別作業にする。
- 検証: `src/services/opml_test.ts`、`src/services/opml_service_test.ts`、
  `src/storage/work_bundle_import_test.ts`、`tests/opml_ui_contract_test.ts`。

## E5: rule query（条件付き）

対象: D5 で切り出す query operations の公開操作境界。
構文不正・実行上限超過・元データ取得失敗を区別する候補とする。 parser / evaluator の各内部関数を一括
Result 化しない。

完了条件: 既存の診断文言・実行上限・代表 occurrence の選択・非永続化契約を維持する。
想定外の内部例外を一律に「構文不正」へ変換しない。
`src/services/discovery_rule_query_operations_test.ts` と A1b の Controller テストで確認する。

## RPC と共通完了条件

- service 内の型付けは既存 RPC を維持して進められる。UI が backend の code に応じて分岐する
  段階では、先に通信契約を定義する。Result / Error インスタンスをそのまま送らない。
- 通信契約を追加する場合は、plain object の許可した code と表示用 message を runtime validation
  し、HTTP RPC と Desktop binding の両経路を揃える。不明な code は一般的な失敗へ戻す。 cause / stack
  / 内部パスを自動的に外へ送らない。通信失敗は業務上の失敗と別に扱う。
- 各 Result に、消費・合成・互換例外変換のいずれかの利用側を必ず用意する。 新旧 API
  の併存は移行中のものとし、旧呼び出し側がなくなった時点で互換口の削除を検討する。
- 保存形式、transaction、rollback、state ownership、既存 UI 文言を維持する。
  文言・再試行方針等を変える場合は、挙動変更として明示する。
- 対象の契約テスト、型検査、lint、品質ゲートと `deno task verify` を実行する。
  環境由来の既存失敗は変更前でも再現し、新規失敗と分けて記録する。
- ADR の採用判断を変える場合は新しい ADR を作る。進捗と候補の見直しは本計画とバックログに記録する。

全 GraphStore CRUD、純粋計算、既に fallback で処理できる preference 読込、
任意機能の失敗等への横断的な置換は予定しない。個別 feature のエラーを巨大な共通 union に集めず、
各操作で扱える型に保つ。
