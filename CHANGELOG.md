# Changelog

このファイルは、現行PoCに統合された利用者向けの変化を簡潔に記録する。未統合の専用
bookmark上のchangeを提供済み機能としては扱わない。

## Unreleased

## 0.5.1 - 2026-08-29

### Changed

- ナビゲーションを整理し、Optionとヘルプをアイコンに集約。ゴミ箱操作をOption内へ移動。
- インスペクターと上部バーの重複操作を整理し、サイドバーの開閉状態を一貫して扱えるように改善。
- 版系統にアウトラインへ戻る導線を追加し、長文編集や意味関係編集の画面構成を見直し。
- UIコンポーネントのスタイルを責務ごとに分離し、共有デザイントークンと基盤シェルへ整理。

## 0.5.0 - 2026-08-28

### Changed

- 通常デスクトップ実行環境の永続化バックエンドを SQLite へ移行。
- SurrealDB CLI
  および専用サイドカーの通常ランタイム・配布バンドルへの同梱を廃止し、バンドル構成を軽量化。
- 既存の SurrealDB データ（`surreal/main.db`）を安全に移行するための独立 CLI
  ツール（`deno task storage:migrate:legacy`）を提供。
- 未移行の SurrealDB
  データが検出された場合は元データを変更せず明示的なメッセージで起動を停止し、移行案内を表示。

## 0.4.3 - 2026-08-25

### Added

- 異なるWorkをアウトライン上で親子に配置すると、有効な明示リンクがない場合に、保存を伴わない暗黙の`FROM`として系統へ反映。
- Lineageで選択した項目のアウトライン上の祖先・子孫と`FROM`でつながる範囲を強調表示。

### Changed

- 暗黙の`FROM`を意味関係編集画面で区別して表示し、明示リンクがあるWork間では自動導出しないようにした。
- アプリケーションとバックアップ／migration metadataのバージョンを0.4.3へ更新。

## 0.4.2 - 2026-08-18

### Added

- Linux (x86_64)向けのDesktop bundle生成と起動をサポート。`desktop:build`は実行OSに応じて
  `dist-desktop/radiora-v2-windows`または`dist-desktop/radiora-v2-linux`へ出力し、 SurrealDB
  CLI（Windowsは`surreal.exe`、Linuxは`surreal`）を自動で同梱します。
- Linux版でDeno Desktopの`autoUpdate`を起動時に試験実行し、更新を次回起動へstageした結果と
  rollbackを構造化ログへ記録します。Releaseには初回Linux版用の`latest.json`も同梱します。

### Changed

- アプリケーションとバックアップ／migration metadataのバージョンを0.4.2へ更新。

## 0.4.1 - 2026-08-12

### Added

- 発見候補をアプリ内トーストで通知し、候補の存在を作業中に確認できるようにした。

### Fixed

- 別稿配置とインラインリンクの候補をブランチ単位で扱い、作業コピーの再水和や書き換え配置の解決を修正。
- 固定済み配置を読み取り専用にし、別ブランチの本文をリンク候補へ含め、ブランチ関連エラーの表示を明確化。

### Changed

- アプリケーションとバックアップ／migration metadataのバージョンを0.4.1へ更新。

## 0.4.0 - 2026-08-09

### Added

- 前回正常に読み込めたアウトラインと選択位置を先行表示する起動スナップショットを追加。
- 起動失敗時の再試行、Windows上のSurrealDBプロセス復旧、起動準備状態の表示を改善。
- JSONL形式の構造化診断ログを追加し、起動、RPC、静的ファイル、SurrealDBのイベントと処理時間を記録。
- Help画面でGitHub Releasesの最新版を確認し、更新時は安全なリリースページへのリンクを表示。
- キーバインド定義をHelpとドキュメント生成で共有し、`Ctrl+Shift+/` からHelpを開けるようにした。

### Changed

- 大型Svelte Viewをfeature ViewとControllerへ分割し、`App.svelte`の責務を縮小。
- SurrealDBの接続、repository、row mapper、migration、backup、validation境界を分離。
- Memory Storeとサービス層の責務境界を整理し、構造変更を直接検証するテストを追加。
- アプリケーションとバックアップ／migration metadataのバージョンを0.4.0へ更新。

### Docs

- リファクタリングの完了範囲と継続候補を `docs/refactoring-candidates.md` に整理。

## 0.3.0 - 2026-08-06

### Added

- ツリービューに2Dカメラ、Chronology／Lineage投影、衝突ベースLOD、クラスタ検査を追加。
- 全体系統のフィルター、永続化された表示条件、切り出し／表示中／フィルターのサイドバータブを追加。

### Fixed

- ツリーレイアウトのラベル衝突、ズーム時の座標変換、空間ハッシュ境界付近のクラスタ判定を修正。
- 選択Work変更時の系統再取得と、非同期レスポンスの世代管理を追加。

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
