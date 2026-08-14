# Editor Controller mutation testing report

全 Controller の比較と `NoCoverage` の原因分析は
[`controller-overview.md`](./controller-overview.md) を参照する。

## 対象

- `src/ui/editor_controller.svelte.ts`
- `vitest/editor_controller.svelte.test.ts`

## 評価

既存テストが autosave、resume position、内部参照、inline link completion の複数責務を一つの
controller 境界から検証している。mutation report では未到達箇所が多く、単に assertion
を追加するより先に、 `docs/refactoring-candidates.md` の R1 に沿って state ownership と coordinator
境界をレビューする必要がある。

## 結論

今回、実装詳細に結合したテストを増やす変更は見送った。次の作業単位は R1
の責務レビューとし、autosave、 resume、completion を直接テスト可能な境界へ整理した後、それぞれの
mutation target を分離する。

## 確認コマンド

```sh
npx vitest run --project unit vitest/editor_controller.svelte.test.ts
npm run test:mutation:controllers
```
