# Radiora v2 Technology PoC

Deno Desktop と Svelte 5 で構築した、本文主体のアウトライナーPoCです。

## 技術判断

当初の主DB候補だった LadybugDB 0.16.1 は、Windows版 Deno 2.9.1 から `npm:@ladybugdb/core`
をロードした際に `LoadLibraryExW failed` となったため、
事前に定めた不採用条件に従い使用していません。SurrealDBは後続の最小probeでDeno Desktopから
利用できることを確認済みですが、旧アプリ統合時のruntime終了原因はまだ特定できていません。
そのためdesktop版の既定値はGraphStore契約を維持したJSON永続ストアとし、SurrealDBは明示的な
診断モードでのみ使用します。

## 実行

前提はWindows版Deno 2.9以上とNode.js/npmです。

```powershell
cd v2
npm install
deno task desktop
```

`deno task desktop` は事前診断、フロントエンドビルド、Deno Desktop bundle生成を行ってから
アプリを起動します。 再ビルドせず生成済みbundleだけを起動する場合は `deno task desktop:run`
を使用します。
アプリが起動したまま再ビルドすると生成先がロックされるため、先にウィンドウを閉じてください。
`desktop:build` はDeno Desktopが再ビルドを拒否しないよう、前回のWindows bundleとその配下の
WebView2ランタイムキャッシュを削除してから新しいbundleを生成します。

データは `%LOCALAPPDATA%\RadioraV2\radiora-v2.json` に保存されます。

### 起動できない場合

まず次を実行してください。

```powershell
cd v2
deno task desktop:preflight
```

`Deno Desktop requires Deno 2.9.0 or newer` が出る場合は Deno を更新してください。 このPoCの
`desktop:run` はWindows bundle内のlauncher（Deno 2.9.1では`.bat`、2.9.3では`.exe`）を
検出して起動します。WSL/bash からではなく、PowerShell かNushellで実行してください。 WindowsとWSLで同じ
`node_modules` を共有しないでください。OSごとにネイティブ依存が異なるため、
bundleのビルドと検査はWindows PowerShell側で `npm install` した依存を使用してください。

アプリは最初に起動状態を表示し、その後ローカルデータを読み込みます。初期化に失敗した場合は
ウィンドウ内に原因と再試行ボタンが表示されます。詳しい記録は
`%LOCALAPPDATA%\RadioraV2\logs\startup.log` に保存されます。

## 検証

```powershell
deno task test
npm run check
npm run build
deno check src/main.ts
```

PoC対象はアウトラインCRUD、階層・順序・折りたたみ、削除時の子昇格、本文部分一致検索、
`LIKE/FIX/VS/IN`リンク、循環する`FROM`のKnot/Stash投影です。

### SurrealDB Desktop probe

通常アプリから独立した最小bundleで、Deno DesktopとSurrealDB SDKの組み合わせだけを検証できます。
Windows PowerShellまたはNushellで、使用するDenoのバージョンを確認してから実行してください。

```powershell
deno --version
deno task desktop:probe
```

probeは次の段階を個別に実行できます。`desktop:probe`はP0をビルドして実行します。

- P0: 生のCLIと生のSDK（対照群）
- P1: 実装中の`SurrealProcess`と生のSDK
- P2: 生のCLIと`SurrealGraphStore`
- P3: `SurrealProcess`、`SurrealGraphStore`、`OutlineService`のCRUDと再接続
- P5: SDKを静的importする別bundleでP3と同じ経路

生成済みbundleの段階を指定して起動する例です。各段階は独立した一時RocksDBを使用します。

```powershell
deno task desktop:probe:run p1
deno task desktop:probe:run p2
deno task desktop:probe:run p3
deno task desktop:probe:run p5
```

画面が閉じた場合も、最後に到達した段階は次のファイルに残ります。

```text
%LOCALAPPDATA%\RadioraV2\logs\surreal-desktop-probe.log
```

### 通常アプリ統合診断（P4）

通常アプリのbootstrap、RPC、終了処理まで含めてSurrealDBを検査する場合だけ、次を実行します。

```powershell
deno task desktop:surreal
```

生成済み通常アプリbundleを使う場合は`deno task desktop:run:surreal`です。診断データは
`%LOCALAPPDATA%\RadioraV2\surreal-diagnostic\main.db`に保存され、JSONデータは変更しません。
詳細ログは通常アプリと同じ`startup.log`へ保存されます。通常の`deno task desktop`および
`desktop:run`は引き続きJSONストアを使用します。

現時点のP3/P5では、再接続後の親IDが`outline_item:⟨UUID⟩`形式になる不具合を再現しています。
このためSurrealDB経路は採用版ではなく原因調査専用です。詳細は
`docs/log/2026-07-17-surrealdb-detection-implementation.md`を参照してください。
