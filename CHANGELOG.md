# Changelog

このファイルは、現行PoCに統合された利用者向けの変化を簡潔に記録する。未統合の専用
bookmark上のchangeを提供済み機能としては扱わない。

## Unreleased

## 0.2.1 - 2026-08-05

### Fixed

- Release workflowのSurrealDB CLI検証用SHA-256を正しい値に修正。

## 0.2.0 - 2026-08-05

### Added

- WorkとOccurrenceを分離し、同一の本文を複数の独立した配置から扱えるデータモデルを追加。
- Branch、Revision、Recovery Snapshot、版比較、系統表示、確認付き別稿作成を追加。
- Quick Capture、Today、栞、作業再開位置、閲覧履歴、コマンドパレット、内部参照を追加。
- Sparse Outline、未配置WorkのStub、重複候補、意味関係、発見候補の判断を追加。
- Markdown・OPML export、完全JSON backup／restore、旧backupのmigrationを追加。
- UIの表示導出、低依存パネル、OutlineService内部責務、SurrealDB row／query境界、RPC transportを
  分離し、各領域のテスト境界を整備。

### Changed

- 専用の原稿ビューを廃止し、長文編集モードを中央ペインに展開する操作へ変更。
- 右ペインを可変幅・折りたたみ可能なインスペクターとして再編。
- Markdown本文は、フォーカス時に編集表示、フォーカス解除時にプレビュー表示へ自動切替。
- アウトライン中心の操作に合わせ、未配置箱／Todayフィルター、ナビゲーション、意味関係入力、
  Shift+Enterによるインラインリンク作成を改善。

### Fixed

- 空の未配置Work／Stub、アウトラインpreviewの切れ、空白領域クリック後の選択・フォーカス解除を修正。
- Markdown editor adapterの操作モードをフォーカス状態と同期。

### Docs

- Phase 1〜5とリファクタリングの実施ログを追加。
- Phase 5の原稿ビュー記録に、中央ペインの長文編集モードへ移行した後続UI変更を注記。

## 現行PoCの範囲と既知の制約

- 本記録は現行PoCのリリースノートであり、一般提供済みであることを示さない。
- Revisionの重要度属性、ユーザーが変更できるショートカット設定、原稿投影範囲だけのMarkdown
  export導線は未提供。
- OPMLは階層と本文の交換形式であり、Revisionや意味リンクは復元しない。portable
  MarkdownはRadiora内部IDを保持しない。
- 高密度検索の回帰テストはSparse Outline生成を対象とし、Svelte描画全体の性能を表すものではない。
