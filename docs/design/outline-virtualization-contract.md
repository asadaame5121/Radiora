# Outline仮想化の先行契約（P5）

この文書は実装前に合意する設計契約であり、mainへの実装完了記録ではない。
状態所有と画面復帰は[UI所有契約](ui-state-ownership.md)と
[Outline画面遷移設計](outline-screen-navigation.md)に従う。

## 回帰防止の足場

- 選択と本文draftのownerを変えず、行のmount/unmountで保存済みデータを書き換えない。
- focusは選択receipt・pane・画面originを確認し、描画待ちの後も失効を再確認する。
- caretの0を保持し、古い要求・破棄済みViewからfocusを公開しない。
- 各paneのスクロールをDOM順ではなくpane IDで復元する。復帰位置はdetached snapshotとする。
- 明示移動や失効した復帰は保持スクロールを書き戻さない。focus後にスクロールを復元する。
- ドキュメントと現行公開APIの回帰テストはmainへ先にマージする。skip・ignoreを追加しない。

## 後続実装の責務

1. 純粋計算: 高さのprefix offsets、二分探索、overscan、pin、gapから表示窓を決める。
2. Controller: 論理行ID、測定高さ、表示窓、focus・IME・dragで保護する行を所有する。
   scrollだけではprefix layoutを再計算せず、行変更・高さ変更・幅変更で失効させる。
3. scroll adapter: 実際のscroll ownerを解決し、scroll・resize・owner切替を監視する。
   unmountでlistenerとobserverを解放し、古い公開を抑止する。
4. 復帰・focus adapter: 画面復帰のscroll ownerと行のmount待ちportを扱う。
   mount待ちはViewへ委譲し、selectionやdraftを所有しない。
5. 行View: 行のDOM要素を通知し、破棄時に解除する。gapへのdropは論理行へ解決する。
6. Outline ViewとApp: callbackとderived値を配線し、実装の各境界を有効化する。

## 表示・操作の受入

50行以下は全行表示する。大きなOutlineはviewportとoverscanだけを表示し、
未計測時も初期窓へ制限する。選択、focus、IME composition、dragの対象行はpinで保持する。
pinの前後のgapも含めて全体高さを保存し、スクロールで最終行まで到達できるようにする。
測定高さの変化や行削除では論理行と行内offsetをanchorとして保ち、幅変更で古い高さを失効させる。
mobileではpanel以外のscroll ownerも保存・復元する。

次の項目も受入条件とする。

- 仮想化後も `role="tree"` / `role="treeitem"` が件数・階層・位置を伝える。 `aria-setsize` /
  `aria-posinset` / `aria-level` を設定するか、窓外行の代替提示で同等の情報を伝える。
- 折りたたみ・行削除でfocus対象行またはIME
  composition対象行が消えた場合に、focusを補正する先と決定規則を定める。

各実装PRで先行回帰を再実行し、新APIの直接テストを接続する。最終配線では10,000行の
desktop/mobile表示、2KB本文、anchor、IME・drag、仮想gapへのdropをブラウザで確認する。
元PRの全面整形を取り込まず、追加・削除の合計をPRごとに原則500行程度までに分ける。 性能のrelease
traceとmain/candidate比較はP7に残す。

## レビュー対応後の境界と検証（#361〜#366）

以下はスタック上の対応記録であり、mainへの反映完了ではない。比較baseは main
`a5478fba`（#359/#360反映後）。

- Controllerは構築時の論理行・保護IDの読み取りportを`refreshProjection`で再評価する。
  Viewは他ownerの値をsetterで書き込めず、focus/IME通知はadapterが解決したIDだけを渡す。
- `OutlineScrollAdapter`はowner解決・監視・scroll書込みを、`OutlineVirtualViewAdapter`は
  行observer・rAF・mount待ちのView寿命を所有する。`OutlineViewportAdapter`は復帰文脈を扱う。
- 高さの連続報告は最初の論理anchorへ集約し、ユーザーscrollは未適用補正を失効させる。
  書込み後のmetricsは予測値ではなくDOMから再読込し、ブラウザのclampに従う。
- focus/IME対象が消えた場合、表示中の選択を優先し、なければ旧indexに来た次行
  （末尾では最後の行）を選択Workspaceへ要求する。通常のreceipt/origin確認後にfocusする。
- mount不可と要求失効を区別する。前者はrows/first-itemへfocusしpane scrollを復元する。
  後者からはfocusもscrollも公開しない。port登録前の要求は描画tick後に再確認する。
- ARIAのlevel・posinset・setsizeはDOM窓でなく論理兄弟全体から算出する。

回帰証拠: Controllerの複数高さ報告・介在scroll、DOMのclamp読戻し・frame取消、
mount失敗と失効の区別を単体テストで固定。ブラウザでは10,000行の末尾が実viewport内に入ること、
800pxで`.app-main`がscroll ownerであること、2KB編集中行の画面外mount保持、
大規模OutlineのARIA/axeと折りたたみ後のfocus補正を確認する。

当初、全体verifyにはP5と独立した既存mainのブロッカーがあった。
`diagnostic_log_sink_test.ts`の`createDiagnosticLogSink`と
`desktop_launcher_integrity_test.ts`の`prepareWindowsLaunchers`が未exportでTS2305になり、 mainのCI
run `38656975234`でも同じ2件が失敗していた。

別の前提修正PR #368で、Loggerの例外隔離内での診断ファイル初期化と、ビルド後のWindows
launcher整合性レベル正常化を実装・本番へ接続した。P5先端へ取り込み後、Windowsで
`deno task verify`が完走した（Deno 998件＋4 steps、unit 549件、lint/quality/format/check/build）。
テストskip追加なし。各PRのGitHub CIとマージ状態はPRに記録し、このスタック上の証拠だけで
main反映済みとは扱わない。release traceとmain/candidate比較は引き続きP7に残す。
