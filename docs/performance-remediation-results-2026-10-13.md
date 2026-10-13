# 性能改修の計測・最終受入結果（2026-10-13）

## 状態

実装・検証済みは38/40タスク。U03〜U08/T01/T04はGUI統合試験、E01は証拠表、E02は全体verify、
E03はread-only PR監査記録まで完了した。M06のrelease renderer traceとM07のbaseline比較が残る。
WindowsのLow Integrity認定によりmain branch以外の実機起動が難しいとの報告があり、candidate
runtimeの実機計測を阻んでいる。 Playwrightはbrowser上のmock
fixtureを使い、実機IMEとrelease性能を測っていない。候補作業木はdirtyのため、 成果をHEAD
commitだけへ帰属できない。

比較元commitは `acc2b3b8c1b8946ddafc132a41b722f4d36e948d`、 候補作業木が記録したHEADは
`35bce5ac5693b2b45142c81711ead2534fa6f53b`。
比較元の実行は未実施。`9c8aaa7b08d0891e3d4b5248efccb849618017b8` は監査時の参考commitで、
この結果のbaselineには使っていない。

## 候補側のSQLite測定

| Case                | 実行条件                                                                         |  median |     p95 |     max | counters                        | raw結果                                                                        |
| ------------------- | -------------------------------------------------------------------------------- | ------: | ------: | ------: | ------------------------------- | ------------------------------------------------------------------------------ |
| `1k-all-roots-text` | seed 42、1,000 Work、全root、短本文、Revision 0、edge 1,000、warmup 5・sample 30 | 5.42 ms | 7.28 ms | 7.42 ms | transaction 1、SQL 3、capture 0 | [raw JSON](performance-remediation-artifact-1k-all-roots-text-2026-10-13.json) |

実行command:
`deno run --node-modules-dir=auto -A scripts/performance_measurement.ts --case 1k-all-roots-text --seed 42 --output reports/performance-remediation/candidate-2026-10-13/1k-all-roots-text`

実行環境はDeno 2.9.7、Windows x86_64、論理CPU 8。raw JSONに記録されたcommitは上記HEADだが、
作業木はdirtyだったため、これはcommit単体の測定値ではない。対象はSQLite上の本文更新であり、
入力からpaintまでの時間を測っていない。baselineがないため速度改善率や合否は判定しない。
heap計測はruntime非対応のためnull。

## M06 renderer driver

`scripts/desktop_cdp_audit/performance_cases.ts` と `deno task desktop:performance`
を追加し、既存CDP接続・trace・非上書き保存を再利用する。`outline-input`、`outline-collapse`、`tree-pan`、`tree-zoom`
の各caseが35回のmark付き試行を行う。input/DOM応答とrAF
proxyを報告し、Paint完了は同じtraceに含まれるPaint eventから別途対応付ける。アプリのqueue
depthは公開されていないため `null` とする。

実行例:
`deno task desktop:performance -- --case tree-pan --trace <trace.json> --output <report.json>`。releaseアプリ、127.0.0.1:9230のrenderer
inspector、計測対象fixtureが必要。現在は対象のrelease GUI/inspectorが起動していないため、trace
artifactはまだない。driver内の操作は合成DOM eventであり、物理入力性能の受入には使わない。

driverのtestは全体Deno suiteに含まれ、GUI受入はPlaywright 69件pass、a11y 6件pass。
Treeの追加counter試験2件もpass。release GUI/inspectorが起動していないため、raw
traceは取得していない。

## 元計画との対応

| 項目                   | 判定                           | 証拠と残条件                                                                                                                |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| P0 計測基盤            | 部分完了                       | M01〜M05のfixture/counter/runner実装とtestはある。上の候補caseを測定。baseline比較とrelease renderer traceは未実施。        |
| P1a 小さな二乗探索除去 | 正しさ検証済み・性能比較未確認 | 既存順序・結果の回帰testは全Deno suiteで合格。baselineとの数値比較は未実施。                                                |
| P1b 深い木とKnot       | 正しさ検証済み・性能比較未確認 | 10万nodeのchain/cycle/balanced算法stress testは合格。実release上の時間比較は未実施。                                        |
| P2a Outline操作batch   | 正しさ検証済み・数値受入未確認 | 操作・保存契約testは合格。全対象操作のbaseline比は未計測。                                                                  |
| P2b N+1除去            | 正しさ検証済み・数値受入未確認 | service/counter回帰testは合格。密度別baseline比は未計測。                                                                   |
| P3a 差分保存の基礎     | 正しさ検証済み                 | read時のKnot transaction 0回、構造変更時のcommit契約testは合格。release再起動受入は未実施。                                 |
| P3b 小更新の保存       | 正しさ検証済み・一部case測定   | 本文更新の代表SQLite caseは上記のとおり。collapse/caret等のbaseline比較は未実施。                                           |
| P4 更新伝播限定        | GUI再確認済み・性能未計測      | counter/世代保護と画面遷移を含む関連Playwright 69件がpass。release latencyは未計測。                                        |
| P5 Outline仮想化       | mock GUI受入済み               | 1440x900/800x900で1万行の先頭/中央/末尾、2KB、行高anchor、focus/IME/drag/dropを確認。実IMEとrelease性能は未確認。           |
| P6a Tree camera分離    | component/GUI受入済み          | counter付き実gestureでpan中world layout差0回、zoom/projection/filter/resize後の再計算を確認。frame時間は未計測。            |
| P6b Tree残存算法       | 算法と512件GUI受入済み         | 旧oracle一致・隣接bucket比較は全Deno suiteでpass。512件同時刻Treeのpan/zoom/cluster/selectionはGUI pass。1万件trace未取得。 |

## 性能目標

| 元計画の条件                                                 | 結果                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| 入力→次paint p95 < 50 ms                                     | 未測定。上のSQLite測定はrenderer paintを含まない。      |
| 単一move/collapse 操作→表示 p95 < 100 ms                     | 未測定。                                                |
| Tree 60Hz frame budget 約16.7 ms、pan中world layout再構築0回 | pan中0回はcounterで確認。frame時間はrelease trace待ち。 |
| 1万件OutlineのDOM/editor数、IME・focus・keyboard・drag・復帰 | mock browserでDOM上限・操作を受入。実IME入力は未確認。  |
| 1万件Treeのgesture・失効・選択                               | 512件fixtureでGUI確認。1万件release traceは未取得。     |

測定していない値を推定で補完していない。保存時間の単独値をrenderer受入へ読み替えない。

## 検証gate

| Command                           | 結果                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deno task verify`                | pass: Deno 983 tests、Vitest 541 tests、type/format/ratchets/build。Biomeは226 warnings/22 infosを出力。Viteは790KB minified JS chunkのsize warning。 |
| `npm run test:ui --` 関連6 spec   | 69 passed。Outline 10k、screen navigation、Tree gesture/selectionを確認。Tree counter specを後続再実行し2 passed。                                    |
| `npm run test:a11y`               | 6 passed。                                                                                                                                            |
| `npm run check`                   | 0 Svelte errors、0 warnings。                                                                                                                         |
| `npm exec -- biome lint` 対象file | exit 0。対象fileにApp.svelteのhandleKeydown複雑度warningが1件。                                                                                       |
| `git diff --check`                | pass。                                                                                                                                                |

`deno.json`のcheck/test taskへ `--node-modules-dir=auto` を指定し、globalのmanual設定は維持した。
これで `deno task verify` が全gateを完走する。Biome
lintはwarningを許容する既存gateのため、出力された226件は個別修正していない。

## 残項目

- **M06:** 認定されたcandidate runtimeを実機起動できる経路を確保し、release
  WebView/CEFと127.0.0.1:9230 inspectorでtraceを取得してmarkをPaint eventへ対応付ける。main
  branchのtraceは候補の証拠にしない。
- **M07:** baseline `acc2b3b` とcleanな候補commitを同runtime/fixtureで測り、raw artifactを保存する。
- 性能目標の値は未判定。1万件Tree、実IME、paint p95はrelease計測後に判定する。
- **E03:** PR
  #334〜#339のread-only状態と16件の未解決threadを記録済み。GitHub書込・mergeは計画のscope外。

## E03 GitHub read-only記録（2026-10-13時点のスナップショット）

以下は今回の進捗PRを作成する前に取得したread-only確認結果であり、#334〜#339の状態を記録する。
この後に作成する進捗PRの状態を示すものではない。

GitHub API上のmainは
[`acc2b3b8c1b8946ddafc132a41b722f4d36e948d`](https://github.com/asadaame5121/Radiora/tree/main)。PR
#334〜#339は全てOpenかつmergeableで、どれもmergedではない。6件の積み上げPRに16件の未解決inline
review threadが残っている。PR headはこの作業木の変更を含まない。

| PR                                                       | base → head                           | unresolved threads |
| -------------------------------------------------------- | ------------------------------------- | -----------------: |
| [#334](https://github.com/asadaame5121/Radiora/pull/334) | `main` → `perf/p1-outline-algorithms` |                  1 |
| [#335](https://github.com/asadaame5121/Radiora/pull/335) | P1 → P2                               |                  2 |
| [#336](https://github.com/asadaame5121/Radiora/pull/336) | P2 → P3                               |                  5 |
| [#337](https://github.com/asadaame5121/Radiora/pull/337) | P3 → P4                               |                  2 |
| [#338](https://github.com/asadaame5121/Radiora/pull/338) | P4 → P5                               |                  4 |
| [#339](https://github.com/asadaame5121/Radiora/pull/339) | P5 → P6                               |                  2 |

Local branch `performance_remediation_plan_2026` はupstream未設定、HEAD
`35bce5ac5693b2b45142c81711ead2534fa6f53b` の作業木はdirty。したがってmain反映はなく、remote review
threadも未解決のまま。当時のread-only確認ではGitHubへのwrite/mergeを実施していない。
