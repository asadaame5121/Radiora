# Work Controller mutation testing report

## 対象

- `src/ui/work_controller.svelte.ts`
- `vitest/work_controller.svelte.test.ts`

## 実施内容

feature state の既定値、duplicate key
の正規化、複数理由の表示順、除外操作の冪等性、再読込後の除外維持、 unplaced work
更新後の再取得をテストした。

## 結果

今回の controller mutation run では、`work_controller.svelte.ts` の covered mutant はすべて killed
となった。 未実行の API 経路は `NoCoverage` として別途扱い、今回固定した契約と混同しない。

## 確認コマンド

```sh
npx vitest run --project unit vitest/work_controller.svelte.test.ts
npm run test:mutation:controllers
```
