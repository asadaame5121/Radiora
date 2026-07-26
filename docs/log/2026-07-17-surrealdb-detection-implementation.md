# SurrealDB Desktop統合問題・検出機構の実装記録

- 実装日: 2026-07-17
- 目的: 成功済み最小probeと通常アプリ統合の差を一要素ずつ比較し、失敗境界を特定する
- 既定ストレージ: JSONのまま変更なし

## 実装した検出段階

| 段階 | CLI/process         | SDK/store/service                      | 検出対象                            |
| ---- | ------------------- | -------------------------------------- | ----------------------------------- |
| P0   | probe内の生CLI      | 生SDK                                  | 成功済み対照群                      |
| P1   | `SurrealProcess`    | 生SDK                                  | CLI探索、spawn、health、終了監視    |
| P2   | probe内の生CLI      | `SurrealGraphStore`                    | SDK import、認証、namespace、schema |
| P3   | `SurrealProcess`    | `SurrealGraphStore` + `OutlineService` | CRUD、リンク、検索、削除、再接続    |
| P4   | 通常アプリbootstrap | P3相当                                 | RPC、再試行、通常アプリ終了処理     |
| P5   | `SurrealProcess`    | SDK静的import + P3相当                 | module評価時の差                    |

P3/P5ではroot、child、一時itemを作成し、本文更新、collapse、移動、LIKEリンク、検索、一時item削除を
実行する。その後SDK接続を閉じて再接続し、item 2件、link 1件、親子関係、collapseの永続化を検査する。

## 診断強化

`SurrealProcess`を成功probeと比較可能にした。

- PATHに加えて`%USERPROFILE%\.surrealdb\surreal.exe`を探索
- CLIの実行パスとバージョンを記録
- stdout/stderrをpipeして段階ログへ中継
- 子プロセスのPID、終了コード、signal、予期しない終了を記録
- health到達前にCLIが終了した場合、30秒待たず失敗理由を返す
- stop時にprocess statusと出力中継の完了を待つ

通常アプリは`RADIORA_STORAGE=surreal-diagnostic`の場合だけSurrealDBを使用する。起動順序は
process、store、service、停止順序はservice、store、processである。診断データはJSONと分離した。

## 実行方法

```powershell
deno task desktop:probe:build
deno task desktop:probe:run p0
deno task desktop:probe:run p1
deno task desktop:probe:run p2
deno task desktop:probe:run p3
deno task desktop:probe:run p5
deno task desktop:surreal
```

probeログ:

```text
%LOCALAPPDATA%\RadioraV2\logs\surreal-desktop-probe.log
```

通常アプリ統合ログ:

```text
%LOCALAPPDATA%\RadioraV2\logs\startup.log
```

## 判定方法

P0から順に実行し、最後に成功した段階と最初に失敗した段階の差を原因境界とする。各段階を3回実行し、
同じ境界で再現することを確認する。全段階が成功した場合、現行コードでは旧障害は再現不能と判定する。

## 実装時の静的検証

- `deno check`: 合格
- `deno task test`: 5 passed / 0 failed
- Windows `npm run check`: 0 errors / 0 warnings
- Windows `npm run build`: 合格
- Deno 2.9.3で通常版、動的probe、静的probeの3 bundle生成: 合格

## Windows Desktop実機結果

実行環境はWindows x86_64、Deno 2.9.3、SurrealDB CLI 3.2.1である。

| 段階 | 3回の結果      | 到達点                                        |
| ---- | -------------- | --------------------------------------------- |
| P0   | 3/3 合格       | 生CLI、動的SDK import、query、close           |
| P1   | 3/3 合格       | `SurrealProcess`、生SDK query、process stop   |
| P2   | 3/3 合格       | 生CLI、`SurrealGraphStore.initialize()`、list |
| P3   | 3/3 同一不具合 | CRUDと再接続後、親ID検証で失敗                |
| P4   | bootstrap合格  | 通常UIからstartup status、listOutlineまで200  |
| P5   | 3/3 同一不具合 | 静的import成功後、P3と同じ親ID検証で失敗      |

P4は複数回`Backend startup completed`へ到達し、UI自身から`getStartupStatus`と`listOutline`が
200になった。ウィンドウ終了後に8012番ポートが残らないことも一度確認した。一方、外部PowerShell
harnessからの`retryStartup`反復はHTTP接続を確立できず未検証である。また終了時には
`process.stop.ready`がログへ残らないため、`unload`内の非同期cleanup完了は別途確認が必要である。

## 検出した問題

最初の失敗境界はP2とP3の間で、`SurrealGraphStore.listItems()`が返す親IDの形式である。

期待値:

```text
a3744669-9419-4edb-ab06-09f397c18932
```

実値:

```text
outline_item:⟨a3744669-9419-4edb-ab06-09f397c18932⟩
```

`src/storage/surreal_store.ts`の`itemFromRow()`は`parent_id`を単純に`String()`へ渡している。
`listItems()`のqueryではitem自身に`record::id(id)`を適用している一方、親側の
`array::first(<-evolved_from<-outline_item).id`には`record::id`を適用していない。このため再接続後の
`parentId`がdomainで使うUUID形式と一致せず、階層、祖先検索、移動、削除時の子処理が壊れる。

静的import版P5でもSDK import、constructor、schema初期化までは成功したため、旧runtime終了の原因は
静的importでは再現しなかった。`SurrealProcess`もP1/P3/P5で安定して起動・停止した。

修正候補は、親queryにも`record::id(...)`を適用してdomain境界でUUIDへ正規化し、通常Deno統合試験へ
親子ID、collapse、本文、リンク内容のassertionを追加することである。本調査では原因検出までを対象とし、
このデータ変換修正自体は適用していない。

## 追加で検出した互換性差分

Deno 2.9.3のDesktop buildは従来の`.bat`ではなくアプリ名の`.exe` launcherを生成した。既存の
`desktop:run`は`.bat`固定だったため、2.9.1の`.bat`と2.9.3の`.exe`を自動検出するlauncherへ変更した。
