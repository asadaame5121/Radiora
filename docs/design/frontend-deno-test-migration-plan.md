# フロントエンドのDeno依存移植計画

作成日: 2026-10-31  
状態: 実施済み。移植結果と証拠は[実施記録](frontend-deno-test-migration.md)を参照。
対象はユーザー指定によりフロントエンドに限定する。

[Tauri移行計画](tauri-migration-plan.md)の補助計画。
Tauriホスト、Rustバックエンド、Loro/旧データ移行、配布、リポジトリ全体のDeno撤去は扱わない。
既存G1〜G3の条件や承認状態を変更しない。

## 1. 今回の到達点と境界

**フロントエンドのテスト・型検査・Vite buildを、Deno未導入環境で実行できる状態にする。**
画面の振る舞い、保存設定、非同期公開・cleanupの契約を維持する。
Tauri invokeへのtransport切替やv3製品仕様変更とは別PRにする。

| 区分 | 扱い |
| --- | --- |
| `src/ui/`のView・Controller・純粋計算と対応テスト | 対象。既存Vitestを再利用 |
| `src/shared/`・`src/domain/` | ブラウザ側が利用する実行コード・型と、その契約を検証するテストが対象。ディレクトリ単位で全テストを移さない |
| `tests/`のUI契約、設定、Tree表示計算等 | 対象を台帳で確定。ファイル名のUI有無だけで判断しない |
| `vitest/`・Storybook・Playwright | 既存基盤を維持。移植による影響範囲を検証 |
| テスト内のソースファイル読取り | Nodeのテスト専用I/Oへ。ブラウザproduction codeへNode APIを持ち込まない |
| `src/services/`・`src/storage/`等からの依存 | 型・純粋helper・fixtureか、旧backend実行依存かを個別判定。後者をNodeへ移植しない |
| フロント専用コマンド・型検査・CI | 今回必要な経路だけ追加/接続する |
| `src/main.ts`・`src/desktop/`・DB/serviceテスト、旧Desktop起動/HMR/配布 | 対象外。Denoでの既存経路を維持 |
| quality/coverage/mutation/diff-test/hookの汎用スクリプト | 全面移植は対象外。フロントsuiteの収集先など必要な配線のみ見直す |

`mise run verify:frontend`は現在backendを含むDenoテストとDeno製qualityスクリプトも呼ぶ。
この既存の広いgate全体をDeno不要にすることは、今回の完了条件にしない。
新しい限定経路と、従来の全体gateを区別する。

## 2. 確認した現状

- [unit設定](../../vitest.unit.config.ts)は`vitest/**/*.test.ts`だけを収集する。
  既にController用Vitest、Svelte plugin、Storybook/browser projectがあり、新しいランナーは不要。
- `src/ui/`には7本のDenoテストがあり、すべてJSR assertionと
  Deno import回避の`@ts-nocheck`を使う。
  manuscript_metrics、outline_view_model、rpc_adapter、tree_camera、
  tree_filter_preference、tree_layout、tree_spatial_indexが該当する。
- [UI契約テスト](../../tests/theme_ui_contract_test.ts)等は
  `Deno.readTextFile`でSvelte/CSSを読んで文字列を検査する。
  ランナーの置換と、実DOMの振る舞い保証は別。既存検査を一括削除しない。
- [設定テスト](../../tests/tree_projection_preference_test.ts)には
  `globalThis.localStorage`の差替えがある。並列化、descriptor復元、環境差を確認する。
- [RPC adapterテスト](../../src/ui/rpc_adapter_test.ts)はfetch portを注入できる。
  HTTP実サーバーやDeno backendを起動せずに移せる。
- [tsconfig](../../tsconfig.json)はdomain/shared/UIを含むが、
  `vitest/`と`tests/`を直接含めていない。Vite/Vitestで実行できるだけでは型検査を証明できない。
- [coverage ratchet](../../scripts/quality/coverage_ratchet.ts)はunitとdenoを別集計する。
  [差分テスト](../../scripts/test_changed.ts)もDenoとVitestを別選択する。
  テスト移動だけでcoverageや差分選択の正しさを保証しない。

これは代表箇所の確認であり、対象テストの全台帳・実行baselineはF0で確定する。

## 3. 成功基準

| ID | 合格条件 | 証拠 |
| --- | --- | --- |
| F-S1 対象の網羅 | 対象の旧テストケースすべてに移植先、既存テストでの代替、または対象外理由がある。未分類ゼロ | 旧path＋ケース名→新path＋ケース名の対応表。分割/統合時は検査内容も対応 |
| F-S2 回帰保全 | 対応表の必須検査が通り、移植理由による新規skip/todo、assertion削除、期待値緩和がない | 同じfixtureと入力での旧/新結果。既知失敗は先に記録し、移植成功で隠さない |
| F-S3 型安全 | 対象production codeと移植テストを明示的に型検査できる。7本のDeno回避用nocheckを解消する | Svelte/TS型検査ログと対象一覧。無関係な既存抑制の全撤去は要求しない |
| F-S4 Deno不要 | Denoを導入しないclean CIで依存導入→限定テスト→型検査→Vite buildが通る | 独立jobのログ。Deno cache、JSR解決、Deno製wrapperを使用しない |
| F-S5 実行境界 | 対象ブラウザ実行graphにDeno/JSR/Node I/Oが入らず、移植suiteにもDeno実行依存がない | import追跡、build、対象検索。テスト用node:fsは許可しブラウザ側から分離 |
| F-S6 分離と失敗検知 | 単体・suite全体の実行が通る。global/timer/fetch差替えを復元し、失敗assertが非ゼロ終了になる | パイロットの単体/全体結果と、一時的な失敗注入の記録 |
| F-S7 既存gate保全 | 対象外Denoテストを維持し、全体gateの失敗を増やさない。新旧で同じ移植テストを二重収集しない | 既存gateと新限定gateの収集結果。関連UI変更時はStorybook/Playwrightも実行 |
| F-S8 計測の説明 | 移植対象のカバレッジ対象ファイルを固定し、差分と所要時間を説明できる | coverage includeと旧新比較、同一端末/fixtureでの時間記録。全体百分率の一致だけでは判定しない |

Windowsをローカル検証の基準とし、Deno未導入のLinux CIでも限定経路を確認する。
Tauri/WebViewの実機受入はこのランナー移植の完了条件に追加しない。

## 4. 移し方

1. **既存Vitest unitへ寄せる。**
   移植先は原則`vitest/frontend/`配下の`*.test.ts`とする。
   現行includeを使え、Denoの収集rootであるsrc/tests/scriptsから外れる。
   ファイル移動とimport/fixture URLの修正を同じ変更に含める。
   Svelte変換やbrowser解決条件は既存設定を維持し、新projectは環境衝突が実証された場合だけ検討する。
2. **置換を二種類に分ける。**
   `Deno.test`とimportの変更は機械化できるが、assertionは内容を確認する。
   深い比較は`toEqual`/厳密比較の必要性、参照同一性は`toBe`、
   rejectionは必ずawait、error型・message検査も維持する。
   全体Deno shimや互換assertionライブラリは追加しない。
3. **Node I/Oはテスト側だけ。**
   ソース読取りは`node:fs/promises`の`readFile(url, "utf8")`へ。
   URLをimport.meta.url基準で直し、cwd依存を増やさない。
   localStorage/fetch/DOMなどの差替えは既存fixtureを再利用し、毎回復元する。
4. **責務や仕様は変えない。**
   UI契約の文字列検査はまず同等移植する。
   実操作テストへの置換は欠落が確認できた箇所だけ別の改善として扱う。
   旧backend起動が必要な混合テストはUI部分とbackend部分を切り分け、
   backend側の保証は元のDeno suiteに残す。切分けが大きければ個別の未完了項目として報告する。
5. **型検査とcoverageを同時に追従させる。**
   production browser用とテスト用の型検査対象を明示する。
   browser側へDeno型やNode型を一括追加して通さない。
   カバレッジは移動したファイル群の分母を揃えて比較し、runner差を確認後にbaselineを見直す。
   Vitest側とDeno側の全体比率をそのまま比較したり、合算して低下を隠したりしない。

## 5. 実行順とPR単位

| 段階 | 作業 | 出口 |
| --- | --- | --- |
| F0 対象確定 | UI/shared/domainとtestsの候補、実行import、fixtureを棚卸し。ケース対応表、既知失敗、型検査の穴、時間/coverageを記録 | 対象/対象外/混合が判別できる。未分類が残る間は最終完了を宣言しない |
| F1 小さい移植 | manuscript_metrics等の純粋計算、rpc_adapterの非同期、設定global差替え、theme等のソース読取りを代表として移す | 代表4種類が単体/全体で通る。assertion同値、cleanup、型検査、失敗終了を確認 |
| F2 残りのUIテスト | src/uiの残り、testsの純粋UI/契約、必要な共有計算の順で移す。混合は検査単位で分割 | F-S1/F-S2/F-S3を満たす。元のbackend suiteを維持 |
| F3 フロント専用経路 | npmから直接実行する限定test/typecheck/buildとDeno未導入CIを接続。既存unit commandを再利用し、名前だけのwrapperを増やさない | clean Windows/LinuxでF-S4〜F-S6。広い既存verifyと分離して実行可能 |
| F4 配線と最終照合 | coverage/差分選択/mutationの移動先を確認し必要箇所だけ調整。対応表、全体gate、関連UI検証、限定CIを照合 | F-S1〜F-S8の証拠と残存Deno範囲を記録して終了 |

F1で型検査の最小配線を行い、F3で正式な限定CIへ接続する。
F3のCI準備はF2と並行可能。日数はF1の実測後に見積もる。

差分テストのDeno製wrapper自体は今回移植しない。
移動先が従来の選択に載らない場合は安全な全unit fallbackを維持/追加し、
Deno不要の受入にはnpmからの直接実行を使う。
mutationに対象テストが列挙されている場合だけ、既存Vitest runnerへの配線を変更する。
quality/hook/配布などのDeno残存を、この限定計画の成功によって解消済みとは記録しない。

## 6. 戻し方と停止条件

- 移植は小さいPRで行い、元ファイルと移植先の二重保守を続けない。
  PR内で旧/新結果を比較した後に元テストを置き換える。問題時はそのPRを戻す。
- backendデータ・保存形式・Tauri transportを変更しないので、この作業にDB rollbackは不要。
- runner差による既存バグ、型エラー、混合責務を見つけたら、必要最小限の修正を切り分ける。
  同じPRで製品仕様やUI所有契約を変えない。
- 最終成果は「フロントの限定経路がDeno不要」であり、
  「リポジトリ全体がDeno不要」「Tauri移行完了」「G2/G3承認済み」ではない。

## 7. 参照

- [Vitest projects](https://vitest.dev/guide/projects): 異なる設定を分離できるが、既存unitで足りる間は増設しない。
- [Vitest coverage](https://vitest.dev/guide/coverage.html): coverage対象とproviderを明示して比較する。
- [Node 22 TypeScript](https://nodejs.org/docs/latest-v22.x/api/typescript.html):
  型除去による実行は型検査を行わない。今回は新しいTS実行ツールを追加せず、既存Vitest/Viteを使う。
