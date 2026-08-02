# Phase 5 長文と可搬性

- 実施日: 2026-07-30
- storage schema: `6 -> 6`
- backup schema: `6 -> 6`
- 対象Issue: `#61`, `#62`–`#71`
- 状態: closeout検証済み

## 実装した境界

- 任意のOccurrenceを起点に、配下のOccurrenceを順序どおり連続した原稿sectionへ投影する。
  選択されたBranchまたは固定Revisionの本文を使い、参照Stubは展開しない
- 原稿ビューではBranch追従本文を編集でき、固定Revisionは読み取り専用にする。
  `contextualHeading`と本文由来の見出しを区別し、各枝と原稿全体の文字数を表示する
- Outlineを決定的なMarkdown文書へ出力し、Radiora参照を保持する形式、表示ラベルだけを残す
  portable形式、解決済み参照だけをObsidian Wikiリンクへ変換する形式を提供する
- OPML 2.0のOutline階層を出力し、外部OPMLを原子的に取り込む。取り込みではWork、main Branch、
  Working Copy、Occurrenceを作り、既存rootの後ろへ配置する
- Work、Branch、Working Copy、Occurrence、Revision、Recovery Snapshot、意味リンクを含む
  JSON完全バックアップのexportとrestoreを追加した。restoreは入力全体を検証・migrationしてから
  Storeのrestore境界へ渡す
- JSON restore失敗時の既存データ保持を、JSON永続化とSurrealDB restore query契約の両方で
  テストする
- 日本語Markdownと内部参照について、JSON、Markdown、OPMLのUTF-8往復fixtureを追加した
- Desktop binding経由の自動テストとWindows Desktopの実機確認で、空DBへのrestore後の
  件数、ID、リンク方向、本文ハッシュを確認した

## 永続化と互換性

storage schemaとbackup schemaの正準versionは引き続き`6`である。JSON backupは
`radiora-backup` envelope（schema version `6`）で出力し、versionなし入力およびversion
`1`–`5`の入力を段階的にversion `6`へ移行する。migrationは入力ファイルを書き換えず、
現在より新しいbackup schema versionはStoreへ書き込む前に拒否する。

## Issueとchange

- `#62` `bd273727`: Occurrenceから順序付き原稿を投影
- `#63` `006f72c1`: 原稿ビューとBranchを考慮した編集
- `#64` `78e05554`: Markdown参照exportのモード
- `#65` `fbca6ab1`: 原子的OPML import / export
- `#66` `f0f7474d`: JSON完全バックアップexport
- `#67` `fe454779`: transactional JSON restore
- `#68` `ef2ab089`: legacy JSON backup migration
- `#69` `6c4c2d3b`: JSON restore失敗時のデータ保持テスト
- `#70` `9281700f`: 可搬コンテンツround-trip fixture
- `#71` `04598420`: Desktop backup restoreの同一性テスト

## 検証

- 各Issue changeで`deno task verify`を実行し、成功後に専用bookmarkをpushした
- Phase 5統合状態: `393 passed / 0 failed`
- Deno型検査、Svelte検査、production buildに成功した
- Windows Desktopでは、2 Work、2 Branch、2 Occurrence、1 `FIX` linkをexportし、空DBへ
  restoreした後、件数、全ID、linkの方向・種別、Working Copy本文のSHA-256が一致した

## 既知の制約

- 現行のMarkdown exportはOutline全体を対象とし、原稿投影で組み立てた範囲だけを
  一つの原稿として出力する導線はまだない
- portable MarkdownはRadiora内部IDを保持しない。Obsidian形式も、解決済みで表示名が得られる
  参照だけをWikiリンクへ変換する
- OPMLは階層と本文の交換形式であり、既存Workとの同一性照合やRevision、意味リンクの復元は行わない
- JSON backup restoreは将来versionのbackupをdowngradeして復元しない
- Phase 5 changesは専用bookmarkへpush済みで、`main`への統合は別判断とする

## 後続UI変更に関する注記

この記録の「原稿ビュー」はPhase 5実施時点の専用`ManuscriptView`を指す。後続のUI変更では
専用ビューを撤去し、長文編集モードを中央ペインへ展開する構成へ移行した。これは当時の
原稿投影、Branch追従編集、固定Revisionの読み取り専用という実装・検証記録を変更するもの
ではなく、現行UIでの到達経路に関する更新である。
