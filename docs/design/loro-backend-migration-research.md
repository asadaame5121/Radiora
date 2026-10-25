# Loro Backend移行の障壁と先行PoC

状態: 調査・計画。実装、ベンチマーク、Rust/WASM往復試験は未実施。
照合基点: `poc/loro-undo` `faa8c16`、ローカルmain `8acc2af`。
関連: [Tauri移行計画](tauri-migration-plan.md) §6.5 / M0-L。

## 1. 結論と調査範囲

BackendのLoroをSSOT、SQLiteをsnapshot＋差分Updateの永続化先にする。
ControllerはBackend APIからread modelと操作結果を受け取り、Loro自体を保持しない。
通常の保存成功は差分のSQLite transaction成功まででよく、全snapshot保存を毎回待つ必要はない。

「WASM/Rustは共通実装」「内部可変性で借用を扱いやすい」は移行可能性の根拠になる。
ただし、現行recordのデータモデル変換、業務上の原子性、session別undo、耐久化・公開順序の証明ではない。
ライブラリ互換性とアプリ移行の安全性を分ける。

以下の一次資料と現行コードを改めて照合した。Web文書は更新され得るため、PoCでは実際のlockfileも結果に添付する。

## 2. 一次資料で確認できたこと

### 2.1 WASMとRustの共通部分と違い

公式タグ `loro-crdt@1.16.4` には、WASM package `loro-wasm` 1.16.4とRust crate `loro` 1.16.2が含まれ、
両方が `loro-internal` に依存する。WASMでは `wasm` / `counter` / `jsonpath` featuresが有効。
Rustではdefaultが `counter`、`jsonpath` は任意。共通engineだが公開API、features、配布version番号は同一ではない。
Cargoのversion要求だけでなく解決済みのlockfileを固定して比較する。

- [WASM Cargo.toml（固定タグ）](https://github.com/loro-dev/loro/blob/loro-crdt@1.16.4/crates/loro-wasm/Cargo.toml)
- [Rust Cargo.toml（固定タグ）](https://github.com/loro-dev/loro/blob/loro-crdt@1.16.4/crates/loro/Cargo.toml)

公式は1.0以降のdata formatの安定を明記し、snapshotとUpdateを共通のimportで読み込める。
これはbinaryの互換性を期待できる根拠であり、Radiora schemaや旧SQLite recordが自動変換される保証ではない。
[Export Mode](https://loro.dev/docs/tutorial/encoding)

### 2.2 所有・ライフタイム・並行実行

Rustの `LoroDoc` の更新APIは `&self` を受け、docs.rsでは `Send` / `Sync` が実装されている。
`clone()` は同じ内部docを共有し、独立copyではない。独立した `fork()` は別peerとなり時間・空間O(n)。
docのdropで関連containerは無効化される。したがってdocとUndoManager/購読の寿命をBackend ownerへ閉じ込める。
[LoroDoc 1.16.2](https://docs.rs/loro/1.16.2/loro/struct.LoroDoc.html)

**設計上の判断**: 借用エラーを減らせても、業務操作全体の排他性は得られない。
commandごとにcloneして別taskで変更しても、変更先は同じdoc。
初期はdoc単位の単一writer queueで検証→変更→export→SQLite commitを直列化する。
Mutexをasyncのawait越しに保持する構成や、購読callbackからownerへ再入する構成は避ける。
Tauri commandは配線と委譲に留め、重い同期処理は適切なworkerへ置く。
[Tauri Calling Rust](https://v2.tauri.app/develop/calling-rust/)

### 2.3 Loro commitはDB transactionではない

公式APIはtransactionにrollback/isolationがないことを明記する。
`export` / `import` / `checkout` も暗黙commitを起こす。`origin` はローカル用で永続化されず、
commit messageは永続化される。Loroの通知やcommitだけではディスク保存完了にならない。
[LoroDoc::commit](https://docs.rs/loro/1.16.2/loro/struct.LoroDoc.html#method.commit)

**設計上の判断**: ここが保存の最大の障壁。
SQLite失敗後のdirty保持と、複数Loro操作の途中失敗への対処は別々に検証する。
`clone` で退避したつもりになることや、undoをDB rollback代わりにすることは禁止する。
read modelは耐久化した版から公開し、内部イベントを即座に保存成功扱いしない。
保存中・dirtyのdocへの通常queryも調停し、未保存値を漏らさない。保存済みread modelを返せなければ
明示的なエラーにし、保存失敗を待ち続けるread queueを作らない。

### 2.4 文字位置と本文更新の計算量

Rustの通常の `insert` / `delete` はUnicode scalar単位。UTF-8 / UTF-16用APIと位置変換が別にある。
JSのcaret offsetを通常のRust APIへそのまま渡さない。`update` は全文の最小diffを計算し、
公式は大きな本文（例: 50,000文字超）で時間がかかり得るとして `update_by_line` を案内する。
[LoroText 1.16.2](https://docs.rs/loro/1.16.2/loro/struct.LoroText.html)

**設計上の判断**: 差分binaryが小さくても、全文文字列から差分を求めるCPU費用は別に残る。
本文全体を渡す既存portを維持する場合も、この時間をDB時間に混ぜず測る。

### 2.5 永続化、履歴、undo

公式推奨は差分を頻繁に保存し、全snapshotを定期保存する構成。
復元はsnapshot＋Updateをimportし、新snapshotで取り込み済み差分を集約できる。
[Persistence](https://loro.dev/docs/tutorial/persistence)

snapshotは状態と操作履歴を含み、差分ファイルを削除してもLoro履歴自体のGCにはならない。
shallow snapshotには古い版と並行するUpdateをimportできない制約があるため、初回移行では導入しない。
[Export Mode](https://loro.dev/docs/tutorial/encoding)

`import` 成功でも `ImportStatus.pending` が残り得る。復元完了判定に含める。
任意順・重複に対する収束は、業務commandの二重実行防止とは別。
[LoroDoc::import](https://docs.rs/loro/1.16.2/loro/struct.LoroDoc.html#method.import)

UndoManagerは単一peerを追跡し、peer変更でstackをclearする。
Backendで全操作を同じpeerから発行すると、他ペイン変更を除外する既存session契約を自動では満たさない。
[Undo/Redo](https://loro.dev/docs/advanced/undo)

### 2.6 SQLiteの「一桁ms」の前提

SQLite公式はWAL＋FULLで耐久性を確保する一方、WAL＋NORMALでは停電・system crashで
commit済みtransactionが戻り得ると説明している。DELETE＋FULLの停電耐久性もfilesystem依存があり、
EXTRAとの違いがある。「commitが返った」の保証はjournal/synchronous設定まで含めて定義する。
[SQLite synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)

ローカルSSDで一桁msになる可能性は否定しないが、公式資料からRadioraの数値は出せない。
差分保存は主にencode量・payload量を抑える。transaction数・sync待ち・writer queueは自動的には減らない。
またLoroのcheckpointとSQLite WAL checkpointは異なり、後者による遅延も測定対象。

## 3. リポジトリと照合した障壁

| 優先度 | 根拠・現状 | 必要な対応・証拠 |
| --- | --- | --- |
| P0 | 現行[SQLite schema](../../src/storage/sqlite_schema.ts#L1)はversion 2、17種のrecordとJSON payload | 全種類の保存・export/restore対応表を作る。旧DB→新Loroの値・ID・順序・日時を照合。未知データを黙って落とさない |
| P0 | [SqlitePersistence](../../src/storage/sqlite_persistence.ts#L60)は局所rollbackと全体restoreを使い分ける | Loroには同じrollbackがない。保存失敗・途中適用失敗を隔離し、後続保存へ混入させない |
| P0 | [既存PoC](../../spikes/loro-undo/loro_outline_store.ts#L163)はノードごとに本文、[本番](../../src/services/occurrence_operations.ts#L125)はBranch Working Copy更新 | Branchごとの本文を複数Occurrenceが参照するモデルへ。pinnedの編集拒否と別Branch分離を保持 |
| P0 | Loro docの分割単位が未決定 | まず全体1 docを性能仮説として測る。複数docを採るならdoc間参照と複合更新の原子性を設計し、便宜的な分割をしない |
| P0 | mainのADR 0003は限定導入案（文面上Proposed） | 新方針との置換関係を次ADRへ記録。既存UI/永続化契約の変更を実装PRで追跡 |
| P0 | main契約はペイン別undo。Backend共通peerでは他ペイン変更もlocalになる | 2ペイン同Branchで独立undoを試験。peerを操作ごとに切り替えるだけではstackを失う |
| P1 | [PoCのexportUpdate](../../spikes/loro-undo/loro_outline_store.ts#L326)は `from` 指定なし | 増分保存の性能証拠ではない。保存済みVVからexportし、成功transactionだけでVVを進める |
| P1 | [PoC検索](../../spikes/loro-undo/loro_outline_store.ts#L397)は毎回全node走査、[items](../../spikes/loro-undo/loro_outline_store.ts#L265)は全体JSON化 | PoC固有の走査をLoro engine費用と区別。製品では業務ID→生存nodeの派生索引と対象readを検証 |
| P1 | 削除undoでTreeIDが変わる（既存PoC/README）、binaryには内部IDが含まれる | 業務IDは維持し内部handleを再解決。「内部IDの保存禁止」ではなく「業務/RPC IDへの流出禁止」に精密化 |
| P1 | Revision/Recovery Snapshot、検索、backup等が既存永続化対象 | Loro履歴へ自動置換しない。未提供画面のデータも保持。検索索引は再生成可能な派生にする |
| P1 | [bootstrap](../../src/storage/storage_bootstrap.ts#L57)は旧パス・legacy migration markerに依存 | Tauri新パス・別DB・コピー整合性・schema拒否・rollbackを検証。WASM binary互換性とは別課題 |
| P1 | Tauri invokeは非同期、UIに要求世代とdraft所有がある | 保存済み版とrequest IDを返し、応答喪失再試行と旧応答を区別。内部Loro型・任意SQLを公開しない |

main側ADR/設計の照合は `git show main:docs/adr/0003-loro-edit-session-undo.md` と
`git show main:docs/design/loro-edit-session.md` で実施した。本branchにはそれらがないためコピーして重複文書を作らない。
Undo stackがsnapshotに含まれない点は既存JS PoCの報告であり、Rustでの再検証対象とする。

### 3.1 現行モデルからLoroへの対応案

以下はユーザー共有の他エージェント会話要約を、[現行モデル](../../src/domain/models.ts#L31)と照合した設計案。
要約自体は一次資料や実測結果として扱わない。Backend Loro SSOTの方針は維持し、具体的なcontainer構成はPoCで検証する。
**追加提供された[Topicルート/文書設計](topic-document-design.md)により、「Topic＝Work」という先の整理を訂正する。**
文書は最上位block＋子孫、タイトルもblock、内部block参照が必要という製品方針があるが、
Work/Occurrenceとの一対一対応は未決定。以下は旧データ互換の候補であり、目標製品schemaの確定ではない。

**旧モデルの互換案では、LoroTreeはWorkの木ではなくOccurrence（配置）の木とし、本文はBranchごとのLoroTextへ置く。**
新しいblock/documentモデルへ単純化する範囲は、文書境界・ID・共有の判断後にこの対応案と比較する。

| 現行データ | Loro内の候補 | 保持する契約 |
| --- | --- | --- |
| Work | `works: Map<workId, Work metadata>` | 安定ID、日時、論理削除、stub、merge先、historicalTimeを保持。Workは配置なしでも存在する |
| Branch | `branches: Map<branchId, Branch metadata>` | workId、headRevisionId、名前・日時を保持。Loroのpeerやforkを製品Branchの代わりにしない |
| WorkingCopy | `workingCopies: Map<branchId, Map>` 内の `text: LoroText` とmetadata | Branchごとに本文1つ。workIdとupdatedAtも保持。同Branchの複数配置から参照する |
| Occurrence | `occurrences: LoroTree` のnode metadata | occurrenceId、workId、revisionSelector、collapsed、contextualHeadingを保持。配置自体には共有本文を持たせない |
| Revision | `revisions: Map<revisionId, Revision record>` | 本文は不変の文字列、parentRevisionIdsとkind等も保持。CRDT操作履歴をRevision DAGに流用しない |
| RecoverySnapshot | `recoverySnapshots: Map<snapshotId, RecoverySnapshot record>` | 採取時の本文文字列、hash、保護、sourceRevisionId等を保持。永続化用Loro snapshotとは別 |
| 明示semantic link・関係型定義 | 業務IDをkeyにするMap | Work/Revision endpoint、型、状態、由来、日時等を保持。Occurrenceの親子edgeとは混ぜない |
| Bookmark・ResumePosition | 既存の識別単位をkeyにするMap | occurrenceId参照と保存済みcaret等を保持。瞬間的なfocusや未保存draftは含めない |
| alias・保存query・提案/feedback・purge manifest等 | 種類別のMap | 現行17種類のrecordを全件対応付ける。画面や機能の保留をデータ廃棄の理由にしない |

概念上の参照例:

```text
Occurrence O1 ─┐
               ├─ Work W1 / Branch B1 → WorkingCopy B1.text
Occurrence O2 ─┘
Occurrence O3 ─── Work W1 / Branch B2 → WorkingCopy B2.text
Occurrence O4 ─── Work W1 / pinned R1 → Revision R1.text（編集不可）
```

O1を移動・削除してもW1/B1の削除とはしない。O1から本文を編集したらO2にも同じ本文が見える。
複数配置は同じTree nodeの複数親ではなく、異なるOccurrence nodeから同じWork/Branchを参照して表す。
削除undoでLoro TreeIDが変わってもOccurrence IDは維持し、業務ID→生存nodeの索引を再解決する。
この例は参照規則を示すもので、全フィールド・migration schemaの定義ではない。

**正本を重複させないための未決事項**:

- 親・兄弟順をLoroTreeの正本にする案を試す。既存 `parentOccurrenceId` / `orderKey` は移行入力とDTOの互換表現とし、
  別Mapの独立したwriterにはしない。移行時は既存の安定順を保持し、将来のorderKey生成規則と同順位の扱いをPoCで固定する。
- `OutlineItem` / 検索結果 / 可視行は上記データを解決したread modelとし、表示本文を別の保存正本にしない。
  既存SystemRelation/Knotは単純に廃棄せず、ID・日時を含む保存契約を調べて、正本と派生の分類・移行方法を決める。
- doc分割はまず全体1 docで検証する。Workごとに分ける場合は、配置・link・複数Work操作のdoc間原子性が追加課題になる。
- Loro binary formatの互換性とRadioraのdoc schema互換性は別。doc内 `schemaVersion` とSQLite envelope versionを分け、
  旧versionのvalidate→変換→保存→再起動確認をmigrationとして実装する。未知versionは非破壊で拒否する。
- SQLiteはbinaryの耐久保存を担当し、検索・表示索引を持つ場合もLoroの保存済み版に紐付く再生成可能な派生に限定する。
  「LoroとRDBの役割が違う」ことを、業務recordをSQLiteの第二の正本に戻す理由にはしない。

### 3.2 合意した永続化snapshotの保持

最新1世代の全snapshotと、それ以降の差分だけを通常の復元経路として保持する。
新snapshotへの置換・取り込み済み差分の削除を同じSQLite transactionで実行し、失敗時は旧組合せを残す。
日数で期限切れにしない。集約の件数/bytes閾値はPoCで復元時間・編集待ち時間と併せて決める。

これは内部操作履歴のGCではない。shallow snapshotによる履歴削除は別判断とし、初回PoCでは有効にしない。
製品Recovery Snapshot、Revision、障害用backupにはそれぞれ別の保持方針を適用する。
SQLite上の削除後もDBファイルが即座に縮むとは限らないため、論理payload量とDB/WAL実容量の両方を測る。

## 4. 先行PoCの仕様（未実装）

### 4.1 スコープと成果物

独立した `spikes/loro-storage/` を次の実装候補とする。製品DB・production codeは変更しない。
Rust CLI（Loro＋SQLite）と既存WASM版のfixture生成/比較を用意する。
Loro/SQLite wrapper/SQLite engine、features、Cargo.lock/npm lock、OS、CPU、ディスク、build profile、
seed、journal/synchronousの実効値を記録する。CLIの再現commandは実装時に確定しREADMEへ載せる。
本書には未存在の実行commandや測定結果を記載しない。

### 4.2 データと試験の規模

- **1万件のデータ**と**1万回の操作**を分ける。基準は10,000 Works、各1 Branch/Working Copy、
  10,000 Occurrencesと20,000明示links。複数配置・別Branch・pinned・Revision/Recoveryも追加し件数を明記する。
- 通常fixtureは本文1件1 KiB程度の日本語混在。別fixtureで50,000文字超の本文、emoji、結合文字、CRLF、
  深い階層、同じ親への多配置を試す。文字数とUTF-8 bytesを両方記録する。
- 1,000 / 10,000 / 可能なら30,000 Worksを同じseed・分布で比較。fixture作成・初期保存は通常保存計測から除外。
- 単件本文編集、構造追加/移動/削除/undo、link変更を別系列にする。通常保存の基準は各操作を独立に耐久化。
  batchは別系列とし、1万回を1 transactionへまとめた結果で単件保存の速さを主張しない。
- 1万回の本文更新で履歴を蓄積し、前半/後半の遅延・snapshot量・メモリと復元時間を比較する。

### 4.3 正しさを先に検証

1. WASM→Rust→WASMと逆方向でsnapshot＋追加Updateを往復。
   JSONのbyte同一性ではなく、正規化した業務データ・参照・順序・版を比較する。
   復元後の追加編集も試し、runtime設定を再適用する。
2. Branch本文共有、別Branch分離、pinned拒否、削除undo後の業務ID、2ペインの独立undoを検証する。
   undoの重複・日本語caret位置・複合操作の1 stepも含む。
   「作成→本文編集→削除→undo×2→redo×2」で、本文・Occurrence ID・親子関係・本文containerの参照を照合する。
   要約にある「複数step redoで本文が失われる」という報告は出典未検証・未再現であり、既知の不具合とは断定しない。
   別試験として、delete-undoで現在値へ併合されない他peerの編集を履歴から回収できるか調べる。
   undo、履歴プレビュー、競合データ救出は区別し、共同編集機能の提供を今回の完了条件に追加しない。
3. snapshot＋差分で再起動復元し、保存済みVVと復元結果を照合する。
   順序逆転・重複・欠損・破損・別docのblob・未知formatを試す。doc IDはアプリ側envelopeで検査する。
4. export失敗、SQLite write/commit失敗、複合操作途中失敗を注入する。
   保存済みVV・read modelを進めず、dirtyとUI draftを保持し、後続mutationを止める。
   retryでLoro操作を二重適用せず、保存だけを完了できること。
5. SQLite commitの直前/直後・応答前に子プロセスを終了し、独立processで再起動。
   成功応答を返した操作はすべて残る。応答前でもcommit済みなら残り得るため、request IDで結果照会・再試行する。
6. checkpointの新snapshot保存・差分削除の間で失敗/終了しても復元可能。
   依存待ちUpdateがある状態では集約を拒否する。pendingがsnapshotだけで残るかは別の再現試験とし、未確認の保持に依存しない。
7. 旧DBのコピーを別DBへ変換し、17種類すべての値と関連を照合。再実行・途中失敗・未知schema・旧版への復帰を試す。
   新版編集後の旧形式export/importは別gateとし、合格前に無損失rollbackを約束しない。
   SQLite schemaだけでなく、Loro doc内部schemaのフィールド追加・変換・未知version拒否も試す。

プロセス終了試験で停電耐久性までは証明できない。性能のために保証を落とす場合は別の承認事項とする。

### 4.4 測定と判定

比較対象は (A)毎回全snapshot保存、(B)保存済みVV以降の差分保存＋定期snapshot、(C)可能なら現行保存経路。
全方式で同じ操作・耐久性条件を使う。現行設定の比較は条件差を明示し、同等保証の比較と区別する。

- Rust release build・実ディスク上の専用DBを使う。`:memory:` やtmpfsの速さを耐久保存の結果にしない。
- WAL＋FULLを基準候補としDELETE＋EXTRA等を比較。NORMALは保証の異なる参考系列。実効PRAGMAを必ず読む。
- warm-upと反復数を固定し、通常操作は各系列1,000回以上、3反復以上。
  計測ログはoperation IDごとに残し、p50/p95/p99/max、失敗/timeoutを報告する。
- 分解: queue待ち、検証/Loro操作、本文diff、commit、差分export、SQLite transaction、read model、
  IPC往復、UI入力→保存済み表示。SQL statement/transaction数、blob bytes、DB/WALサイズ、メモリも採る。
- checkpoint生成/SQLite保存と、その間の編集待ち、SQLite WAL checkpointによる外れ値を別記する。
  snapshotのみ・差分1,000件・10,000件からの起動復元時間も測る。OS cold cache未制御ならその旨を書く。
- **仮説**: 10,000 Worksで単件の「差分export開始→SQLite commit成功」p95 < 10ms。
  検証やqueue/IPCを除いた数字なので、操作全体のp95 < 100msという移行計画の仮目標も併記する。
  正式な性能gateは対象端末で合意する。中央値だけ一桁msでも合格とはしない。

正しさの試験が失敗した方式を速度だけで採用しない。未達ならまず時間内訳を見る。
batch/debounce、doc分割、派生索引、snapshot周期は測定結果から必要なものだけ選び、先行で全部作らない。

## 5. 今回の終了点

計画と一次資料・コード照合まで。PoC実装、crate追加、DB変換、既存ADRの置換、実データ外部送信は行っていない。
次の実装単位はM0-L。結果が出るまでは「Rustへ容易に移行済み」「一桁msで保存できる」とは記録しない。
