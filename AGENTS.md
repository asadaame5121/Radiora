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

## Agent skills

### Issue tracker

Issues are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses the single-context layout. See `docs/agents/domain.md`.
