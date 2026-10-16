# Issue #329 実装計画: ブラウザからSQLiteまで貫く最小full-stack smoke test

2026-10-16。照合基点は `main` `8dc2eb815ca889f87dcaf8862f8d534f5d1f07b3`。
仕様の正本は、親threadが `gh issue view` で取得したGitHub Issue #329の本文である。
Stage 1は親レビューで承認済み（`issue-329/rpc-boundary` tip `fe8abfbe17b65ddf80e0d2f9829092a8ece16ef2`。上位layerのbaseは`gh stack rebase --no-trunk --upstack`で更新済み）。
Stage 2も親レビューで承認済みで、その7ファイルは `issue-329/sqlite-host` のtipとしてthread内にcommitする（main未反映）。
本書は計画と段階構成の記録であり、Stage 1ではtest host・Playwright設定・CI・npm scriptを実装しない。

## 1. 目的と受け入れ条件

目的は、UI→実HTTP RPC→実binding→実service→SQLite→backend再起動→UI表示という**永続化の往復**を、
mockを挟まず1〜2本の最小Playwrightテストで保証すること。

受け入れ条件:

- Playwrightのfull-stack smokeが、browser UI→実RPC client/binding→実backend→SQLite→UI reload/reconnectを1本で貫く。
- `scripts/mock_ui_plugin.ts`（Vite mock plugin）と `page.route` を使わない。RPCは実際のHTTPリクエストとしてbackendへ届く。
- 各test attemptは一意の一時DB + application-dataディレクトリを持ち、cleanupされ、parallel/retryでも干渉しない。
- readinessは観測可能な信号で待ち、固定sleepを使わない。
- 失敗時はbackendのstdout/stderr/logとPlaywrightのtrace/screenshotをartifactとして添付する。
- ローカルコマンド、GitHub Actionsの独立job、READMEの記載を用意する。
- 中核シナリオ: UIで項目を作成→入力/保存→同一temp SQLiteのままbackend session/processを再起動→UI reloadで実際の保存内容が復元される。

### 非目標

- CEFウィンドウの起動・描画・更新の検証。desktop shellは対象外。
- 既存のmock Vite pluginベースのUI/a11y/visual suiteの置換や、広いE2Eの追加。
- 本番に公開webサーバーモードを追加すること。productionはdesktopアプリのまま。
- handler/service/storageのfakeでsmokeを成立させること。
- Linux対応、storageパス既定値の変更、Turso/legacy移行、自動更新の検証。
- 新しい依存の追加（Playwrightは既存devDependencyを使う）。

## 2. 現行の入口→binding→service→SQLite seam（照合結果）

| 層 | 現状の実装 | smokeでの扱い |
| --- | --- | --- |
| 起動/entry | `deno task desktop` → [desktop_run.ts](../scripts/desktop_run.ts) → [desktop_build.ts](../scripts/desktop_build.ts)（`deno desktop` bundle）→ [main.ts](../src/main.ts#L256) | test hostが同じmoduleをcomposeする。CEF windowは載せない |
| HTTP transport | `src/main.ts` の `Deno.serve` と [rpc_http.ts](../src/desktop/rpc_http.ts#L114)（Stage 1で抽出） | hostも同じ `createRpcHttpHandler` を使う |
| UI→API | [rpc_adapter.ts](../src/ui/rpc_adapter.ts#L7) が `POST /api/rpc/<method>` へ `{args}` を送り `{result}`/`{message}` を読む | 実HTTPをそのまま通す。`page.route` で差し替えない |
| binding | [register_bindings.ts](../src/desktop/register_bindings.ts#L51) の `createBindingHandlers` が `RadioraBindings` を返し、入力はValibotで検証する | 実handlerを使う。fake handlerを置かない |
| service | `src/services/*`（`OutlineService`など） | 実serviceを使う |
| storage | [storage_bootstrap.ts](../src/storage/storage_bootstrap.ts#L34) が `RADIORA_STORAGE`（既定 `sqlite`）に応じて [SqliteGraphStore](../src/storage/storage_bootstrap.ts#L66) を開く。DBは `${dataDir}\turso\radiora.db`（node:sqlite） | 実SQLiteを一時 `dataDir` で使う |
| 診断 | `Logger` + `OperationLog` + `createDiagnosticLogSink` が `${dataDir}\logs` へ書く | 失敗artifactとして回収する |
| 起動cache | [startup_snapshot_cache_file.ts](../src/desktop/startup_snapshot_cache_file.ts#L10) が `${dataDir}\startup-snapshot.json` を保存し、UIはcache表示中をbannerで示す | 再起動後のreload前にcacheを無効化する（§4） |

補足:

- [main.ts](../src/main.ts#L241) は `Deno.serve` の前に `new Deno.BrowserWindow()` を作るため、そのままではheadless CIで起動できない。
  よってsmokeはtest-onlyのloopback hostを起動し、productionのmodule（RPC boundary・bindings・storage bootstrap・services）を実物のまま使う。
- dataDirは [main.ts](../src/main.ts#L36) が `LOCALAPPDATA`/`APPDATA` から `\RadioraV2` を作る。hostは `bootstrapStorage` の引数として一時ディレクトリを直接渡し、productionの既定パスは変更しない。
- 既存のPlaywright設定はmockサーバーを起動する（[playwright.a11y.config.ts](../playwright.a11y.config.ts#L22)）。smokeは別configを使い、mock serverを起動しない。

## 3. Stage構成と各層の責務

stackは `main` ← `issue-329/rpc-boundary` ← `issue-329/sqlite-host` ← `issue-329/fullstack-smoke`。

| Stage / branch | 責務 | 実装物（予定） |
| --- | --- | --- |
| 1 `issue-329/rpc-boundary`（本書） | 計画文書と、mainから抽出した共有HTTP RPC境界 | `docs/issue-329-fullstack-smoke-plan.md`、`src/desktop/rpc_http.ts`、`src/desktop/rpc_http_test.ts`、`src/main.ts` の配線 |
| 2 `issue-329/sqlite-host` | 一時 `dataDir` で実storage/handlerを起動するtest-only loopback host | host entry、`dist` asset配信、readiness、stdout/log、graceful shutdown、tempディレクトリのlifecycle |
| 3 `issue-329/fullstack-smoke` | 1〜2本のPlaywright smokeと実行・診断の配線 | `playwright.smoke.config.ts`、`tests/smoke/*.spec.ts`、fixture、`npm run test:smoke`、CI独立job、README |

Stage 1で共有する範囲は**wire protocolとdispatch**に限る。
request timing、operation log、lazy bootstrapはhost固有の診断なので [RpcHttpPorts](../src/desktop/rpc_http.ts#L30)（`recordOperation` / `measureRequest` / `onStartupStatusPoll`）としてmainとhostが与える。
domainのranking、logging catalogue、storageの詳細はこの境界へ移さない。

## 4. 分離・再起動・cache排除・診断

### 4.1 attemptごとの分離

- attemptごとに一意のtemp rootを作り、その下をapplication-dataディレクトリとしてhostへ渡す。
  temp rootはテスト終了時に削除する（local debug用の保持flagは任意）。
- 一意ディレクトリにより、並列実行（別worker）と同一specのretryが同じDBを共有しない。ポートはhostがephemeralで割り当てて報告し、固定ポートを使わない。
- 既存UI suiteはmock serverの4173など固定ポートを使うため、smokeの設定は別config・別outputDirに分ける。
- browserの`localStorage`等はPlaywrightの新しいcontextで自動的に分離される。テスト間でstorage stateを共有しない。

### 4.2 readiness（固定sleepを使わない）

- hostの起動完了は、hostがstdoutへ出す機械可読なreadiness行と、`POST /api/rpc/getStartupStatus` の応答 `{result:{phase:"ready"}}` の両方で観測する。
  RPCでの観測は、UIと同じproduction protocolを通る。
- UIの表示readyは`getStartupStatus`のpollとOutline表示（`.shell`の`inert`解除）で待ち、`expect.poll`/locatorになり得るまで待つ。
  固定`waitForTimeout`は使わない。
- 保存完了はsave statusの実表示、または`listOutline`の再読取で待つ。

### 4.3 backend再起動と永続性の証明

1. 1回目のhostでUIから項目を作成し、テキストを入力して保存する。
2. 保存完了を観測してから、hostの制御経路（stdinの`shutdown`など）でstorageを閉じてプロセスを終了する。
   WindowsではSQLiteファイルが開いたままだとディレクトリ削除・再起動が失敗するため、強制killに頼らず終了を待つ。
3. **同じtemp `dataDir`**で新しいhostプロセスを起動し、readinessを再観測する。
4. reload前に `${dataDir}\startup-snapshot.json` を削除し、UIをreloadして保存内容が表示されることを確認する。
   startup cacheのpreviewでは説明できない状態にしておく。
5. 同じ内容が表示されたら、`listOutline`が実SQLiteから返した結果である。
   in-memory storeや前プロセスのsnapshotでは成立しない。
   補助evidenceとしてSQLiteファイルが存在し0バイトでないことも確認する（内容のassertはUI経由で行う）。

### 4.4 失敗時のartifact

- Playwright: `trace: "retain-on-failure"`、`screenshot: "only-on-failure"`。
- backend: hostのstdout/stderr、`${dataDir}\logs` のlog/operation jsonlを`testInfo.attach`で添付する。
  `test-results/` はCI jobでもartifactとしてuploadする。
- 失敗時は再現に必要な範囲でtemp `dataDir` の内容を`test-results/`へコピーし、元のtempは削除する（diskを無制限に残さない）。

## 5. ローカルとCIの範囲

初期sliceは**Windowsのみ**とする。
現行のstorage/`dataDir`はバックスラッシュ前提であり、CIも`windows-latest`を使う。cross-platform化は本Issueで行わない。

| 項目 | 予定 |
| --- | --- |
| ローカルコマンド | `npm run test:smoke`（`npm run build` 済みの`dist`に対して実行）。READMEの開発節に追記する |
| CI | `.github/workflows/ci.yml` に独立job `fullstack-smoke`（`runs-on: windows-latest`、Node 22、Deno 2.9.3）を追加し、`npm ci` → `npx playwright install chromium` → `npm run build` → `npm run test:smoke` を実行する |
| CI安定性 | mock serverを起動しない。portは固定しない。`reuseExistingServer: false`。失敗artifactをjobでuploadし、失敗理由をbackend logから追えるようにする |

ローカル実測環境（Stage 1時点）: Node `v25.2.1`、Deno `2.9.7`、Biome `2.5.2`。CI指定はNode 22 / Deno 2.9.3で、CIでは未検証。

## 6. 後続ステップと未決事項

- Stage 2でhostを実装する。hostは`bootstrapStorage`・`createBindingHandlers`・実service・[RpcHttpPorts](../src/desktop/rpc_http.ts#L30)をproductionと同じ形でcomposeする。
  compositionがmainと乖離しないよう、Stage 2の冒頭で「desktop runtime compositionの共通module抽出」対「hostが独立にcompose」を比較し、親レビューで決める。
- `dist`のasset配信（MIME、index.html fallback、`missingAssetResponse`）はStage 2で共有moduleへ抽出するか、host専用配信にするかを同様に決める。
  どちらでもsmokeが配信するのは`npm run build`の成果物であり、mock pluginは使わない。
- Stage 3でsmokeを1本実装し、§4の再起動・cache排除・artifactを配線する。2本目は「再起動後に新しいbrowser contextで同じ内容が見える」程度に留める。
- CEF windowの描画・自動更新・release bundleの検証は本Issueの対象外として残す。

## 7. 本書作成時の確認状況

- 実施: `src/main.ts`、`register_bindings.ts`、`rpc_adapter.ts`、`storage_bootstrap.ts`、Playwright設定、CI workflow、既存UI suiteの照合、およびStage 1の抽出・unit test。
- Stage 1の検証結果は§8に記録する。本書はhost・Playwright smoke・CIの実装を含まない。
## 8. Stage 1 実施記録（2026-10-16、親レビュー反映後）

- 作業開始: 継承していた328スナップショット（29 path）は自分のclone内のstash `cddb530a525665a7ac400847c3be5545340e7691`（tree `ecb3e048…`）へ**追加backup**として保存し、`origin/main` `8dc2eb8` のclean worktreeから作業した。
  親checkoutと公開済み328 PRの内容は親側に保持されており、このstashは唯一の退避ではない。
- 抽出: [rpc_http.ts](../src/desktop/rpc_http.ts#L114) へ `/api/rpc/` のdispatch、404 guard、body検証、result/error envelopeを集約し、[main.ts](../src/main.ts#L219) は [RpcHttpPorts](../src/desktop/rpc_http.ts#L30) を渡すだけにした（main.ts 317→298行）。
  renderer-log、asset、HMR routeはmainに残した。
- 挙動の保持: method dispatch、`POST`/own/callable guardの404、`result ?? null`正規化、500 error envelope、request timing（maintenance除外）、operation log（release絞り込み、失敗時の`operation_log.write.failed`）、`getStartupStatus`のlazy bootstrapを維持した。
- body検証の決定: 空・空白のみ・body無しは**400** `{message:"Invalid RPC request body."}` としてhandlerを呼ばない。
  `{}` と `args:null` は引数なし（元mainと同じ）。非object bodyと非array `args` も400とし、旧実装の「文字列`args`を1文字ずつ展開してhandlerへ渡す」挙動は廃止した。
  正常クライアントは常に `{args:[...]}` を送るため、新しい入力形式の暗黙受入は増やさない。operation logの失敗記録は維持する。
- startup pollの順序: body検証 → `onStartupStatusPoll` → handler実行（body parseは一度だけ、timing内）。
  malformed/空bodyのPOSTではpollを呼ばずbootstrapも始まらない。GET・未知名は404でpollなし。
- port契約: `recordOperation` はhostが例外を投げない責任を持ち、moduleはrecorder失敗を隔離しない（mainはlog書込みをtry/catchで守る）。
  `measureRequest` のhookが失敗した場合、handler未実行のまま500 envelopeになる。
- 検証: 変更前baseline 11件pass、抽出後は新規11件 + 関連既存12件 = 23件pass、`deno check` pass、`npm run check` 0 errors 0 warnings、magic-number ratchet pass。
  negative control（すべて復元後にpass）: own-property guard除去で404テストが失敗、body検証除去でmalformed/空bodyのcaseが失敗、`result ?? null`除去でnull正規化テストが失敗。
- 既知の差: 管理checkoutでは`deno task lint`（bare `biome lint`）が絶対パスを無視して0 filesで失敗する（main由来）。変更ファイルに明示的な`biome lint`を実行してpassを確認した。
  `deno.lock`はDeno 2.9.7がoptionalPeers（`@types/node`）を正規化して生成した差分を初期hashへ復元した。

## 9. Stage 2 判定記録: test-only real SQLite host

- 構成: hostはTEST lifecycle（引数guard・readiness・shutdown・composition）だけを持ち、実 `bootstrapStorage` / `SqliteGraphStore` / `OutlineService` / `RevisionService` / `createBindingHandlers` / `createRpcHttpHandler` を再利用する。
  `src/main.ts` はimportしない（`Deno.BrowserWindow`・asset配信・HMR bridge・autoUpdateを実行しない）。domain・storage・RPC protocolを再実装しない。
  広い共有runtime抽出は行わない: mainのcompositionはdesktop shell固有の責務を含み、hostと共有するのはbootstrapとhandlers配線だけなので、二重に抱える分割はしない。
- 起動契約: `--data-dir`（絶対パス・既存dir必須）と`--token`必須。`Deno.build.os !== "windows"`は起動時にfailする（`dataDir`がバックスラッシュ前提のため他OSへ漏らさない）。
  ownership marker `${dataDir}\.radiora-smoke-host.json`（role+token）を最初の起動で書き、以後はtoken一致を要求する。markerなしの非空dirは拒否し、実ユーザーデータを誤って開かない。
- controller runtime: [test_host_process.ts](../tests/smoke/test_host_process.ts#L378) は **Node builtinsだけ**（`node:child_process` / `node:fs/promises` / `node:os` / `node:path` / `node:url`）を使い、Deno統合テストとStage 3のPlaywright fixture（Node）が同じmoduleをimportする。
  host本体はDeno entryのまま。executableは `launch.file` → `RADIORA_DENO_BIN` → PATHの`deno`の順で解決し、shellを使わない（コマンド文字列evalなし）。
- stop/cleanupの有界性: 通知・stdin close・exit待ちを1つのdeadlineに収め、超過時は自childだけをkillする。graceful exitが得られない・kill失敗・kill後の未exitは、pid文脈とcaptured stdout/stderrを付けて**失敗**として返す（ログだけで成功扱いにしない）。
  複数回の `stop()` / `cleanup()` は同じsettling promiseを共有し、起動失敗時のchildも同じ有界killで回収する。
- attemptの所有規則: attemptの `cleanup()` は**1つのclosing規則**で、in-flightのstartを全て待ってから起動済みhostを停止しrootを削除する（cleanupの全callerは同じ完了/失敗を待つ）。
  cleanup開始後のstartは即rejectし、cleanupと競合したin-flight startは自分のhostを停止して失敗を返す。start失敗はcleanupを失敗させずroot削除へ進む。attempt初期化の途中で失敗した場合は自分が作ったrootだけをrollbackする。
- hostの例外安全: `run()` はserver/runtime起動後をtry/finallyでshutdownする。
- stdin/stdioの失敗処理: childのstdin/stdout/stderrにlifetimeの `error` listenerを付け、NodeStreamの非同期error（EPIPE/ERR_STREAM_DESTROYEDなど）をnotesとして収集して停止失敗のartifactへ反映する。
globalなuncaughtException handlerでは握りつぶさない（再現済みbugの報告ではなく、Node API上の失敗処理の欠落に対する静的な修正）。
- stream: stdout/stderrはraw captureと未改行pendingの**両方**に上限を持ち、`close`（stdio完了）とexitを整合させて起動失敗時の最後のstderrもartifactへ含める。
- cache: test hostは`loadStartupSnapshotCache` / `saveStartupSnapshotCache` portを**提供しない**（明示的なtest-host設定）。UIはstartup cache previewを持たず、再起動後の表示はSQLiteからのみ成立する。
  実`StartupSnapshotCacheFile`を使うcache挙動の検証はStage 3以降の任意項目とする。
- 診断配線: 実`Logger`（development profile）・実`OperationLog`・`createDiagnosticLogSink`を`${dataDir}\logs`へ配線する。`recordOperation`/`measureRequest`はStage 1のport contractどおりlog失敗をRPC応答へ漏らさない。
  test hostはproductionのoperation-method catalogue・release絞り込み・maintenance除外・view allow-listを持たず、attemptを`test_host.rpc.<method>`として記録する（診断logの内容だけの差）。
- 待受とport: `127.0.0.1`のみ。attemptの最初のstartは**port 0**で実hostに割当て、readiness行の実portをattemptへ記録する。restartはそのportを要求し、occupiedなら**別portへ逃げず**起動失敗する（listen→closeの疑似予約はしない）。
  readinessはstdoutの1行JSON（`{"event":"test_host.ready","origin":...,"pid":...}`）。bootstrap失敗はstderrとlog+nonzero exit。
- shutdown: stdinの`shutdown`行またはEOFで`server.shutdown()`（inflight drain）→storage close→正常終了。controllerは自分がspawnしたpidのみを扱い、timeout時のfallback killもそのchildだけに限定する。
- static配信: `--dist-dir`（既定はrepoの`dist`）を`node:url`の`pathToFileURL`で解決する（space・`#`・`%`を含むpathも安全）。GET/HEADのみ、`..`拒否と`distRoot`内containment、MIMEは`desktop_helpers.assetMimeType`（mainのinline mapから移して共有）、missing assetは`missingAssetResponse`。HMR redirectは提供しない。
  CEF shell・更新機構・描画・production asset route全体は本hostの保証範囲外。
- 永続性の証明: 同じtemp `dataDir`のままhostプロセスを再起動し、別のhostインスタンスからRPCで読む。in-memory storeやsnapshot cacheでは成立しない。

## 10. Stage 2 実施記録（2026-10-16、親承認済み・thread内/main未反映）

- 実装: [sqlite_host.ts](../tests/smoke/sqlite_host.ts#L404) がtest-only host、[test_host_process.ts](../tests/smoke/test_host_process.ts#L378) がNode互換controller（owned root・実port記録・spawnしたchildのみ）、[sqlite_host_test.ts](../tests/smoke/sqlite_host_test.ts#L138) がDeno統合テスト7件、[node_controller_check.ts](../tests/smoke/node_controller_check.ts#L5) がNode単体のreuse proof。
  統合テストはattempt scope（[createSmokeAttempt](../tests/smoke/test_host_process.ts#L378)）だけを使い、start失敗や中断でもroot削除とhost停止がtestの `finally` から必ず走る。
  `assetMimeType` は [desktop_helpers.ts](../src/desktop/desktop_helpers.ts#L58) へ移し、[main.ts](../src/main.ts#L281) とhostで共有する（main 298→288行）。
- 統合テストの中身: (1) 同一temp SQLiteでcreateItem→updateItemText→stop→同portでrestart→listOutlineで永続値を確認（cache fileが存在しないことも確認）、(2) 並列2 attemptのroot/port/DB分離、(3) 非所有dir拒否・token不一致・port占有時の起動失敗と「他のlistenerを壊さない」ことの確認、(4) dist配信境界（`#%`を含むfixture path・MIME・traversal・missing 500・HEAD・405）とrenderer-log 204、(5) lifecycle: 二重stop、自然exit、起動失敗（最後のstderrがartifactに入る）、stdinを破壊して停止しない子のtimeoutが有界に失敗しchildが残らない、(6) cleanup所有: in-flight start→cleanup×2でstartのsettleがcleanup完了より先、cleanup後のstartは即reject、(7) start失敗後のcleanupがrootを削除する。
- 検証: 統合7件pass（16s）、Node proof pass（**Node v22.23.3**とv25.2.1の両方、`node --experimental-strip-types`）、Stage 1境界11件+rpc_adapter 2件=13件pass（親と同じ `--node-modules-dir=manual --frozen`）、関連storage unit 37件pass（bootstrap 12 / sqlite store 21 / records 4）、`deno check` pass、`npm run check` 0 errors 0 warnings、fmt/lint/diff pass、quality（301 files）pass、magic-number ratchet pass（299/428）。
  negative control 1（所有規則）: in-flight待ちとclosingガードを外す旧方式で、cleanup所有testが `start must settle before cleanup completes, saw cleanup-2,cleanup-1,start` により失敗し、復元後にpass。
  negative control 2（永続性）: host起動時にstorageの可視性を壊す一時変更でroundtrip testが `persisted text must come back, saw []` により失敗し、復元後にpass（hostコードはこの回で未変更のため前回確認と同一）。
  temp rootの孤児なし（実行前後で `%TEMP%\radiora-smoke-*` の集合が不変、denoプロセス0件）。
- 実装で分かったこと: (a) `renderer.log` infoはproductionの記録selector（development/release両方）で落ちるため、hostのstdout証拠には使わない。(b) 終了済みchildへの `kill` は `TypeError`（"Child process has already terminated"）を投げるので、killは有界graceの結果として扱う。(c) Node 22では`.ts`実行に `--experimental-strip-types` を明示する（controllerはerasable syntaxのみ）。
- 未保証: CEF shell・更新機構・HMR・描画、startup snapshot cache挙動、production asset route全体、Linux、Playwright spec/CI/README（Stage 3）。
