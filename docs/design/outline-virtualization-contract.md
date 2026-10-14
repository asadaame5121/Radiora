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

各実装PRで先行回帰を再実行し、新APIの直接テストを接続する。最終配線では10,000行の
desktop/mobile表示、2KB本文、anchor、IME・drag、仮想gapへのdropをブラウザで確認する。
元PRの全面整形を取り込まず、追加・削除の合計をPRごとに原則500行程度までに分ける。 性能のrelease
traceとmain/candidate比較はP7に残す。
