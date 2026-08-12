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
