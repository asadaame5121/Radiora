# Development Guidelines

## Tidy First

機能変更に入る前に、変更対象の責務と境界を確認し、必要な構造整理を先に行う。

### Svelte architecture

- `.svelte` コンポーネントは原則としてViewとし、DBアクセス、ファイルI/O、複雑な状態遷移を書かない。
- featureごとにstate ownershipを1箇所に定める。
- 複数のViewで共有するRuneは、`*.svelte.ts` のControllerまたはViewModelに置く。
- `$effect` は副作用境界として特に警戒し、利用目的、依存関係、cleanupの要否をレビューする。
- 外部I/Oはadapterまたはserviceを経由する。
- 300〜400行を超えたコンポーネントは、責務分割の候補としてレビューする。
- 新機能を追加するときは、実装前に「既存featureに属するか、新しいfeatureとして分離するか」を判定する。

### UI state ownership / Controller contract

- UIを変更する前に [UI所有契約](docs/design/ui-state-ownership.md) を確認する。 Treeは
  [Tree所有契約](docs/design/tree-state-ownership.md)、画面復帰は
  [Outline画面遷移設計](docs/design/outline-screen-navigation.md) も参照する。
- stateごとに正本、owner、writer/公開操作、読み手、寿命、永続化先、失効条件を定める。
  保存済みデータはbackend/API、snapshotは描画キャッシュ、未保存入力はfeature draftとして区別する。
- Controllerは一つのfeatureの状態遷移を所有し、Viewへ読み取り値と操作callbackを渡す。
  生のsetter増設や双方向の`$effect`でowner間の同期を作らない。
- 複数featureの保存・guard・prepare・最新要求確認・同期commitはWorkspaceが調停できる。
  画面を跨ぐ移動は`ScreenNavigationWorkspace.navigate(destination, origin)`を通す。
  commit内部の公開portを呼び出し側へ渡さず、描画後のfocus/caret/scrollも有効性を再確認する。
- 全画面選択とOutline pane位置を区別する。Outline表示中は同じcommitで整合させ、
  別画面の選択で休止中Outlineを上書きしない。初期復元・削除補正はユーザー選択と異なる内部権限とする。
- OutlineScreenStateは復帰文脈のownerとし、live state全体のstoreにしない。
  localStorageのwriterは設定ごとに一箇所。復帰状態の適用と明示ユーザー設定の保存を区別する。
- 非同期公開は要求世代と必要な選択ID/入力範囲/filter key等を検証する。
  旧成功・失敗・finallyから最新stateへ書かず、cancel/disposeでtimer/listener/observerと公開権限を解放する。
  完了したDB書込をUI要求の失効で巻き戻さない。
- 現状と決定した契約の差、後続Issue、回帰シナリオを文書に残す。 完了記録はPRのbase
  branchとmainのsymbol/テストを照合し、積み上げ上の完了とmain反映を区別する。

### Styling

- component固有のCSSは、原則としてそのViewを所有する `.svelte` ファイルの `<style>` に置く。
- `src/ui/styles.css` はreset、design token、typography、app
  shellなど、アプリ全体に適用する基盤だけを置く。新しいfeature固有selectorは追加しない。
- componentを分離するときは、そのcomponentだけが使うstyleも同時に移し、親から子の内部classを指定しない。
- `:global(...)`
  は外部ライブラリとの接続や意図的な全体規則に限定し、利用理由と影響範囲をレビューする。
- 同じ見た目を複数componentで共有したい場合は、global classを増やす前にdesign token、CSS custom
  property、または小さな共通UI componentで表現できないか検討する。
- `<style>` を含めて300〜400行を超えた `.svelte`
  は、styleだけを別置きして行数を減らすのではなく、Viewの責務境界を見直す。

### Module growth

- 既に300〜400行を超えているproduction
  fileへ機能を追加するときは、変更前に既存責務と同じ変更理由か確認する。異なる場合は、新しいmodule/featureへ分ける構造整理を先に行う。
- 行数だけを目的に分割せず、state
  ownership、I/O境界、transaction、不変条件、変更理由を分割単位にする。
- Controller/ViewModelは一つのfeatureの状態遷移を所有し、別featureの状態を便宜的に取り込まない。
- facade、composition root、RPC bindingには配線と委譲だけを置き、ranking、validation、graph
  traversalなどのdomain logicを蓄積しない。
- service/repositoryは必要最小限のfeature-specific portへ依存し、包括的なstore
  interfaceへ安易に依存しない。
- 純粋計算、parser、mapper、validationはI/OやRuneから分離し、新しい境界へ直接testを置く。

### TypeScript safety

- production codeでは `as any`、`as unknown as T`、`as any as T` を使用しない。`as const`、単一の
  `as T`、`satisfies` は許可する。
- JSON、RPC、DB、ファイルなどの信頼境界では、単一のtype assertionもvalidationの代用にせず、runtime
  validationまたはtype guardを置く。
- テストで不正入力を構築するときは二段castを許可する。
- 意図的にPromiseの失敗を無視する場合は、呼び出し先またはrejection
  handlerで失敗を処理し、`biome-ignore` に具体的な理由を書く。
- 空の `catch`、空のrejection handler、未処理Promiseを残さない。別のErrorへ変換してthrowするときは
  `{ cause }` で元の原因を保持する。
- PostToolUseの自動修正ではBiomeのunsafe fixを適用しない。

## Agent tools

ローカルに導入済みの以下の道具を、用途に応じて積極的に利用する。利用可能なMCP toolまたはCLIを使い、
初回はCLIの `--help` やMCPのschemaで現在の引数・出力形式を確認する。

Codex Cloud向けの導入・確認は [Cloudセットアップ](docs/agents/codex-cloud-setup.md) を参照する。
Cloudではセットアップ中にhashline・ffs・ast-grepを導入し、agent実行中はオフラインでCLIを使う。
WindowsでffsがPATH上に見つからない場合は `where.exe ffs` と `$env:LOCALAPPDATA\ffs\bin\ffs.exe`
を確認する。

- **[ffs](https://github.com/quangdang46/fast_file_search)** — 手元のコードベース内のファイル探索、内容検索、
  symbol探索、コード構造の把握、読取りでは、`rg`、`cat`、`Get-Content`より優先する。
  読取りは `ffs read <path> --budget 5000` のようにtoken budgetを指定し、省略された範囲が必要なら
  追加で読む。構造化出力が必要なら `--format json` を使う。
- **rg** — `git log`や`git diff`の出力に対する検索に使う（例: `git diff | rg <pattern>`）。
- **[hashline](https://github.com/quangdang46/hashline)** — 既存ファイルの局所編集に優先する。
  編集前は`hashline read <path>`で対象を確認し、得たhash anchorを使ってpatchする。
  stale readで拒否されたら再読取りしてanchorと変更内容を確認し直す。
  適用前は `--dry-run`、適用後はdiffで変更範囲を確認する。
- **ax** — ネット接続が許可されたローカル環境で、HTTP/APIの取得やWebページの内容抽出に推奨する。
  文書は `ax <url> --md --budget 2000`、要素抽出はCSS selectorを使い、
  status・失敗・出力の省略を確認する。
- **[ast-grep](https://github.com/ast-grep/ast-grep)** — 構文に基づくコード検索・書換えに推奨する。
  関数呼出しや構文パターンを探す場合に使い、書換えは対象言語とmatchを確認してから適用する。
  適用後はdiffと変更に応じた検証で意図した範囲を確認する。

### PowerShellコマンドとの読み替え

コードベース内のファイル操作は、次の用途別対応を優先する。編集前の読取りはhashline、調査の読取りはffsを使う。

| 用途 | PowerShellでの操作 | 優先する道具 |
| --- | --- | --- |
| ファイル探索・一覧 | `Get-ChildItem`（`gci`、`ls`、`dir`）、`Where-Object`でパスを絞る | `ffs find` / `ffs glob` |
| コードベース内の内容検索 | `Select-String`（`sls`）、`Get-Content`と`Where-Object`で行を絞る | `ffs grep` / `ffs multi-grep` |
| 調査のための内容読取り・抜粋 | `Get-Content`（`gc`、`cat`、`type`）、`Select-Object -First/-Skip` | `ffs read <path> --budget 5000` |
| 編集対象の確認・読取り | `Get-Item`（`gi`）で対象を確認し、`Get-Content`で読む | `hashline read <path>` |
| 既存ファイルの局所編集 | `-replace`と`Set-Content`、`Add-Content` | `hashline patch` |
| 新規テキストファイル作成 | `New-Item`、`Set-Content`、`Out-File`、`>` | `hashline write` |
| ファイル名変更・削除 | `Rename-Item`、`Remove-Item` | `hashline rename` / `hashline remove` |
| `git log` / `git diff`の出力検索 | `Select-String`、`Where-Object` | `rg`（例: `git log | rg <pattern>`） |

存在・属性の確認（`Test-Path`、`Get-Item`）、ディレクトリ作成、プロセス・環境変数など、
ffs/hashlineが扱わない用途はPowerShellを使う。属性取得を`hashline read`で代用しない。

実行環境で利用できない場合や対象形式に対応しない場合は、`rg`、通常のreader/editor、
curlなど利用可能な手段へ切り替えて作業を続ける。

## Agent skills

### Issue tracker

Issues are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses the single-context layout. See `docs/agents/domain.md`.
