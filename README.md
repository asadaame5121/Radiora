# Radiora v2 Technology PoC

Deno Desktop と Svelte 5 で構築した、本文主体のアウトライナーPoCです。

## 技術判断

当初の主DB候補だった LadybugDB 0.16.1 は、Windows版 Deno 2.9.1 から `npm:@ladybugdb/core`
をロードした際に `LoadLibraryExW failed` となったため、
事前に定めた不採用条件に従い使用していません。SurrealDBは後続の最小probeでDeno Desktopから
利用できることを確認済みです。P3/P5でCRUD、検索、再接続後の永続化、親IDのUUID境界を検証したため、
desktop版の既定ストレージはSurrealDBです。JSONストアは障害調査用の手動フォールバックとして残します。

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

### UIの目視確認

Desktop Backendを起動せず、固定の高密度グラフでOutlineとTreeを確認する場合は次を実行します。

```powershell
npm run dev:mock
```

Treeはヘッダーの`Outline / Tree`から切り替えます。Tree内では、実時間をX軸にする
`Chronology`と、`FROM`系譜の世代をX軸にする`Lineage`を切り替えられます。`FROM`の循環は
Lineageの世代計算から隔離され、右端の`Knot`列へ退避されます。表示密度に応じて
`Detail / Context / Overview`が切り替わり、Overviewの件数Nodeをクリックすると対象範囲へ
拡大します。Nodeへポインターを合わせるかキーボードフォーカスすると、直接接続されたNodeと
Linkだけが強調されます。

`dev:mock`のAPIはViteの`mock`モードだけで有効になり、通常のDesktop起動と本番ビルドでは
使用されません。

### Phase 3 入力とナビゲーションの目視確認

通常アプリまたは`dev:mock`では、次の入力・移動経路を確認できます。

- Outline本文では`Enter`で同じ階層へ追加、`Shift+Enter`で改行、`Tab` / `Shift+Tab`で
  階層変更、`Alt+↑` / `Alt+↓`で並べ替えます。本文右上の表示選択から、Markdown記号を
  確認しながら編集する通常表示、プレーン入力、読み取り専用プレビューを切り替えられます。
- ヘッダーのクイック入力は、配置先を決めずに項目を作ります。作成した項目は`未配置箱`で
  編集・タグ付けし、ルートまたは選択中の項目の子へ明示的に配置できます。
- `今日`では作成と更新を別枠で表示し、前日・翌日・週・任意の日付範囲へ移動できます。
  この表示のための日付親や配置は作成しません。
- 項目を選択して`栞`を追加するとヘッダーから再度開けます。作業再開位置は本文の
  キャレット位置から自動保存され、栞とは別に`作業再開位置から再開`で開きます。
- Outline上部では絞り込み表示、祖先、戻る・進む、新しいペインを利用できます。
  これらの閲覧操作は本文や保存済みの配置を変更しません。
- `Ctrl+K`でコマンドパレットを開き、文字入力、`↑` / `↓`、`Enter`で操作します。
  `Esc`で閉じると元の入力位置へ戻ります。選択中の項目から`新しい別稿`を実行すると、
  名前と影響範囲を確認してから別の作業中本文を作成します。
- `Ctrl+Shift+L`またはコマンドパレットの`リンクを追加`で高度なリンク編集へ移動します。
  `source :: TYPE :: target`の三要素が解決するまで確定できず、未解決名から項目やStubを
  暗黙には作りません。同名候補は表示情報を確認して選択します。
- 本文で`[[`を入力すると、項目と版の内部参照候補を選べます。参照は表示名ではなく不変IDを
  保持し、右側の被参照一覧から参照元へ移動できます。
- リンク、別稿の作業中本文、保存済みの版は、共通の読み取り専用比較ペインで確認できます。

### 版と復旧履歴の目視確認

Phase 2の永続データを確認する場合は、mockではなく`deno task desktop`または
`deno task desktop:run`で通常アプリを起動します。Outlineで思索を選択すると、ヘッダーから
次の表示へ移動できます。

- `全体系統`: 思索間の意味リンクと、明示的に昇格済みの別稿、その確定済み先端版を表示する
- `版系統`: 選択した思索に属する版、別稿、混成稿の親、および復旧履歴への入口を表示する
- `版比較`: 2件以上の版がある場合に、任意の2版を左右独立スクロールで比較する

版系統の復旧履歴では、保存済みの状態と現在の作業中本文との差分を確認してから、
`この状態を復元`または`この状態を稿として保存`を選べます。復元時は現在の本文を先に
復旧履歴へ保存し、過去本文を新しい作業中本文として適用します。復元だけでは版を作りません。

現行PoCでUIから操作できる範囲は、上記の閲覧・比較と既存の復旧履歴の復元・版への昇格です。
通常の版保存、別稿の作成・切替・保管・全体系統への昇格、手動の混成稿作成、復旧履歴の
自動生成と間引きは、service／policyと契約テストまでで、UI導線はまだ接続していません。

### 検索と創発支援

- 検索欄への入力中は、タイトルの厳密な前方一致候補を表示します。確定後は語彙一致、
  明示的なエイリアス、グラフ上の近さを組み合わせ、順位の根拠も表示します。
- 項目を選ぶと、右側の`発見`タブに橋渡し、欠けたリンク、近傍クラスタの提案が表示されます。
  提案は採用、却下、ピン留めできます。
- `Query`タブでは、項目とリンクに対する制限付き・読み取り専用のDatalog風クエリを実行できます。
  `item`、`parent`、`ancestor`、`link`、`title_prefix`、`text_match`を利用できます。

```prolog
?- link("LIKE", From, To).
```

データは `%LOCALAPPDATA%\RadioraV2\surreal\main.db`
に保存されます。JSONストアで一時的に起動する場合は
`deno task desktop:json`、生成済みbundleでは`deno task desktop:run:json`を使用します。

### 起動できない場合

まず次を実行してください。

```powershell
cd v2
deno task desktop:preflight
```

`Deno Desktop requires Deno 2.9.0 or newer` が出る場合は Deno を更新してください。 このPoCの
`desktop:run` はWindows bundle内のlauncher（Deno 2.9.1では`.bat`、2.9.3では`.exe`）を
検出して起動します。WSL/bash からではなく、PowerShell かNushellで実行してください。
WindowsとWSLで同じ `node_modules` を共有しないでください。OSごとにネイティブ依存が異なるため、
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

現在の対象はWork／Occurrenceによる実身・化身、配置ごとに独立した階層・順序・折りたたみ、
化身削除、実身のゴミ箱と復元、本文部分一致検索、標準7種の意味リンク、
循環・孤児OccurrenceのKnot/Stash投影です。同じWorkを複数箇所へ配置しても本文は共有されます。
Phase 2ではこれに加え、変更不能なRevisionと複数親DAG、Branchごとに独立したWorking Copy、
Recovery Snapshotの確認付き復元・版への昇格、全体系統とWork内版系統の分離、
任意2版の本文Diffを契約テストで検証します。

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

通常アプリのbootstrap、RPC、終了処理まで含めてSurrealDBを検査する場合は、通常どおり次を実行します。

```powershell
deno task desktop
```

生成済み通常アプリbundleを使う場合は`deno task desktop:run`です。データは
`%LOCALAPPDATA%\RadioraV2\surreal\main.db`に保存され、旧JSONデータは変更しません。
詳細ログは通常アプリと同じ`startup.log`へ保存されます。調査専用DBを分離して起動する場合は
`deno task desktop:run:surreal-diagnostic`を使用します。

P3/P5で検出された親IDが`outline_item:⟨UUID⟩`形式になる不具合は、親側にも
`record::id(...)`を適用することで修正済みです。詳細は
`docs/log/2026-07-17-surrealdb-detection-implementation.md`を参照してください。
