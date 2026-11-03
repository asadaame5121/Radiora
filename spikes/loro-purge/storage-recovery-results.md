# T-04 / #383 storage recovery fixture

2026-11-03。保存・失敗復旧・snapshot集約の独立PoC。 `tests/storage_recovery.rs`
は既存 `src/storage.rs` をincludeして使う。 request
receipt・集約・状態ownerはテスト内だけの拡張であり、製品API/schemaではない。
製品DBは扱わず、各試験が作るtemp DBだけを使用する。

## 保存境界

本文と操作metadataをLoroへ適用しcommitした後、保存済みVV以降をexportする。
SQLiteは既存Storeと同じWAL + synchronous=FULL。 差分とrequest
receiptを同一transactionで保存し、commit成功後にだけ保存済みVVを進める。
単一writerを前提とする。request
IDと本文の完全一致で再送を識別し、異なる本文の同IDを拒否する。
receiptは集約後も保持する。保存後応答喪失ではSQLiteのreceiptを照合し、mutationを再実行しない。

## 観測する不変条件

| 注入点                                | 保存済みVV / phase                | read model                          | 再開                       |
| ------------------------------------- | --------------------------------- | ----------------------------------- | -------------------------- |
| export直前の合成エラー                | VV不変 / Dirty                    | 公開禁止、別接続は旧本文            | 完成済みmutationだけ再保存 |
| SQLite INSERT失敗                     | VV不変 / Dirty                    | 公開禁止、別接続は旧本文            | trigger解除後retry         |
| SQLite COMMIT失敗                     | VV不変 / Dirty                    | 公開禁止、差分・receiptともrollback | retry                      |
| 本文更新後、metadata更新前            | VV不変 / RecoveryRequired         | 公開禁止、DBは旧本文                | retry禁止、reopen          |
| 保存後応答喪失                        | 呼出元VV不変 / Dirty、DBは新本文  | 公開禁止、別接続は新本文            | receipt照合でReady         |
| request ID再送                        | VV不変、追加差分なし              | 保存済み本文                        | 同ID異payloadは拒否        |
| commit直前kill                        | 新processは旧snapshot＋差分を復元 | 旧本文                              | 再起動                     |
| commit直後kill                        | 新processは新差分を復元           | 新本文                              | 同ID再送でもVV不変         |
| snapshot更新後・差分削除前の失敗/kill | transaction rollback              | 新processで集約前と同じ本文         | 再集約可能                 |
| 依存不足update                        | 復元/集約を拒否、差分を保持       | 公開しない                          | 欠けた依存の回復が必要     |

commit失敗はdeferred foreign key違反をCOMMIT時に発生させる実SQLiteエラー。
export失敗はexport呼出し直前に合成エラーを返す。Loro内部のexport故障の再現ではない。
killはstdout handshake後に親processがChild::killで強制終了する。
電源断やディスク物理障害の試験とは区別する。

snapshot集約は保存済みDBからdocを復元してexportし、snapshot置換と差分削除を一transactionにする。
pending importを検出したらsnapshotを書き換えず拒否する。
既存Storeのrestoreは各updateのpendingを即時拒否するため、依存が後着する並びの並べ替え/回復は対象外。

## 実行

```powershell
# mise shimによるRust自動導入を避け、既存rustupの指定toolchainを使用
$env:PATH = 'C:\Users\Yudai\.cargo\bin;' + $env:PATH
& spikes/loro-purge/run.ps1 -Action test
& spikes/loro-purge/run.ps1 -Action check
```

最終版: testは28 passed / 2 ignored / 0
failed（追加7件＝試験6件＋子process入口1件）。 check（fmt --check、clippy
--all-targets -- -D warnings）は成功。
実効PRAGMAは各fixtureでjournal_mode=wal、synchronous=2（FULL）をassertした。
Windows / stable-x86_64-pc-windows-gnu、loro 1.16.2（logging）、rusqlite
0.32.1（bundled）、既存Cargo.lock固定。 初期の実行失敗と復旧手順は担当報告
report-383-storage.md に記録。

## 境界と引継ぎ

- 既存Storeのappend/restoreとwrite
  triggerを再利用。request/集約はfixture内の実験。
- 共通Undo、crates/、1万件性能測定、frontend移植は変更しない。
- p4測定向けの公開API追加なし。測定で必要なら保存済みVV→export→transaction
  commitの区間を分ける。
- receiptの保持期限、多writer、破損DB救済、製品のschema/ID/エラーDTOは未設計。
- #381/#382の未決仕様はこのPoCで決定しない。要ユーザー判断は製品契約の担当で扱う。
