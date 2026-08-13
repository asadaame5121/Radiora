# Controller mutation testing 全体分析レポート

## 目的と対象

2026-08-13 時点の `npm run test:mutation:controllers` の結果を、単なる成功・失敗ではなく、
Controller ごとのテスト到達範囲と欠陥検出力に分けて評価する。

Stryker は `src/ui/*_controller.svelte.ts` を mutation 対象とし、 `vitest.stryker.config.ts`
に一致する Controller unit test を実行する。この実行は UI、RPC binding、 repository、SurrealDB
を起動する integration test ではない。

## 結果

| Controller   |  Killed | Survived | Timeout | NoCoverage | Covered score | Total score |
| ------------ | ------: | -------: | ------: | ---------: | ------------: | ----------: |
| Confirmation |      39 |        0 |       0 |          0 |       100.00% |     100.00% |
| Help Update  |      27 |        2 |       0 |          0 |        93.10% |      93.10% |
| Navigation   |     111 |       19 |       2 |          6 |        85.61% |      81.88% |
| Work         |      41 |        0 |       0 |        130 |       100.00% |      23.98% |
| Editor       |      16 |       20 |       0 |        600 |        44.44% |       2.52% |
| Emergence    |       0 |        0 |       0 |         73 |      対象なし |       0.00% |
| **合計**     | **234** |   **41** |   **2** |    **809** |    **85.20%** |  **21.73%** |

`Covered score` はテストが到達した mutant に限った検出率であり、`Total score` は `NoCoverage` も
含む。したがって Work の `Covered score` 100% は Controller 全体のテスト完了を意味しない。 171
mutant 中、到達した 41 mutant をすべて検出した一方、130 mutant は未到達である。

全体の 1,086 mutant のうち 809 件（約 74.5%）が `NoCoverage` であるため、合計 21.73% の主因は
到達済みコードの assertion の弱さよりも、Controller の実行経路が unit test から呼ばれていないことに
ある。

## NoCoverage とデータベース接続の関係

### 結論

今回の `NoCoverage` は、データベースへ接続できなかった結果ではない。

Controller は DB を直接参照せず、テストから注入された `api`、`reload`、`getSnapshot` などの port を
呼び出す構造である。Controller unit test はこれらを `vi.fn()`、解決済み Promise、deferred Promise
などで置き換えており、SurrealDB の起動やネットワーク接続を必要としない。

DB 接続失敗が原因なら、通常は dry run または対象テストが rejection、timeout、接続エラーで失敗する。
今回の dry run と unit test は成功しており、Stryker が記録したのは実行失敗ではなく、該当 statement
を 通るテストが選択・実行されなかった `NoCoverage` である。

### Controller ごとの直接原因

- **Emergence:** `vitest.stryker.config.ts` の対象になる `vitest/**/*controller.svelte.test.ts`
  が存在しない。Deno の UI contract test はソース文字列上の境界を 確認するもので、Stryker の unit
  test include には入らないため、73 mutant がすべて未到達になった。
- **Editor:** Controller test は存在するが、570 行の Controller が所有する
  autosave、resume、内部参照、 inline link completion、backlink
  の経路の大部分を実行していないため、600 mutant が未到達になった。
- **Work:** 現在のテストは duplicate candidate と unplaced work 更新を中心に実行する。quick
  capture、stub、 trash/purge、duplicate merge、unplaced link などの操作を呼ばないため、130 mutant
  が未到達になった。
- **Navigation:** 主要経路には到達しており、未到達は6件に限られる。残る課題は `NoCoverage` よりも
  survived 19件と timeout 2件の分類である。

## 判定

### 十分に強い範囲

- Confirmation は全 mutant に到達し、すべて検出している。
- Help Update は全 mutant に到達し、非同期競合を含めて 93.10% を検出している。残る2件は request ID
  の増減置換であり、最新 request との一致判定という外部契約では等価になる可能性が高い。
- Navigation は total 81.88% で、おおむね強い。ただし survived と timeout を個別に確認するまでは
  完了扱いにしない。

### 未完了の範囲

- Work は「到達済み範囲の assertion は強い」が、「feature 全体への到達は不足」と判定する。
- Editor は到達率と covered score の両方が不足している。テスト追加だけで巨大 Controller の内部実装を
  固定せず、R1 の責務レビュー後に coordinator/completion 境界へ直接テストを置く。
- Emergence は mutation testing による品質評価がまだ行われていない。

## 品質ゲートとしての注意

Stryker の `thresholds.break` は現在 `0`
である。そのためコマンドの終了コードが成功しても、品質基準を 通過したことにはならない。現状の run
は計測・可視化用途であり、回帰防止にはファイル別の前回値を 下回らない ratchet、または段階的な
threshold が別途必要である。

また Timeout は Stryker 上で detected として score に含まれるが、必ずしも良い assertion による検出を
意味しない。Navigation の2件は個別実行し、mutation が意図的に無限ループを作ったのか、fake timer
を含むテストハーネスの不安定さなのかを確認する。

## 次の作業順

1. Emergence Controller の公開契約テストを追加し、全件 `NoCoverage` を解消する。
2. Navigation の survived 19件と timeout 2件を、不足テスト、等価 mutant、計測制約に分類する。
3. Work の quick capture、trash/purge、duplicate merge、unplaced link を作業単位ごとにテストする。
4. Editor は `docs/refactoring-candidates.md` の R1 を先に実施し、責務境界ごとに mutation target と
   direct test を分ける。
5. 安定したファイルから mutation score ratchet を導入する。

## 再現コマンド

```sh
npx vitest run --config vitest.stryker.config.ts
npm run test:mutation:controllers
```

mutation の integration coverage や実DB互換性を確認する場合は、この run とは分けて SurrealDB を使う
integration test を実行する。両者を混ぜると、Controller の状態遷移に対する unit test の不足と、
repository/DB 接続の問題を区別できなくなる。
