# Navigation Controller mutation testing report

全 Controller の比較と `NoCoverage` の原因分析は
[`controller-overview.md`](./controller-overview.md) を参照する。

## 対象

- `src/ui/navigation_controller.svelte.ts`
- `vitest/navigation_controller.svelte.test.ts`

## 実施内容

既定状態、初期 pane オプション、pane 採番、command palette の範囲補正、空検索、port
未設定、debounce、 stale result、error reporting、omniwindow の件数とカーソル境界をテストした。pane
ID は完全一致する `pane-<number>` のみ採番元として扱うことも固定した。

## 結果

公開 getter/setter と主要な非同期検索遷移を直接観測できるようにした。残る survived mutant は timer
の 内部表現や request ID
の増減などを含むため、今後は実装詳細を検査するテストではなく、競合シナリオを
追加する場合に再評価する。

## 確認コマンド

```sh
npx vitest run --project unit vitest/navigation_controller.svelte.test.ts
npm run test:mutation:controllers
```
