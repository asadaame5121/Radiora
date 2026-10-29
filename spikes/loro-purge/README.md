# Rust Loro / SQLite purge・Undo PoC

**fixture専用の独立PoC。製品実装ではない。** 合意した境界は、実Loro UndoManagerの公開APIと、
workspaceの公開操作（編集/通常削除/完全削除/Undo/Redo/再試行/読取り）。
実データ・既存Deno版・Tauri UIは変更しない。PBT/Quintは今回導入していない。

**後続決定:** 初回v3は[workspace共通のUndo履歴](../../docs/design/v3-model-decisions.md#3-383保存doc履歴管理の検証)を採用。
このPoCの二つのsession別managerは旧方式の調査fixtureであり、製品の推奨構成ではない。
既知失敗の期待値や検証結果は変更せず保存する。共通履歴のpurge/Tree/複数pane操作は
[共通履歴fixtureの検証記録](shared-undo-results.md)で扱う（製品実装ではない）。

## 実行

通常のRust環境ではrepository rootから:

```sh
cargo test --locked --manifest-path spikes/loro-purge/Cargo.toml
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml
```

今回のWindows環境で確認した再現手順:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action demo
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action purge-scope
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action check
```

既存のGNU toolchainを使う（Rust 1.97.1 / `stable-x86_64-pc-windows-gnu`）。
必要なら`-Toolchain`で変更する。scriptはPoC内の`.cargo-home`とその`tmp`を子processのcache/TEMPに使い、
ユーザーの永続設定や既定toolchainを変更しない。今回のMSVCではC compiler起動が失敗し、
標準Cargo cache/TEMPへの子processのアクセスも拒否されたため、この範囲へ隔離した。
新しいtoolchainをinstallしたわけではない。

SQLite DBは`tempfile`で作り、demo終了時に削除する。workspace APIに実製品のDBを渡さないこと。
`target/`と`.cargo-home/`はGit対象外。

## 依存と固定version

- `loro` **1.16.2** / `loro-internal` **1.16.2**
- `loro-common` **1.16.0** / `loro-kv-store` **1.16.0**
- `rusqlite` **0.32.1**（bundled SQLite）/ `tempfile` **3.10.1**

`loro = "=1.16.2"`だけでは内部crateが1.17系へ解決されたため、
内部crateも上記へ揃えた`Cargo.lock`を残した。必ず`--locked`を使う。
最新Loroでの比較やWASM/Rust往復は今回実施していない。

## 確認したこと

### 共通履歴fixture（`SharedWorkspace`）

採用済みの「一つのworkspace・一つの共通Undo履歴」を、`src/shared.rs`の固定seedで検証する。
Loro 1.16.2の実LoroTree・実SQLiteを使い、paneはcommit originの文脈だけで履歴の選択単位にしない。

- 複数paneの同本文/別本文編集は一つのLIFO順でUndo/Redoし、別paneからのUndoも同じ履歴を動かす。
- 兄弟順move、部分木の文書間move、複数段Undo/Redoでは論理ID・親子・順序・本文を維持する。
  Tree内部IDはmove/Undo/Redoで保たれるが、Tree deleteのUndoや復元ではLoroが新しいTreeIDを作る。
- 通常削除はLoroTreeのdeleteと論理IDのTombstone記録を同じcommitに入れる。
  既に削除済みの子を親の復元で復活させず、元親liveなら兄弟目印の位置、目印消失なら末尾、
  元親deleted/purgedなら確認後に同じ論理IDの独立文書として復元する。
  **別の削除操作で作られたゴミ箱項目は独立**という採用済み仕様に従い、
  fixtureは削除時に捕捉した可視部分木だけをpurge対象にしており、
  `-Action purge-scope`と[結果7節](shared-undo-results.md#7-追加確認-親bのpurgeと以前から削除済みの子c)でCの状態を確認できる。
- 行分割相当の複合commandは一commit＝一履歴項目。SQLite失敗時は`Dirty`で後続操作を拒否し、
  retryは保存だけを行う。purgeは耐久保存成功後だけ共通Undo/Redoをclearする。
- 13件の公開操作testを`tests/shared_undo.rs`に置いた。詳細なcommand・観測・限界は
  [shared-undo-results.md](shared-undo-results.md)を参照する。

### 実Loro API（旧fixtureの記録）

- 旧WorkspaceではTombstoneをtree物理削除ではなくtrash flagで表し、通常Undo/Redoで本文と論理IDが保たれる。
- `add_exclude_origin_prefix("system:")`でpurgeを非記録にしても、古いUndo/Redo stackは消えない。
- 一つのmanagerの`clear()`は他のmanagerをclearしない。
- **通常編集のorigin分離だけでは、他sessionのUndoを自分の編集として記録し得る。**
  同一Doc/peerに二つのmanagerを付けた素朴な構成で再現し、negative controlとして残した。

### 旧workspaceと実SQLite（旧fixtureの記録）

- 同期的な単一ownerがdoc/managerを非公開に保持する。通常操作は`Ready`だけで受け付ける。
- 二つのfixture sessionをoriginで分け、replay中は他managerを`pause`し、終了時に`resume`する。
  別Blockを編集したsession間の相互Undo/Redoはこの調停で期待に一致した。
  ただし**同じ本文への複数sessionの厳密なRedo順序は未成立**（次節）。
- SQLiteはWAL＋FULL。初期snapshot一つ＋後続Updateを保存し、読戻し時にsnapshot/差分からLoroを復元する。
- 完全削除はゴミ箱・確認を要求し、本文を空にしてpurged IDをLoroへ記録する。
  本文除去とID記録は同じ差分blob/SQLite transactionで保存する。
- 保存成功後だけ全managerのUndo/Redoをclearし、`Ready`へ戻る。
- 実SQLiteのTEMP triggerでINSERTをABORTさせ、書込失敗時は`Dirty`を維持。
  編集/Undo/Redo/読取り/二重purgeを拒否し、古い残存履歴をclearしない。
  別connectionからは未purgeの保存済み状態が見え、retry成功後はpurge済みになる。
- retryは保存済みVVからの差分保存だけを行い、Loro操作を再実行しない。
  通常編集のretryではUndo履歴を消さず、purgeのretry成功時だけ全履歴を消す。
- reopen後はpurged IDと空のUndo履歴を確認。以後の新編集のUndo/Redoは引き続き使える。

## 未成立の受入：同じ本文への複数sessionのRedo

**通常test suiteの緑だけで、この問題を解決済みと扱わない。**
仕様上の期待値を変更せず、既知の失敗を`#[ignore = "..."]`で隔離して明示実行できるようにした。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action known-failure
```

このcommandは現在、**非0終了することを確認した再現command**。
対象は`tests/workspace.rs`の`session_replay_transforms*`の2件。

```text
初期: before
A編集: before A
B編集: before A B

順序1: Undo A → Undo B → Redo A → Redo B
順序2: Undo B → Undo A → Redo A → Redo B

期待: before A B
実測: before B A
```

他managerをpauseする調停はreplayの相互記録を防ぐが、このcaseの文字順まで保証しない。
Loro全体のbugと断定せず、pinned version・操作列・現調停の組合せで期待が未達という結果とする。
同一peerの複数manager方式、session別Undoの意味、別の接続方式を次段で検討する。
安易な文字列の再上書きや独自stackの追加で隠さない。期待が成立したらignoreを外す。

## 検証結果

- 通常test: **21 passed / 2 ignored / 0 failed**。3件のLoro API試験（negative control含む）
  ＋13件の共通履歴fixture＋5件の旧workspace試験。
- `known-failure`: **2 failed**。上記の未成立を明示的に再現。
- demo: 実SQLite失敗→Dirty/操作拒否→retry→全履歴clear→別connection読戻し→新編集Undoを確認。
- `cargo fmt -- --check`、`cargo clippy --all-targets -- -D warnings`を確認。

公開workspace testを先に追加して未実装エラーを確認し、最小実装で通した。
SQLite失敗のtestも先に追加してからfault controlを実装した。
session replayは実際の期待不一致を再現し、他manager pauseで別Block caseを通した。
同本文caseは未解決のまま残しており、v3のUndo完了・#383完了とはしない。
共通履歴fixtureの合格を、旧方式の失敗の解消や製品UIの完了へ読み替えない。

## 意図的に省いたもの

- 旧WorkspaceはLoroTree/兄弟順/切り出しを使わず、二つの固定IDとroot LoroTextだけを使う。
  共通履歴fixtureはLoroTreeの固定seedを使うが、参照項目/Relation、UUIDv7生成、汎用schema、既存DB移行は扱わない。
- 未保存editor draftのflush・実async queue・多thread・session追加/破棄。
  全操作は同期的で、その前の保存失敗があればpurgeを拒否する。
- commit後の応答喪失、process kill、停電、clear途中の失敗、snapshot集約、履歴GC、1万件測定。
  connectionの再openは確認したが、強制終了からの復旧を検証したわけではない。
- 物理抹消。古いsnapshot/Update/OpLogに過去本文が残ることは、採用済みの保証外。

対応する形式仕様:
[実装契約](../../docs/design/purge-undo-contract.md) /
[Alloy model](../document-model-alloy/purge_protocol.als)。
`Draining/Prepared`と`Durable/Reset`は、この同期PoCでは独立した公開状態ではなく呼出し内に折り畳んでいる。
Loro操作自体が部分失敗した場合は`RecoveryRequired`として通常retryを拒否し、再openによる復旧へ分ける。

## 次段のPBTへの引継ぎ

今回の固定操作列とAlloyの不変条件を起点に、公開workspace操作へ`Vec<Action>`等を適用する
model-based PBTを作る。形式仕様の状態を実装側の関数で再計算して期待値にするだけでは不十分。
seed/縮小後の操作列、適用前後の観測値、仕様のassertionとの対応を残す。
同本文Redoの未成立を解消する前に、通常testの緑だけでsession分離や製品Undoを完成扱いしない。

## 同本文Redoの追加調査

[公式仕様・固定版source・最小再現の調査記録](undo-research.md)を追加した。
`run.ps1 -Action trace`でLoroの内部span、公開diff、manager stackを観測できる。
SQLiteや本文updateなしの直接insertでもAB→BAが再現する。
異なるpeer/Docの比較でも同じ順序反転を確認した（`-Action peer-trace`）。
一方、片方だけをUndo→Redoする対照caseは両peerともABへ戻る。
期待値の変更や上流bugの断定はしていない。
