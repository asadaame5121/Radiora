# Help Update Controller mutation testing report

全 Controller の比較と `NoCoverage` の原因分析は
[`controller-overview.md`](./controller-overview.md) を参照する。

## 対象

- `src/ui/help_update_controller.svelte.ts`
- `vitest/help_update_controller.svelte.test.ts`

## 実施内容

初期状態、更新なし、更新あり、通信エラー、例外、重複リクエスト、dispose 後の結果、および stale な
成功・失敗の各経路を契約テストとして固定した。特に、エラーと release 情報が同時に返る境界値でも
`unavailable` を優先することを確認する。

## 結果

状態遷移と非同期競合の観測可能な分岐を網羅した。request ID の増減置換は、外部から観測できるのが
一致・不一致だけであり、どちらも request ごとに一意になるため等価 mutant と判断した。

## 確認コマンド

```sh
npx vitest run --project unit vitest/help_update_controller.svelte.test.ts
npm run test:mutation:controllers
```
