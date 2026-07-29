# Phase 3 入力とナビゲーション

- 実施日: 2026-07-29
- storage schema: `2 -> 3`
- backup schema: `2 -> 3`
- 対象Issue: `#38`, `#39`–`#50`, `#90`
- 状態: closeout検証済み

## 実装した境界

- code、URL、escapeを除外する共通Markdown解析を導入し、タグと内部参照の認識を共通化した
- BranchとRevisionのscopeを保つタグ抽出、補完、AND・除外検索、改名、統合を追加した
- 栞と単一の作業再開位置を別エンティティとして永続化し、配置消失時は同じWorkへ
  安全にフォールバックする
- 作成日と更新日を分けるToday投影と、配置を作らずWorkを作成するQuick Captureを追加した
- Hoist、パンくず、戻る・進む、ペイン単位の履歴を本文と永続配置から分離した
- コマンドの適用条件と無効理由を共通化し、`Ctrl+K`の検索・選択・実行へ接続した
- 別稿作成は名前と影響を表示して明示確認し、キャンセルまたは空名では書き込まない
- Advanced Linkの引用構文、候補解決、同名選択、方向previewを追加した。三要素の解決前は
  確定せず、未解決入力からWork、Occurrence、Stubを暗黙作成しない
- WorkとRevisionの不変IDを用いる`radiora://`内部参照、`[[`補完、解決、被参照表示を追加した
- FROM、FIX、VS、Branch Working Copy、Revisionを共通の読み取り専用ペインで比較する
- Overtype 2.4.0を交換可能なMarkdown editor adapter越しに導入し、通常、プレーン、
  読み取り専用previewとtextarea fallbackを用意した

## 永続化と互換性

栞と作業再開位置の追加に伴い、storage schemaとbackup schemaをversion `3`へ進めた。
version `2`のWork、Branch、Working Copy、Occurrence、Revision、Recovery Snapshot、リンクを
保持し、栞を空集合、作業再開位置を未設定として追加する。

Quick CaptureはWork、main Branch、Working Copyだけを一つの操作で作り、配置を暗黙作成しない。
Today、閲覧履歴、比較、Backlinkは一時投影または読み取り専用であり、本文、永続配置、
意味リンクを変更しない。タグの改名と統合は本文やRevisionを書き換えない。

Overtype固有の型と状態はUI adapter内に閉じ、既存のWorking Copy自動保存境界を維持する。
CommonMark 0.31.2との差は固定fixtureで明示し、Overtypeを正準Markdown parserとは扱わない。

## Issueとchange

- `#39` `00899dee`: Markdown解析
- `#40` `f08be68f`: Branch・Revision scopeのタグ管理
- `#41` `43a31bed`: 栞・作業再開位置とschema version `3`
- `#42` `aafeac52`: Today・日付範囲投影
- `#43` `bd1333dc`: Quick Capture・未配置箱
- `#44` `62e47533`: Hoist・パンくず・閲覧履歴・ペイン
- `#45` `be725a8d`: 共通コマンド定義・ショートカット
- `#46` `b8960443`: `Ctrl+K`コマンドパレット
- `#47` `bb9cd044`: Advanced Link parser
- `#48` `4a483f14`: Advanced Link解決・同名選択・方向preview
- `#49` `18ec2603`: 内部参照補完・解決・Backlink
- `#50` `89f324e6`: 共通比較ペイン
- `#90` `a5bb3d53`: Markdown live preview editor adapter
- `#38`: キーボードからの確認付き別稿作成、リンク入力フォーカス、Phase closeout

## 手動確認

`#90`のchangeでは、本番bundleをWindows Desktopで起動し、日本語Markdown入力、
live preview、自動保存完了、Undo、Redo、読み取り専用previewを確認した。ブラウザのmock環境では
日本語入力、キャレット位置、Undo、Redo、通常・プレーン・previewの切替を確認した。

Phase closeoutでは、ブラウザのmock環境で`Ctrl+K`から確認付き別稿作成を開始できること、
キャンセルと空名では書き込まないこと、`Ctrl+Shift+L`が未解決データを作らず
Advanced Link Editorへフォーカスすることを確認した。Windows Desktopでは、Markdown本文に
フォーカスした状態の`Ctrl+K`がMarkdownリンクを挿入せずコマンドパレットを開き、
別稿作成とリンク追加の両コマンドが有効になることを確認した。

## 検証

- 各Issue changeで`deno task verify`とproduction buildを実行した
- `#90`時点: `218 passed / 0 failed`
- Phase 3統合状態: `219 passed / 0 failed`

## 既知の制約

- Overtypeの初期採用範囲に画像、表、分割previewを含めない
- CommonMarkとの差は既知fixtureとして管理し、完全互換とは扱わない
- 利用者がショートカットを変更する設定UIはまだない
- 化身としての配置、タグ付与、原稿として開く操作はコマンドパレットへ未統合
- `radiora://`はアプリ内部の参照形式であり、OSのURL handlerではない
