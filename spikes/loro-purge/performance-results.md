# #383 規模性能・Rust/WASM往復

測定日: 2026-11-03。独立spikeの証拠。製品UIや正式性能gateの承認ではない。

## 固定条件

- Rust loro 1.16.2 / logging、rusqlite 0.32.1 / bundled。Cargo.lockの既存解決versionを維持し、JSON正規化用serde_json 1.0.154を直接依存に追加。
- WASM loro-crdt 1.16.2をspike内package-lock.jsonで固定。上位package.jsonは変更しない。
- Windows GNU toolchain、release build。環境詳細は各出力directoryのenvironment.json。
- seed 383、1,000 / 10,000 / 30,000 Block。通常80%、参照項目20%。参照項目は本文owner IDだけを持つ。
- 各規模に明示Relation 20,000件、親IDと兄弟順を別containerへ記録する最小モデル。製品schemaの提案ではない。
- 本文は日本語・ASCII・emoji・結合文字・CRLF混在の約1KiB。正確な文字数/UTF-8 bytesはsummary.csvのmetadata。
- 長本文（50,000文字超）、深さ256の実LoroTree、同一ownerの同一親への複数参照を別fixtureでsnapshot往復assert。
- WAL+synchronous=FULL と DELETE+synchronous=EXTRA。実効PRAGMAをassert。NORMALへの保証低下はしない。
- 同じseed、各設定50回warm-up（別doc/DB）。1,000/30,000 Blockは各1,000回、10,000 Blockは各10,000回。
- 全操作で本文の先頭ASCII文字を反転して実変更を保証。同期単一writer。no-opを操作回数に含めない。
- 1操作ごとに差分をexportし、SQLite transactionで1 INSERTしてcommit。batch/debounceなし。
- 5回の復元時間は同process・OS page cache warm系列。別process/crash復元は保存担当の試験に分離する。

## 時間と容量の読み方

operations.csvは全操作のraw値。summary.csvはnearest-rankのp50/p95/p99/max。
validation、本文準備、Loro update（内部diffを含む）、Loro commit、差分export、
SQLite transaction、保存後read model、export開始→SQLite commit成功、操作全体を分ける。
Loro内部のdiffだけをAPI外から分離測定したとはしない。
同期queueなので競合queue待ちを測れず、IPC/UI入力→保存済み表示はこのCLIの対象外。
未測定区間をゼロとみなしたend-to-end主張はしない。

DB/WAL容量はcheckpoint前に採取する。差分blob総量・transaction数・INSERT/BEGIN/COMMIT数も記録。
復元はsnapshotのみ、差分1,000件、主系列では10,000件を測定する。
同stage名restore_0_updatesの先頭は初期snapshot、末尾は集約後snapshot。
snapshot exportとそのSQLite置換＋差分削除を分離し、同期writerを塞ぐ時間として記録。
SQLite WAL checkpointはLoro snapshot集約とは別区間。
memory.jsonは測定process全系列のpeak working set（100ms間隔）であり、
個々の規模に帰属させる常駐メモリやmanaged heap値ではない。
操作のエラーはprocess失敗として停止し、成功完走時にfailures=0を記録。
over_1000msは遅延観測であり、非同期timeoutの試験ではない。

## 再現

```powershell
$env:PATH = 'C:\Users\Yudai\.cargo\bin;' + $env:PATH
$env:CARGO_HOME = "$PWD/spikes/loro-purge/.cargo-home"
$env:TMP = "$env:CARGO_HOME/tmp"
$env:TEMP = $env:TMP
$env:TMPDIR = $env:TMP
cargo +stable-x86_64-pc-windows-gnu build --release --locked --manifest-path spikes/loro-purge/Cargo.toml --example storage_perf --example interop
& spikes/loro-purge/run-perf.ps1
# 出力先既存DBは上書き拒否。runごとに新directoryを指定できる。
& spikes/loro-purge/run.ps1 -Action test
& spikes/loro-purge/run.ps1 -Action check
```

相互運用（spike内でnpm ci --ignore-scripts --workspaces=falseを先に実施）:

```powershell
$fixture = 'spikes/loro-purge/perf-artifacts/interop'
& spikes/loro-purge/target/release/examples/interop.exe export $fixture
node spikes/loro-purge/interop.mjs $fixture
& spikes/loro-purge/target/release/examples/interop.exe verify $fixture
node spikes/loro-purge/interop.mjs $fixture verify
```

Rust snapshot＋Update→WASMで本文/参照/順序/VersionVectorを比較。
WASM snapshot＋WASMで生成したUpdate→Rustで同じ正規化データとVVを比較。
さらにWASM全snapshotからの復元とdelta経路を照合する。mapのキー列挙順は業務順序としない。
encoding/export modeの根拠: [Loro公式](https://loro.dev/docs/tutorial/encoding)。
実際の互換性は固定1.16.2同士の往復assertで判定する。

## 実測結果

最終採用系列: `perf-artifacts/measured-20261103-verified/`（2026-11-03 22:19 JST開始）。
全6系列・24,000操作が終了コード0で完走。集計を[performance-summary.csv](performance-summary.csv)に保存。
raw operations.csv、DB、stdout/stderr、environment.json、memory.jsonは同directoryにローカル保持（git対象外）。

環境: Windows 11 Home 10.0.26200、AMD Ryzen 5 3500U（4 core / 8 logical）、
可視RAM 14,590,192KiB、C: のKIOXIA EXCERIA G2 NVMe SSD（1,000,204,886,016 bytes）。
rustc 1.97.1（8bab26f4f）、LLVM 22.1.6、x86_64-pc-windows-gnu。
Node 24.22.1、loro-crdt 1.16.2。操作系列の本文は578 Unicode scalar / 1,024 UTF-8 bytes。
長本文fixtureは80,008 scalar / 180,018 bytesでsnapshot復元一致。
全系列のpeak working setは253,067,264 bytes（241.34MiB）。規模別のメモリ値ではない。

### 差分export開始→SQLite commit成功（ms）

| Block | 設定 | 操作数 | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | WAL_FULL | 1000 | 1.076 | 1.569 | 2.624 | 15.953 |
| 1,000 | DELETE_EXTRA | 1000 | 8.811 | 30.125 | 48.586 | 89.713 |
| 10,000 | WAL_FULL | 10000 | 1.109 | 1.558 | 3.183 | 74.646 |
| 10,000 | DELETE_EXTRA | 10000 | 7.288 | 19.952 | 62.335 | 3273.976 |
| 30,000 | WAL_FULL | 1000 | 1.138 | 1.768 | 3.287 | 72.172 |
| 30,000 | DELETE_EXTRA | 1000 | 6.409 | 15.600 | 31.280 | 102.127 |

**10,000 Blockでp95 < 10msの仮説はWAL/FULLで達成、DELETE/EXTRAでは未達。**
この最小本文変更fixtureについての結果であり、製品操作全体・実UIの応答保証ではない。
初回系列の同区間p95はWAL/FULL 1.636ms、DELETE/EXTRA 21.807ms。
初回ラッパーのexit_codeがnullだったためhandle保持を修正し、
成功0/失敗7のprobe後、全系列を再実行した。表は再実行だけの分位値で、2回の値を混ぜていない。

### 操作全体（ms）

| Block | 設定 | 操作数 | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | WAL_FULL | 1000 | 1.193 | 1.756 | 2.808 | 16.069 |
| 1,000 | DELETE_EXTRA | 1000 | 8.949 | 30.232 | 48.698 | 89.821 |
| 10,000 | WAL_FULL | 10000 | 1.223 | 1.698 | 3.305 | 74.774 |
| 10,000 | DELETE_EXTRA | 10000 | 7.416 | 20.103 | 66.174 | 3274.091 |
| 30,000 | WAL_FULL | 1000 | 1.261 | 1.908 | 3.400 | 72.277 |
| 30,000 | DELETE_EXTRA | 1000 | 6.527 | 15.706 | 31.398 | 102.236 |

Loro更新やread modelのほか、本文をString化して先頭ASCIIを反転する準備も含む。
編集先は5Block毎の先頭通常Block。read modelは当該本文の取得だけで、
参照項目へのfanout、Relation再投影、Tree graph構築の費用は含まない。
実UI draft、IME、IPC、競合queue待ちを加えたend-to-end測定は未達。

失敗操作0。DELETE/EXTRAの10,000 Block系列だけ1操作が1秒超（最大3.274秒）。
他系列は1秒超0。同期CLIにtimeout機能はなく、これをtimeout試験成功とは呼ばない。
内訳ではSQLite区間が支配的。journal/sync設定以外にも実機のbackground負荷等が混ざり、
外れ値のOSレベルの原因は特定していない。他processを停止した隔離環境ではない。

### 復元と集約

10,000 Block / WAL FULLの復元p50 / p95:
初期snapshotのみ15.704 / 28.252ms、
差分1,000件252.299 / 279.163ms、
差分10,000件914.977 / 1,356.960ms、
集約後snapshotのみ61.498 / 76.761ms。
5反復しかないためnearest-rankのp95/p99はmaxと同じ。cold start保証ではない。

WAL FULLのLoro snapshot集約は10,000 Blockでexport 186.492ms＋SQL 33.347ms、
30,000 Blockで412.156ms＋166.876ms writerを塞いだ。
SQLite WAL checkpointは別途summary.csvに記録。
集約は各系列1回なので分位値の一般化はしない。
集約後snapshotは全履歴を保持し、shallow snapshot/内部履歴GCは行っていない。

10,000 Block / WAL FULLの集約前DB 3,227,648 bytes、WAL 4,120,032 bytes、
初期snapshot 2,050,721 bytes、10,000差分blob合計1,068,539 bytes。
DELETE EXTRAはDB 3,235,840 bytes、WALなし。
1,000/30,000 Blockを含む全容量・段階別時間・SQL回数はCSVのmetadata/各stage参照。

### 判断と後続

WAL/FULLを維持したまま、実製品の本文・参照投影とqueue/IPC/UI測定へ進める証拠にはなる。
DELETE/EXTRAを同じ10ms仮説で合格扱いにしない。NORMALへ落とす変更もしていない。
SQL支配の未達に対する候補はbatch/debounceだが、保存成功の意味やdraftの寿命を保って別途検証する。
差分10,000件の復元と集約時の停止を踏まえ、差分件数/bytes/復元時間でcheckpoint周期を測定する。
1,000件程度を比較候補にできるが、今回の1run値から製品閾値を確定しない。
単一Docを分割する根拠は今回得ていない。

### 検証

- release Rust→WASM→Rust→WASMでsnapshot＋Update、正規化データ、参照、順序、VV一致: PASS。
- run.ps1 -Action test: 28 passed / 2 ignored / 0 failed。前回storage_recoveryは7件全成功。
- run.ps1 -Action check: fmt check / clippy all-targets -D warnings成功。
- run-perf.ps1最終版: exit 0、memory.json exit_code=0。既存の出力directoryは拒否。
- 新規変更はspike内のみ。Git操作・Issue更新・製品DB操作なし。
- #383全体のclose、正式gate、G2/G3承認とはしない。

