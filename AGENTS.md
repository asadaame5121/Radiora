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
