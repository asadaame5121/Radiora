# Editor mutation test report

## 実施概要

- 実施日: 2026-08-13
- 対象: `src/ui/editor_controller.svelte.ts`
- テストランナー: StrykerJS + Vitest
- 専用コマンド: `npm run test:mutation:editor`
- 判定閾値: high 80%、low 60%、break 0%

Editor の状態遷移を所有する controller を対象に、incremental cache を使わない初回相当のミューテーションテストを実施した。再実行時に対象やレポート出力先が controller 全体の実行と混ざらないよう、専用の Stryker 設定と npm script を追加した。

## 実行結果

| 指標 | 結果 |
| --- | ---: |
| 生成 mutant | 636 |
| Killed | 16 |
| Survived | 20 |
| No coverage | 600 |
| Timeout / Error | 0 / 0 |
| Mutation score（全体） | 2.52% |
| Mutation score（covered code） | 44.44% |
| Dry run | 1 test passed |
| 実行時間 | 32秒 |

Stryker の break threshold は 0% のためコマンド自体は成功したが、品質上は **low threshold の 60%を大幅に下回る**。特に 600 mutants（94.34%）が `NoCoverage` であり、現状の editor controller test は controller のごく一部しか実行していない。

## Survived mutant の傾向

20件の surviving mutants は、主に次の境界に集中した。

1. **初期状態**
   - working-copy save statuses、backlinks、notice の初期値変更が検出されない。
2. **autosave / resume save の配線**
   - coordinator の設定削除、save callback の無効化が検出されない。
3. **internal-reference completion の競合制御**
   - request counter の増減反転、stale request guard の無効化が検出されない。
4. **completion keyboard navigation**
   - candidate がない場合の guard、active index の移動方向反転が検出されない。
5. **公開 facade の委譲**
   - `clearBacklinks`、`hasUnsavedChanges`、`drafts`、flush/retry、`referencesIn` の無効化が検出されない。

## NoCoverage の主な範囲

未到達 mutants は、working-copy 更新、resume position、inline-link completion、reference 作成、internal-reference navigation/backlinks、autosave status selection など、editor controller が所有する大半の振る舞いに分布している。

これは production code の不具合を示す結果ではなく、mutation test が既存テストの検出力不足を可視化した結果である。ただし、editor controller は570行規模で複数の状態遷移を所有しているため、テスト追加時には単に1ファイルへケースを積み上げるのではなく、責務境界も併せてレビューする必要がある。

## 推奨する次の対応

1. 初期状態と公開 facade の委譲を table-driven test で固定する。
2. fake timer を用いて working-copy / resume autosave の queue、flush、retry、失敗通知を検証する。
3. deferred Promise を用い、completion の stale response が state を上書きしないことを検証する。
4. inline-link の candidate/create phase と keyboard navigation を個別に検証する。
5. internal-reference navigation、revision comparison、backlink load の成功・失敗経路を検証する。
6. 各追加単位で専用コマンドを再実行し、まず `NoCoverage` を減らした後、surviving mutants を個別に kill する。

## 再現方法と成果物

```sh
npm run test:mutation:editor
```

生成レポートは Git 管理対象外の次の場所へ出力される。

- `reports/mutation/editor.html`
- `reports/mutation/editor.json`
- `reports/mutation/editor-incremental.json`

本報告の数値は cache を無効化して実施したベースライン実行（`--force`）に基づく。
