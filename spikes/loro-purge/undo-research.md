# 同本文Redoの仕様調査と最小再現

## 結論

「最後に行われたBの編集が正なのでBAになる」という仕様は確認できない。
公式文書はむしろ「Redo after undo should return to the original state」と説明する。
ただし、単一peerをoriginで二つのUndoManagerへ分割する構成の全体的な往復保証は明記されていない。
現時点では期待値ABをBAへ変更せず、未成立の受入として残す。上流bugとも断定しない。

**調査後の製品決定:** 初回v3はworkspace共通のローカルUndo履歴を採用し、
pane/session別の独立Undoと独自の選択的Undoは初回対象外とした。
文書モデル・単一Doc・保存方式は変更しない。
以下の失敗は旧方式の診断として残し、初回v3の独立session Undo受入からは外す。
共通履歴でのTree・複合操作・purgeの成立は、この調査の成功caseだけでは保証しない。
正本は[決定事項](../../docs/design/v3-model-decisions.md)。

追加比較では、異なるpeer/Docに一つずつmanagerを置いても同じBAを再現した。
origin除外・pause/resumeは使っていない。したがって、この現象は同一peerのmanager調停に限定されない。
一方、他方の編集を保持したまま片方だけUndo→Redoする対照caseは、両peerともABへ戻った。
公式説明の単独往復と、途中に他peerのUndo/Redoを挟む全履歴の往復を区別する必要がある。

## 一次資料と保証の範囲

1. [公式Undo文書](https://loro.dev/docs/advanced/undo)
   - Undo/Redoはlocalであり、他のcollaboratorの操作を取り消さない。
   - 一つのmanagerが追跡するのは一つのpeer。peer変更時は履歴を消す。
   - Undo/Redoは要素を削除・再生成する。過去要素の安定位置をそのまま復活させる方式ではない。
   - Implementation節はOTベースであることと、remote insertを消さない、Undo後のRedoは元の状態へ戻る、
     concurrent editがなければUndoは前versionへ戻る、という性質を挙げる。
   - このページは更新される現行文書であり、1.16.2に固定した仕様書ではない。
2. [Rust 1.16.2 UndoManager](https://docs.rs/loro/1.16.2/loro/struct.UndoManager.html)
   - peerに属するlocal操作をUndo/Redoする。origin prefixによる記録除外を提供する。
   - `pause`の公開説明の主用途は一時checkoutであり、session間のreplay調停を保証する記述ではない。
   - 同一peer・複数managerのorigin分離について、このcaseの文字順保証・BAという期待値は記載されていない。
3. [公式CRDT型の選択](https://loro.dev/docs/concepts/choose_crdt_type)
   - Map上のstring valueの置換と、Text CRDTを区別する。
   - Textでは並行insertを保持する。今回のLoroTextを全文Last-Write-Winsとして説明できない。

公開文書の一般的な「Undo→Redo」の保証を、複数の独立stackが任意順に往復する場合まで
無条件に拡張することも、BAの実測だけで仕様がBAだと結論することも避ける。

## 固定版sourceで確認した位置変換

cache内のcrateと`.cargo_vcs_info.json`を確認。loro/loro-internal 1.16.2のcommitは
`af130d97d8b110add13283fc5bfc81d97a9a609f`。

- [undo.rs:621–655](https://github.com/loro-dev/loro/blob/af130d97d8b110add13283fc5bfc81d97a9a609f/crates/loro-internal/src/undo.rs#L621-L655):
  pause中またはorigin除外のlocal eventも、undo/redo両stackへdiffをcomposeし、counterを進める。
- [undo.rs:1050–1145](https://github.com/loro-dev/loro/blob/af130d97d8b110add13283fc5bfc81d97a9a609f/crates/loro-internal/src/undo.rs#L1050-L1145):
  対象操作の逆diffを計算し、後続diffに対してtransformする。最終transformは`true`のleft priority。
- [loro-delta 1.13.0 transform](https://docs.rs/loro-delta/1.13.0/src/loro_delta/delta_rope.rs.html#237-292):
  同位置insertの衝突では`left_prior`がselfのinsertを先に置くかを決める。

これは実装上の説明であり、製品が採用すべき仕様の証明ではない。
とくにleft priorityを「最後の編集者が勝つ」という本文置換規則と同一視しない。

## 最小再現と観測

`examples/redo_trace.rs`は空のroot LoroText、一つの固定peer、二つのmanagerを使う。
Aが位置0へ`A`、Bが位置1へ`B`を直接insertする。
SQLite、Workspace、本文`update`、purge、初期文字列は不要だった。
他managerのreplayはpause/resumeで非記録にする。必要な各API呼出しの失敗は伝播する。

| 構成 | Undo順 | Redo順 | 最終本文 | AB assertion |
| --- | --- | --- | --- | --- |
| 同一peerの2 manager | A→B | A→B | BA | 失敗 |
| 同一peerの2 manager | B→A | A→B | BA | 失敗 |
| 同一peerの2 manager | A→B | B→A | AB | 成功 |
| 同一peerの2 manager | B→A | B→A | AB | 成功 |
| 1 active manager（BもAのorigin、他方はpause） | B編集→A編集 | A編集→B編集 | AB | 成功 |

`subscribe_root`の観測では失敗caseの最後のRedo Bが
`Text([Insert { insert: "B", ... }])`を発行する。
`Retain(1)`がなく、復元済みAの**前**へBを挿入している。両者の文字は残る。
逆にBを先にRedoすれば、後からAが先頭へ挿入されてABになる。
したがって、少なくともこのfixtureでは結果はRedo順に依存し、固定の「B優先」ではない。

`UndoManager`のDebugでstack中のspanと蓄積diff、on_push/popで実際に動いた履歴を観測した。
Loroのloggingとsubscriberを有効化し、`redo → undo_internal → Undo → Calc event A_i`等の
内部spanも取得した。ただし全ての中間diff値にlogがあるわけではない。
未出力の中間値はtraceで見たとせず、上のsource読解と公開eventの観測を区別する。

## 再現手順

Windowsの既存GNU環境（PoC-local cache/TEMP）:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action trace
```

これは現状AB assertionで**非0終了する診断command**。通常testの成功条件を変更しない。
大量のtrace/stackを出すので、必要ならファイルへredirectする。
通常のRust環境では次を実行できる:

```sh
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --trace --stacks
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --single
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --reverse-undo
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --reverse-redo
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --reverse-undo --reverse-redo
```

`--trace`と`--stacks`は独立して省略できる。指定しなくても本文・counts・push/pop・公開diffを出す。
fixture以外の本文や実DBを入力する機能は設けない。

実行確認:

- 直接Cargo起動と`run.ps1 -Action trace`の両方で同じAB→BAとexit 101を確認。
- 表の他4構成は、Cargoでbuildした同じexample executableへ各flagを渡して確認。
- `run.ps1 -Action test`: 8 passed / 2 ignored / 0 failed。
- `run.ps1 -Action check`: rustfmt checkとclippy all-targets `-D warnings`成功。
- ログはfixtureのみを対象にscratchへ取得。全文はcommitせず、上に観測点と再現方法を記録した。

## 異なるpeer/Docでの追加比較

`--peers`はpeer 1/2の独立したLoroDocと、それぞれ一つのUndoManagerを使う。
peer変更、originによる除外、pause/resumeは使わない。
AのinsertをBへ差分importしてからBが末尾へinsertするため、最初のABは並行編集のmergeではない。
以降も各Undo/Redoを同期してから次へ進む（ネットワーク遅延・未受信操作はない）。

毎回、次をassertする:

- importにpendingがない。
- 同期先managerのUndo/Redo件数がimport前後で変化しない。
- 両Docのversion vectorと本文が一致する。

| 構成 | Undo順 | Redo順 | 最終本文 | AB assertion |
| --- | --- | --- | --- | --- |
| 異なるpeer/Doc | A→B | A→B | BA | 失敗 |
| 異なるpeer/Doc | B→A | A→B | BA | 失敗 |
| 異なるpeer/Doc | A→B | B→A | AB | 成功 |
| 異なるpeer/Doc | B→A | B→A | AB | 成功 |
| 異なるpeer/Doc | Aのみ | Aのみ | AB | 成功 |
| 異なるpeer/Doc | Bのみ | Bのみ | AB | 成功 |

失敗caseでも各同期の収束assertionは成功した。最後のBのlocal diffも、
Aへのimport diffも先頭への`Insert("B")`だった。これはreplica間の不一致ではない。
どちらかだけのUndoは他方の文字を保持し、直後のRedoでABへ戻ることも確認した。
ただし、この6例だけで任意の協調編集に対する保証は主張しない。

両方をUndoすると、二つの別履歴の復元位置が同じ境界へ寄る。
再生成insertをleft priorityで位置変換する固定版sourceは、この「後からRedoした文字が前へ入る」
結果を説明する。ただし、全中間diffをlogで追ったわけではなく、仕様がこの結果を要求するとの確認もない。
**「同一peerの方式をやめれば解決する」という仮説は、この比較では否定された。**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action peer-trace
```

上はtrace/stack付きでAB assertionが失敗する再現command。一般的なRust環境では:

```sh
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --peers
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --peers --reverse-undo
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --peers --reverse-redo
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --peers --reverse-undo --reverse-redo
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --peers --roundtrip-only
cargo run --locked --manifest-path spikes/loro-purge/Cargo.toml --example redo_trace -- --peers --roundtrip-only --reverse-undo
```

`--roundtrip-only`は片方だけを往復し、`--reverse-undo`指定で対象をBへ切り替える。
`--single`と`--peers`の同時指定は拒否する。
追加6構成はbuild済みの同じexample executableで確認し、デフォルトの失敗はCargo起動でも確認した。

## 次に切り分ける境界

- 複数peerが相互にUndo/Redoする場合の全体往復保証について、上流からの明示的な仕様確認は未取得。
- 同本文への他の操作列・文字種、非同期/並行配送は未実施。
- 新版Loroとの比較、上流への仕様照会/報告は未実施。
- この調査自体では旧方式の期待値を変更しない。製品は上記の後続決定に従い、共通履歴での検証へ進む。
