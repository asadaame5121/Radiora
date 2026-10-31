# 縦ツリーモック

`index.html`をブラウザで開く。依存追加・build・Backend接続は不要。

- カード選択、名前/別名での絞込み、詳細表示、pan/zoom/全体表示。
- Blockのダブルクリックか詳細の「本文を編集」で編集。Enterで分割、Shift+Enterで改行、Tab/Shift+Tabで見た目の深さを変更。
- 本文foldとカード開閉は別。参照行は読取り専用で、代表へ移動。
- 補助Relationを表示するとLIKE/FIX/VSも確認可能。
- ダーク/ライトとも`src/ui/styles.css`の既存tokenを直接import。FROM=cyan、選択/FIX=amber、LIKE=violet、VS=redを継承。

表示/操作感を確かめる使い捨てモック。4 Topicの固定世代配置を使い、Svelte
Flow/ELK、Loro、SQLite、共通Undoには未接続。
変更はタブ内のメモリだけで、再読込で初期化される。Tabは構造commandの実装ではなく、階層表示確認用。
実装時は既存Controller/commandとSvelte
Flowへ適合し、このモックのcamera/配置コードを製品へ移植しない。

確認済み: JavaScript構文、fixtureのID/Relation endpoint/世代方向、既存色token参照、差分の空白検査。
未確認: ブラウザの実描画・IME・操作感。自動ブラウザはfile
URLのセキュリティ制限で開けなかったため、手動で確認する。
