# SurrealDB / Deno Desktop 調査記録

- 記録日: 2026-07-17
- 作業場所: Codex CLI side conversation
- 対象: Radiora v2 Technology PoC
- 最終結果: **Deno Desktop 2.9.1上の最小probeでSurrealDB接続・queryに成功**

## 目的

Radiora v2 PoCでは、SurrealDB JavaScript SDKをDeno Desktop bundle内で使用するとWindows
runtimeが終了したと判断し、desktop版の永続化をJSONへ切り替えていた。

今回の調査では、SurrealDBサーバー、JavaScript SDK、Deno Desktop、アプリ統合処理のどこに
原因があるかを、段階ログと独立した実証モデルによって切り分けた。

## 調査開始時の状況

既存のREADMEには、SurrealDB SDKをdesktop bundle内で読み込むとWindows runtimeが終了したため、
`GraphStore`契約を保ったJSON永続ストアへ切り替えたと記録されていた。

既存の起動ログには、失敗した試行で次の2イベントまでは残っていた。

```text
Desktop runtime initialized; waiting for the UI server
Backend startup began
```

その後に`Backend startup failed`が残らずログが途切れていた。このため、通常のJavaScript例外では
なく、runtime終了、ハング後の手動終了、子プロセス終了などが候補だった。ただし当時は
SurrealDB CLIのstdout/stderrを破棄しており、SDK初期化の段階ログもなかったため確定できなかった。

## 追加した診断機能

### SurrealDB SDK

`SurrealGraphStore`へ任意の診断loggerを渡せるようにし、初期化を次の段階に分けた。

```text
sdk.constructor
sdk.connect
sdk.namespace.ensure
sdk.namespace.use
sdk.schema.ensure
sdk.initialize.ready
```

各段階について`.begin`、`.ready`、失敗時の`.failed`と例外スタックを記録する。

### SurrealDB CLIプロセス

SurrealDB CLIについて次の段階を記録するようにした。

```text
process.command-check
process.port-check
process.spawn
process.health
process.stop
```

従来破棄していたCLIのstdout/stderrも診断時に取得できるようにした。

### 統合診断スクリプト

`deno task test:integration`で次を順に検証し、端末と永続ログへ出力するようにした。

1. 一時RocksDBを使ったSurrealDB CLI起動
2. health check
3. SDK constructorとWebSocket接続
4. namespace、database、schema初期化
5. 親子アイテムと`LIKE`リンクの作成
6. 接続終了と再接続
7. アイテム2件、リンク1件の永続化確認
8. CLI停止と一時データ削除

Windowsの既定ログは次に保存される。

```text
%LOCALAPPDATA%\RadioraV2\logs\surreal-diagnostic.log
```

`RADIORA_SURREAL_LOG`環境変数で保存先を変更できる。WindowsとLinuxの一時DBパス区切りも
OS別に処理するよう修正した。

## 通常Deno環境での検証

### WSL / Codex sandbox

WSLへSurrealDB 3.2.1を導入して実行したところ、RocksDB初期化とWebサーバー起動までは成功したが、
直後にCLIが終了した。

```text
Started web server on 127.0.0.1:18012
Listening for a system shutdown signal.
ERROR surrealdb_server::cli: Operation not permitted (os error 1)
Goodbye!
```

この実行では`sdk.constructor.begin`へ到達していない。Codex sandbox内でSurrealDB CLIが終了
シグナルの監視を登録できなかった可能性が高く、SDKの失敗とは判定しなかった。

### Windows通常Deno

Windows側で`deno task test:integration`を実行した結果、すべて成功した。

```text
sdk.constructor.ready
sdk.connect.ready
sdk.namespace.ensure.ready
sdk.namespace.use.ready
sdk.schema.ensure.ready
integration.create-root.ready
integration.create-child.ready
integration.create-link.ready
integration.persistence-read.ready {"items":2,"links":1}
integration.ready
{"ok":true,"items":2,"links":1}
integration.cleanup.ready
```

この結果により、通常のWindows Deno環境では以下が正常であることを確認した。

- SurrealDB CLIとRocksDB
- SurrealDB JavaScript SDK 2.0.4
- SurrealDB 3.2.xとの接続互換性
- WebSocket / CBOR通信
- root認証
- namespace、database、schema定義
- アウトラインとリンクのCRUD
- 再接続後の永続化

## Deno Desktop最小probe

通常アプリから独立した専用bundleを追加した。通常アプリのJSON永続化設定には影響しない。

probeは次を順番に実行する。

```text
Deno Desktop runtime開始
→ SurrealDB CLI探索・version確認
→ 子プロセス起動
→ RocksDB初期化
→ health check
→ surrealdb SDKの動的import
→ new Surreal()
→ WebSocket接続
→ namespace/database選択
→ RETURN 'desktop-probe-ok'
→ SDK close
→ CLI停止
```

進捗はprobeウィンドウに表示し、runtimeが強制終了した場合も同期書込みの永続ログに最後の段階を残す。

```text
%LOCALAPPDATA%\RadioraV2\logs\surreal-desktop-probe.log
```

### probeの実行結果

実行環境:

```text
OS: Windows x86_64
Deno: 2.9.1
V8: 14.9.207.2-rusty
SurrealDB CLI: 3.2.1 for windows on x86_64
Endpoint: ws://127.0.0.1:18013
Desktop backend: CEF
```

重要なログ:

```text
probe.runtime.ready
cli.command.ready {"command":"surreal","version":"3.2.1 for windows on x86_64"}
cli.spawn.ready
cli.health.ready
sdk.import.ready
sdk.constructor.ready
sdk.connect.ready
sdk.use.ready
sdk.query.ready
sdk.query.result ["desktop-probe-ok"]
sdk.close.ready
probe.passed
cli.stop.ready
```

判定: **合格**

Deno Desktop 2.9.1のCEF bundle内で、SurrealDB CLI起動、SDK import、constructor、WebSocket接続、
query、closeまで完了した。

## 否定できた仮説

最小probeの成功により、少なくとも現在のコードと依存関係では次の仮説を否定できる。

- Deno Desktop 2.9.1とSurrealDB SDK 2.0.4の根本的不互換
- CEF環境ではSurrealDB SDKをimportできない
- Deno DesktopのWebSocket / CBORが必ずruntimeを終了させる
- `Deno.serve()`とSurrealDB WebSocketを併用できない
- Deno DesktopからSurrealDB CLI子プロセスを起動できない
- SurrealDB 3.2.1とのバージョン不整合
- WindowsでRocksDBデータパスを開けない

## 現時点の結論

以前観測したruntime終了は、Deno DesktopまたはSurrealDB SDK単体の根本的不具合ではなく、
**当時のRadioraアプリ統合処理、または既に変更・削除された旧コード固有の問題だった可能性が高い。**

最小probeは成功しているため、SurrealDBをdesktop版の永続化候補として再評価できる。
ただし、まだ通常アプリをSurrealDBへ戻す判断には至っていない。

## 残る調査項目

候補は次まで絞られた。

1. Deno Desktop上で`SurrealGraphStore.initialize()`全体を実行する。
2. `OutlineService`を通したCRUDと再接続をDesktop probeへ追加する。
3. SDKの静的importと動的importの差を比較する。
4. 通常アプリのbootstrap、起動監視、終了処理と組み合わせる。
5. 旧実装にだけ存在した競合やライフサイクル問題がなかったか確認する。
6. Deno 2.9.3が実際に解決される環境でprobeを再ビルドし、2.9.1と比較する。

## Denoバージョンに関する注意

ユーザーはDeno 2.9.3への更新を認識していたが、今回PowerShellから解決された実体は次だった。

```text
C:\Users\Yudai\scoop\shims\deno.exe
deno 2.9.1
```

別の候補として`C:\Users\Yudai\.deno\bin\deno.exe`も存在する。2.9.3比較時は、使用するshellで
`deno --version`と`Get-Command deno -All`または同等のコマンドを確認してから再ビルドする。

## 再実行方法

### 通常Deno統合試験

```powershell
deno task test:integration
```

### Deno Desktop probeのビルドと実行

```powershell
deno --version
deno task desktop:probe
```

### 生成済みprobeの再実行

```powershell
deno task desktop:probe:run
```

## 変更ファイル

- `src/storage/surreal_store.ts`
  - SDK初期化の段階loggerを追加
- `src/desktop/surreal_process.ts`
  - CLI探索、spawn、health、stopの診断loggerを追加
  - stdout/stderrを確認可能に変更
- `scripts/surreal_integration.ts`
  - CLI出力中継、永続ログ、段階ログ、OS別パス対応を追加
- `scripts/surreal_desktop_probe.ts`
  - 独立したDeno Desktop最小実証モデル
- `scripts/surreal_desktop_probe_build.ts`
  - probe専用bundle生成
- `scripts/surreal_desktop_probe_run.ts`
  - Windows用probe launcher探索・実行
- `deno.json`
  - `desktop:probe`、`desktop:probe:build`、`desktop:probe:run`タスクを追加
- `README.md`
  - probeの利用方法とログ保存先を追記

## 検証済み品質ゲート

診断コード追加後に次を確認した。

```text
deno fmt --check: 合格
deno check: 合格
deno task test: 5 passed / 0 failed
Windows probe bundle build: 成功
Windows Deno Desktop probe: probe.passed
```

## main threadへの引き継ぎ

main threadでは、まず本レポートと`surreal-desktop-probe.log`を参照する。

現時点では通常アプリの永続ストアはJSONのままである。次にSurrealDB統合を進める場合も、直ちに
JSONを置換せず、Desktop probeへ`SurrealGraphStore`と`OutlineService`の完全経路を追加してから
採否を判断することを推奨する。
