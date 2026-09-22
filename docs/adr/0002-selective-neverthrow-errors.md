# ADR 0002: 回復可能な操作境界に neverthrow を限定導入する

## ステータス

Accepted

## 日付

2026-09-22

## コンテキスト

Radiora は Promise ベースの service / storage port、Valibot の入力検証、Svelte の Controller
を持つ。今回必要なのは、呼び出し側が判断できる失敗の種類と原因の保持であり、
アプリ全体の実行モデルや依存管理の置換ではない。

`docs/refactoring-candidates.md` の共通完了条件に従い、UI 文言、公開 RPC、保存形式、
検証順序、transaction / rollback の保証を維持する。

## 比較と決定

| 候補        | 今回の用途との適合                                                                                                     | 判断             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| neverthrow  | `Result<T, E>` / `ResultAsync<T, E>` で既存の同期処理・Promise 境界を段階的に型付けできる                              | 採用             |
| Effect      | 型付きエラーに加え、実行、依存、resource、並行処理を統合できる。局所導入も可能だが、今回その統合の必要性は確認できない | 今回は採用しない |
| 独自 Result | 小さく始められるが、合成・非同期変換・型推論の保守が増える                                                             | 採用しない       |

neverthrow 8.2.0 を直接依存として固定する。Valibot は入力検証を、neverthrow は検証後の
成功・失敗の伝播を担当する。カスタムエラーは標準 `Error` のサブクラスとし、安定した `code` と元の
`cause` を持つ。メッセージの文字列比較で失敗を分類しない。

## 最初の導入範囲

JSON バックアップ復元だけを対象にする。復元前に入力不正を止めることと、保存失敗を区別する
実益があり、既存の復元・rollback 契約テストがあるため。

- `JsonBackupService.restoreResult` は `ResultAsync<復元件数, BackupRestoreError>` を返す。
- `invalid-json`: JSON の構文エラー。
- `invalid-backup`: envelope、migration、snapshot 検証の失敗。
- `unsupported-version`: 対応していない schema version。既存の形式・版チェック順を保つ。
- `restore-failed`: 検証後の `restoreGraphState` 呼び出しの失敗。
- 既存の `restore` は `.match` で結果を消費し、失敗時はカスタムエラーを throw する互換境界。
  OutlineService / RPC / UI は従来の Promise / 例外契約と表示文言を維持する。
- Result インスタンスや Error の prototype を RPC で送信しない。将来 UI が code によって
  分岐する場合は、検証可能な plain object の通信契約を別途設計する。

decode は既存の例外ベース migration / validator を境界で変換する。旧実装由来の例外を
入力不正にまとめるため、内部不具合との完全な区別はできない。原因を保持し、validator
自体の型付けは別の変更で扱う。保存失敗も DB エラー種別までは推測しない。

## 導入規則と対象外

1. 呼び出し側が回復・再試行・中止を判断する境界にのみ Result を導入する。
2. 同期例外は `Result.fromThrowable`、同期 throw も起こり得る Promise port は
   `ResultAsync.fromThrowable` で変換する。`fromPromise(port())` では同期 throw を捕捉できない。
3. `.match` / `isErr` / 合成で結果を消費する。production で `_unsafeUnwrap` を使わず、 `unwrapOr`
   で保存失敗を成功値に変換しない。neverthrow 単体は結果の無視を禁止しないため、
   当面はレビューと失敗経路のテストで担保する。ESLint の追加導入は行わない。
4. 内部の不変条件違反、純粋計算、全 CRUD、autosave、bootstrap を一括変換しない。 cancellation、retry
   policy、DI、resource 管理の新設も今回の対象外。
5. 自動 retry を追加しない。transaction と rollback は引き続き storage が所有する。

## 結果と検証

既存 API と型付き API が併存する移行コストを受け入れ、まず一つの操作で適用範囲を固定する。
入力失敗時の書き込みゼロ、同期・非同期の保存失敗、cause 保持、復元件数、既存 migration と
rollback、RPC 互換性をテストする。Effect は、複数 feature にまたがる取消・resource・依存管理
の統合が必要になった時点で再検討する。

## 参考

- [neverthrow 公式 README](https://github.com/supermacro/neverthrow)
- [Effect: Expected Errors](https://effect.website/docs/error-management/expected-errors/)
- [Effect: Managing Services](https://effect.website/docs/requirements-management/services/)
- [リファクタリング・バックログ](../refactoring-candidates.md)
