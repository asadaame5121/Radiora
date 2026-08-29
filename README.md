# Radiora

本文主体のアウトライナーです。思索の連鎖を、階層・意味リンク・版として記録し、
読み返しやすい形で再構成することを目指します。すべてのデータはローカルに保存され、
ネットワーク接続は不要です。

技術構成は Deno Desktop (CEF / WebView) + Svelte 5 + SQLite です。現在は技術PoCとして開発中で、
追加の機能とその検証範囲は `CHANGELOG.md` と `docs/` に記録しています。

## 特徴

### アウトラインと編集

- `Enter`で同じ階層へ追加、`Shift+Enter`で改行、`Tab` / `Shift+Tab`で階層変更、 `Alt+↑` /
  `Alt+↓`で並べ替え。
- 本文はフォーカスするとMarkdown編集表示になり、フォーカスを外すとプレビューへ戻ります。
- ヘッダーのクイック入力は配置先を決めずに項目を作り、`未配置箱`で編集・タグ付けしてから
  明示的に配置できます。
- `Ctrl+K`のコマンドパレットでほぼすべての操作にアクセスできます。`Esc`で元の入力位置へ戻ります。
- 項目を選択して`栞`を追加するとヘッダーから再度開けます。作業再開位置は本文のキャレット位置から
  自動保存され、`作業再開位置から再開`で続きから編集できます。
- Outline上部では絞り込み表示、祖先、戻る・進む、新しいペインを利用できます。
  これらの閲覧操作は本文や保存済みの配置を変更しません。
- 長文の編集はインスペクターから`長文編集`を選び、中央ペインに展開して編集します。アウトラインと
  行き来しながら長い本文を編集でき、Markdownプレビューにも切り替えられます。

### 版と復旧

- 保存した内容は変更できない`版`として残り、複数親のDAGとして構成されます。
- `別稿`（Branch）は作業中本文を分離して並行検討するためのものです。`新しい別稿`は名前と影響範囲を
  確認してから作成します。
- `復旧履歴`には編集の過程が保存され、過去の状態との差分を確認してから復元できます。
  復元時は現在の本文を先に復旧履歴へ保存します。
- `全体系統`は思索間の意味リンクと昇格済みの別稿を表示し、`版系統`は選択した思索の版・別稿・
  混成稿の親と復旧履歴への入口を表示します。`版比較`では任意の2版を左右独立スクロールで比較できます。

### 意味関係と検索

- `Ctrl+Shift+L`またはコマンドパレットの`意味関係を追加`で、`source :: TYPE :: target`の三要素を
  確認しながら意味リンクを編集できます。未解決の名前から項目やStubを暗黙には作りません。
- 本文で`[[`を入力すると項目と版の内部参照を選べます。参照は表示名ではなく不変IDを保持し、
  被参照一覧から参照元へ移動できます。
- 本文で`@`を入力するとOmniWindowで意味関係の相手を検索でき、`Shift+Enter`で検索語を
  未配置箱へ新規作成することもできます。
- 検索欄への入力中はタイトルの前方一致候補を表示し、確定後は語彙一致・エイリアス・
  グラフ上の近さを組み合わせて順位付けします。順位の根拠も表示されます。
- `発見`タブでは橋渡し、欠けたリンク、近傍クラスタの提案を表示します。提案は採用・理由付き却下・
  保留を明示的に選べ、採用時だけ提案由来のリンクを作ります。
- `Query`タブでは項目とリンクに対する制限付き・読み取り専用のDatalog風クエリを実行し、
  保存して再実行できます。結果は表またはSparse Outlineで確認します。
- `Stub一覧`では作成経路と文脈を記録した未配置のStubを明示的に作れます。
- `重複候補`ではタイトル・alias・共有タグ・共有リンクに基づくscoreと根拠を確認し、統合・
  `LIKE`・`RELATED`・却下を別々に実行できます。候補は自動統合されません。

### データ交換

- `Markdown参照形式`で、内部参照を保持するRadiora向け、表示名だけを残すポータブル向け、
  解決済みの参照をWikiリンクにするObsidian向けの3形式でOutlineを書き出せます。
- OPMLはOutlineの階層と本文を他のアウトライナーと交換するための形式です。
  Work、Revision、Branch、意味リンクなどを完全に復元する形式ではありません。
- `完全バックアップを書き出す`は全グラフ状態をJSONへ保存します。`完全バックアップから復元`は
  現在の全状態を置き換えるため、先に現在のバックアップを書き出してください。入力全体の検証に
  失敗した場合、現在のデータは変更されません。

### Tree表示

Treeビューでは`Outline / Tree`で切り替え、実時間をX軸にする`Chronology`と、`FROM`系譜の世代を
X軸にする`Lineage`を切り替えられます。`FROM`の循環は世代計算から隔離され、右端の`Knot`列へ
退避されます。表示密度に応じて`Detail / Context / Overview`が切り替わり、Overviewの件数Nodeを
クリックすると対象範囲へ拡大します。

## 動作環境と実行

Windows（x86_64）とLinux（x86_64）で動作します。前提はDeno 2.9以上とNode.js/npmです。

```powershell
npm install
deno task desktop
```

```sh
npm install
deno task desktop
```

`deno task desktop` は事前診断、フロントエンドビルド、bundle生成を行ってからアプリを起動します。
生成済みbundleだけを再起動する場合は `deno task desktop:run` を使用します。アプリが起動したまま
再ビルドすると生成先がロックされるため、先にウィンドウを閉じてください。

データは Windows では `%LOCALAPPDATA%\RadioraV2\turso\radiora.db` に保存されます。JSONストアで
一時的に起動する場合は `deno task desktop:json`、生成済みbundleでは `deno task desktop:run:json` を
使用します。JSONストアは障害調査用の手動フォールバックです。

### 既存のSurrealDBデータからの移行

旧バージョン（SurrealDB）のデータをお持ちの方は、初回起動前に移行タスクを実行してください。
移行には本リポジトリのソースコードチェックアウト、`npm install`、およびSurrealDB CLI 3.x（`PATH`
または `%USERPROFILE%\.surrealdb` に配置）が必要です。

```powershell
deno task storage:migrate:legacy
```

このタスクは既存の `%LOCALAPPDATA%\RadioraV2\surreal\main.db`
を変更せずにコールドバックアップ（`%LOCALAPPDATA%\RadioraV2\turso\migration-backups`）を作成し、SQLite（`%LOCALAPPDATA%\RadioraV2\turso\radiora.db`）へ安全に移行します。未移行のSurrealDBデータが存在する場合、通常起動は安全のために明示的なメッセージで起動を停止します。

### 起動できない場合

1. `deno task desktop:preflight` を実行し、表示される問題を確認します。
2. `Deno Desktop requires Deno 2.9.0 or newer` が出る場合は Deno を更新してください。
3. WindowsではWSL/bashからではなく、PowerShellまたはNushellで実行してください。

アプリは最初に起動状態を表示し、その後ローカルデータを読み込みます。初期化に失敗した場合は
ウィンドウ内に原因と再試行ボタンが表示されます。詳しい記録は
`%LOCALAPPDATA%\RadioraV2\logs\startup.log` にJSONL形式で保存され、同じ内容が標準出力にも出ます。

## 開発

```powershell
deno task verify
```

`verify`はBiome、実装行数・マジックナンバー・重複コードのbaseline ratchet、型検査、
Deno/Vitestテスト、frontend buildを実行します。

- `npm run dev:mock` — Desktop Backendを起動せず、固定の高密度グラフでUIを確認できます。 mock
  APIはViteの`mock`モードだけで有効になり、通常のDesktop起動と本番ビルドでは使用されません。
- `npm run storybook` / `npm run test:storybook` —
  UI状態カタログとそのrender・interaction・a11yテスト
- `npm run test:visual` — 代表storyの画像差分
- `npm run test:mutation:*` — Strykerによるmutation test（parsers / projections / domain / storage /
  controllers）
- `deno task desktop:inspect` + `deno task desktop:audit` — DevTools/CDP監査

OpengrepとGitleaksはSHA-256で検証した固定binaryをCIで実行します。Strykerの全mutationと
coverage・画像差分は週次workflowで実行します。UIのView構成とstate ownershipの指針は `AGENTS.md`
に、リファクタリングの継続候補は `docs/refactoring-candidates.md` にあります。
