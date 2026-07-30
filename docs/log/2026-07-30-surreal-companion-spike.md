# SurrealDB companion検証

- 実施日: 2026-07-30
- change: `spike: SurrealKitと公式CLIのrestore経路を検証`
- SurrealDB CLI: `3.2.3+20260721.40522d1`
- SurrealKit: `0.7.0`
- 実行コマンド: `deno task test:surreal-companion`
- 結果: 成功

## 目的

Phase 5のJSON完全restoreで、独自にschema管理、DB dump、空DBへの一括復元まで実装せず、
SurrealKitと公式SurrealDB CLIを組み合わせることでデータ保全境界の難易度を下げられるか確認した。

この検証はすべて一時RocksDB directoryで行う。利用中DB、入力backup、製品runtimeは変更しない。

## 実証した経路

1. 一時source DBを起動する
2. 現行`SurrealGraphStore.initialize()`でstorage schema v5へ初期化する
3. 日本語、Markdown、`radiora://`参照、親子Occurrence、方向付き`CITE`リンクを投入する
4. 公式CLIでschema-only exportし、`surreal validate`を通す
5. exportから`DEFINE`文だけを抽出し、SurrealKit用schema fileにする
6. SurrealKitの`setup`、`rollout baseline`、`status`を実行する
7. 公式CLIでtableとrecordをfull exportし、`surreal validate`を通す
8. 別の空target DBへ`surreal import`する
9. sourceとtargetの件数、Occurrence ID、Work ID、親子関係、リンク方向、本文を比較する
10. source/target DB、dump、SurrealKit snapshotを含む一時directoryを破棄する

成功時の観測値:

```json
{
  "surrealKitBaseline": true,
  "schemaFiles": 1,
  "managedObjects": 154,
  "items": 2,
  "links": 1,
  "ids": true,
  "linkDirection": true,
  "japaneseMarkdown": true
}
```

## 判明した注意点

### SurrealKit 0.7.0の`--folder`

0.7.0ではCLIが`--folder`を受理する一方、`DbCfg::from_env()`が
`DbOverrides.folder`を参照せず、既定の`./database`を使用する。初回検証ではこのため空schemaを
baselineし、`0 schema file(s) and 0 managed object(s)`でもcommand自体は成功終了した。

PoCは同版が参照する`SURREALDB_FOLDER`を子processだけに設定して回避した。Phase 5で採用する場合は
次のいずれかを必須とする。

- 修正版へversionを固定し、`--folder`の回帰テストを置く
- 0.7.0を使う間は`SURREALDB_FOLDER`を明示し、baseline件数が0なら失敗させる

単にexit codeが0であることをschema baseline成功条件にしてはいけない。

### schema-only exportはそのままSurrealKit schemaではない

公式CLIのexportには`OPTION IMPORT`と説明commentが含まれる。SurrealKitの管理schemaは
`DEFINE`文だけにする必要があるため、PoCでは現行schemaに限定した抽出を行った。

この抽出器は汎用SurrealQL parserではない。本実装では、抽出結果をレビューして正本の
`database/schema/*.surql`としてcommitし、起動ごとにdumpから生成しない。schema driftは
CIのbaseline/sync dry-runまたは専用照合で検出する。

### export対象は明示する

full dumpでは`--only --tables true --records true`を明示した。対象指定を既定値に委ねず、
dumpをvalidateしたうえで空DBへimportし、readback比較までを一つの受け入れ条件にする。

### importを原子的な現DB置換とは見なさない

この検証が証明したのは、空の隔離DBへのimportとreadback一致である。利用中DBへのimport、
process再接続、DB directoryのatomic swap、容量不足時の挙動は証明していない。

したがってPhase 5では次を維持する。

- 現DBへin-place importしない
- 新しいnamespace/databaseまたはcold DB directoryへ復元する
- 全体検証に成功するまでruntimeを切り替えない
- 切替失敗時は旧DBを開いたままにする

## Phase 5への結論

SurrealKitと公式CLIは、schemaの正本化、baseline、dump構文検証、空DBへの一括importを再利用できる。
特に「現DBをtransaction内で全置換する」設計を捨て、隔離DBを検証後に切り替えることで、
復元中断が現DBを部分更新する経路を除ける。

ただし、Radiora JSON backupのdecode/migration/domain invariant検証、JSONからstaging DBへの
投入計画、Desktop processの切替はRadiora側の責務として残る。公式CLIのSurrealQL dumpを
利用者向けJSON backupの代替にはしない。

この境界なら`#67`と`#69`の通常実装はSol・mediumで開始できる。Sol・highへの昇格は、
利用中DBへの書込みが避けられない、Windows cold swapの原子性を保証できない、または旧DBへ
影響する障害注入が必要になった場合に限定する。

## 参考

- [SurrealKit: existing databases](https://surrealdb.com/docs/manage/schema-migration/getting-started/existing-databases)
- [SurrealKit: sync](https://surrealdb.com/docs/manage/schema-migration/sync)
- [SurrealKit: rollouts](https://surrealdb.com/docs/manage/schema-migration/rollouts)

