# 共通Undo履歴の実Loro/実SQLite検証（fixture）

状態: `spikes/loro-purge`の独立fixtureで、採用済みの「workspace共通Undo履歴」を検証した記録。
製品実装・Tauri UI・Importer・Alloy共通履歴版の完了を意味しない。
対象は[#383の決定](../../docs/design/v3-model-decisions.md#3-383保存doc履歴管理の検証)と
[purge契約](../../docs/design/purge-undo-contract.md)。
旧session別managerのfixtureと既知失敗は変更せず残した。

## 1. fixtureと境界

- `src/shared.rs`の`SharedWorkspace`。**一つのLoroDoc、一つの`UndoManager`**。
  通常のcommit originは`pane:{0|1}:{command}`だが、paneは要求元の文脈だけで、履歴の選択単位ではない。
- 実LoroTree `outline`に固定seed（A, B, C, D, E, X, Y）を置く。
  アプリ論理IDは各nodeのmetadata `block_id`に保存し、本文は`body:{logical_id}`のLoroText。
  Loro TreeIDと論理IDは別物として観測する。
- 通常削除は`tree.delete`とTombstone記録を同じcommitに入れる。
  Tombstone記録は「削除時に可視だった部分木」のpreorder、元親、次の兄弟目印を持つ。
- SQLiteは既存`Store`（WAL＋FULL、snapshot 1世代＋後続Update、実TEMP triggerで書込失敗）を使う。
  DBは`tempfile`だけで作り、実DBは使っていない。

旧`Workspace`（`src/lib.rs`）は二つのsession別managerと既知失敗の再現のために残した。
共通履歴の証拠として旧テストの緑を流用しない。

既存`Workspace`を共通managerへ変えると、旧session別試験の期待値を書き換えるか、
二方式を同時に持つ複雑なfixtureになる。また共通履歴の受入にはLoroTree、Tombstone復元、
複合command、purgeの証拠が必要で、二つのLoroTextだけの旧fixtureでは足りない。
そのため専用の`SharedWorkspace`を追加し、旧fixtureは診断用に不変で残した。
同期owner、phase、Store retryの小さな重複は、この分離のコストとして許容する。

## 2. 実行commandと結果

Windows / `stable-x86_64-pc-windows-gnu` / PoC-local `.cargo-home`とTMPで実行した。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action demo
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action known-failure
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action purge-scope
```

- `test`: **21 passed / 2 ignored / 0 failed**。
  内訳はLoro API 3件、共通履歴fixture 13件、旧workspace 5件。ignoreは旧同本文Redoの2件だけ。
- `check`: `cargo fmt -- --check`と`clippy --all-targets -- -D warnings`が成功。
- `demo`: 旧fixtureのSQLite失敗→Dirty→retry→全履歴clear→別connection読戻し→新編集Undoを再確認。
- `known-failure`: 終了code 101、**2 failed**。旧方式の`before A B`→`before B A`を変更せず再現。
  共通履歴fixtureの成功でこの失敗を解消済みとは扱わない。
- `purge-scope`: 下記7節の追加観測を出力する最小example。成功。

先に公開操作からの失敗可能なテスト9件を置き、未実装で9 failedを確認してから最小実装した。
その後、文書root復元・purge scope・文書切り出し・Tombstone reopenの4件を追加して13件にした。

## 3. caseと対応する検証条件

| test（`tests/shared_undo.rs`） | 条件 | 主な観測 |
| --- | --- | --- |
| `multiple_panes_share_one_lifo_history...` | 1 | 同本文Bをpane 0→1、別本文Dをpane 0で編集。3項目をLIFOでUndo/Redoし、別paneからのUndoも同じ履歴を動かす。論理ID/親子/順序/本文を維持 |
| `tree_move_preserves_logical_ids...` | 2 | B部分木（C,D）を文書AからXへmove、DをCの前にreorder。2段Undo/RedoとSQLite reopenで論理ID/親子/順序/本文/TreeIDを観測 |
| `cut_subtree_to_a_new_document_root...` | 2 | B部分木（C,D）を文書Aからroot列へ切り出し、文書rootにする。UndoでAの元位置、Redoでrootへ戻り、論理ID/TreeID/順序/本文を維持 |
| `delete_tombstones_the_subtree...` | 3 | C削除→B削除。BのTombstoneは可視部分木[B,D]だけで、Undo/RedoしてもCを復活させない |
| `trash_restore_is_a_new_operation...` | 3 | C削除済みのままBをゴミ箱復元。Bは元位置（Eの前）、CはTombstoneのまま。復元は新しい履歴項目で、Undoは復元だけを戻す |
| `tombstone_survives_reopen...` | 3, 5 | C/B削除後にconnectionを開き直し、Tombstone記録・本文・論理IDからBを復元。Cは削除済みのまま。復元は新しい履歴項目 |
| `restore_uses_original_parent_else_end...` | 3 | 兄弟目印Eをpurgeした後、親A liveのBをAの末尾へ復元。Eを暗黙復元しない |
| `restore_requires_confirmation...` | 3 | 親Aがdeletedの場合は確認付き独立文書復元、A purge後も同じ論理ID/本文/子構造で独立文書復元。確認なしは無変更 |
| `document_root_delete_and_restore...` | 3 | 文書root Aの部分木削除、Undo/Redo、兄弟目印XがliveなTombstone復元。rootとして元位置に戻る |
| `split_is_one_history_item...` | 4 | B本文を`br`/`avo`に分割し、B2を同じ親の次兄弟へ。複数container変更で履歴1項目。Undo/RedoでB2の論理ID/順序/本文が戻る |
| `sqlite_failure_keeps_dirty...` | 5 | 実SQLite INSERT失敗→Dirty維持・後続操作拒否・旧履歴維持。retryは保存だけ。編集1件だけが履歴に残り、二重適用なし |
| `purge_scope_excludes_a_child_deleted_before_its_parent` | 3, 6 | 先に削除したCをBの可視部分木から除外し、BのpurgeでCを巻き込まない。CはTombstoneのまま残り、親Bがpurgedなので確認付き独立文書復元できる |
| `purge_requires_trash_and_confirmation...` | 6 | trash/確認集合必須。実SQLite失敗中は履歴を先に消さない。成功後だけ共通Undo/Redoをclear。reopen後もpurged IDを維持し、新編集をUndo/Redo |

## 4. 主要な観測

### 共通履歴とpane

- `history()`は`(undo_count, redo_count)`の一組だけ。複数pane用のstackやmanagerはない。
- pane 0の最後の編集を、pane 1からの`undo(1)`で戻せた。paneは履歴のfilter/選択単位ではない。
- 同じ本文Bへの複数pane編集も、別本文Dへの編集も、一つのcommit順＝一つの履歴順になる。
- commit origin（pane/command）は要求文脈としてLoroへ渡すが、履歴項目のmetadataとして
  保存・再公開はしない。検証した文脈は要求元pane、command種別、対象論理ID、親子/順序で、
  UIのfocus/caret/選択の復元は未検証。
- このfixtureは既存依存を追加せず、`loro`/`rusqlite`/`tempfile`/`tracing-subscriber`の
  固定versionだけで動く。SQLite DBは毎test `tempfile`に作る。

### 論理IDとLoro TreeID

- move、兄弟reorder、そのUndo/RedoではTreeIDが安定した。
- 部分木を文書rootへ切り出してもTreeIDが安定し、Undoで元の親/位置、Redoでrootへ戻った。
- **Tree deleteのUndoは、削除した部分木を新しいTreeIDで再作成する**（旧TreeIDのnodeはdeleted側に残る）。
- **Tree createのRedoも新しいTreeIDで再作成する**（splitのB2で確認）。
- したがって論理IDはTreeIDへ依存させず、metadataの`block_id`で維持する。
  Undo/Redo/trash復元の観測は論理ID・親・index・本文で行った。
- trash復元も新しいTreeIDを作るが、論理ID・本文・子構造は維持した。

### Tombstoneと復元

- 削除時の可視部分木だけをTombstoneに記録するため、先に削除済みのCはBの復元対象に入らない。
- 親がliveなら、削除時の次の兄弟がliveのときその直前、消失していれば末尾へ復元する。
  親がdeleted/purgedなら確認なしでは復元せず、確認後は同じ論理IDの独立文書rootにする。
- ゴミ箱復元は新しい公開操作として一つの履歴項目になる。削除のUndoとは別で、Undoすると復元操作だけが戻る。
- 元から文書rootだったAも、兄弟目印Xがliveならroot列の元位置へ戻る。
- Tombstone記録・本文・論理IDはSQLite reopenを跨いで残り、reopen後の復元でも同じ論理ID/本文/子構造を維持した。

### 複合command

- splitは「本文update＋Tree create＋本文insert＋metadata」を同じcommitで行い、履歴は1項目。
- UndoでB本文が`bravo`に戻りB2が消える。RedoでB2の論理ID/順序/本文が戻る。
  B2のTreeIDはLoroが再作成するため、TreeIDの同一性は要求しない。

### SQLite失敗とretry

- 実SQLiteのTEMP triggerでINSERTをABORT。失敗後は`Dirty`のまま、編集/移動/削除/復元/split/purge/Undo/Redo/読取りを拒否した。
- 失敗した編集はメモリ上で1履歴項目。retry成功後も履歴数は増えず、Undo 1回で直前本文へ戻った。
- 失敗中に別connectionで開くと、失敗した書込は見えず、直前の耐久状態が見えた。
- retryは`Store::append`による差分保存だけで、Loro操作を再実行しない。

### purge

- ゴミ箱にないblockのpurge、確認集合の欠落・重複・余剰は拒否し、履歴も状態も変えない。
  確認は順序ではなく集合として比較する。
- purge originは`system:`として共通managerの記録から除外する。
  実SQLite失敗中は履歴`(2,1)`を維持し、`Dirty`でUndo/Redoを拒否した。
- SQLite成功後にだけ`UndoManager::clear()`でUndo/Redo両方をclearし、`Ready`へ戻る。
- 失敗中に別connectionで開くと未purgeのTombstoneが見え、成功後に開くとpurged IDと空の履歴が見えた。
- purge成功後、reopen前でも後の新編集をUndo/Redoでき、reopen後も同様だった。

## 5. 成立 / 未成立 / 対象外

### 成立（このfixtureの範囲）

1. 複数pane由来の同本文/別本文編集を一つのLIFO履歴でUndo/Redoし、本文・対象・順序を維持する。
2. 実LoroTreeの部分木move・文書root切り出し・兄弟reorder・複数段Undo/Redoで、論理ID/親子/順序/本文を維持する。
3. Tombstoneの可視部分木、既削除子の非復活、元位置/末尾/確認付き独立文書復元、Undoとゴミ箱復元の区別、SQLite reopen後の復元。
4. 複合splitを一履歴項目として往復し、論理ID/順序/本文を戻す。
5. 実SQLite失敗時のDirty維持・操作拒否・保存のみのretry・履歴重複なし。
6. purgeのtrash/確認必須、耐久保存後のみ全履歴clear、失敗時の履歴維持、reopen後のpurged IDと新編集Undo。

### 未成立・未検証（設計を広げず残す）

- 製品UIのfocus/caret/selection/IME/画面移動。履歴managerへUI draft/focusのownerを移していない。
- process kill、停電、SQLite/OSの耐久性、commit後応答喪失、save成功後clear前のcrash。
  `UndoManager::clear()`はこのfixtureでは失敗を返さないため、clear失敗の分岐は検証していない。
- SQLite失敗の全操作網羅。通常保存（edit）とpurgeのappend失敗を実SQLiteで確認したが、
  move/delete/splitの失敗は同じ`commit_and_save`/`Store::append`経路のため個別には注入していない。
- Undo/Redo履歴の再起動後の保持。このPoCはreopenで新しい空managerを作る（testで確認）。
  製品が履歴を再起動後に保持するかは別契約で、今回の受入はpurged IDと以後の新編集Undoだけ。
- 1万件規模、履歴蓄積、メモリ、snapshot集約、履歴GC、DB/WAL実容量。
- 共通履歴版のAlloy検査。既存Alloyは複数session履歴の旧方式で、本書の合格証拠にしない。
- 複数peer/remote import、同時編集、pane/sessionの追加・破棄・再接続。
- 参照項目/Relation、検索/補完cache、Importer、完全削除の物理抹消。
- ゴミ箱内の部分選択UI、親を先に復元してから子を復元する製品フロー、確認文言。
  fixtureは「確認付き独立文書復元」だけを実装する。

### 対象外（初回v3の決定どおり）

- pane/session別の独立Undo、独自の選択的Undo。
- 製品UI、Tauri縦断slice、Importer、汎用基盤、依存version更新。
- 旧session別manager方式の失敗の修正・期待値変更。

## 6. 限界と再現性

- 固定seed 7 block、2 pane、同期単一owner。editor draftのflush、async queue、多threadはない。
- splitは両側が非空になる位置だけを許す。Enterで末尾に空blockを作る製品仕様は別slice。
- Tombstoneの直列化はfixture専用の制御文字区切りで、汎用schemaではない。
- 論理IDの生成器・衝突検出・再利用禁止registryは未実装。fixtureは固定IDと`B2`だけを使う。
- trash復元は新しいTreeIDを作る。TreeIDの安定を製品契約にしないための観測であり、
  TreeIDを外部へ保存する設計を提案しない。
- 失敗注入は実SQLiteのTEMP triggerで、mock writerではない。ただしcrash/power lossは注入しない。
- 既存`examples/redo_trace.rs`、`tests/workspace.rs`、`undo-research.md`は旧方式の診断として残した。

## 7. 追加確認: 親Bのpurgeと以前から削除済みの子C

追加確認時点ではfixtureの挙動の観測だったが、その後ユーザーが
**別の削除操作で作られたゴミ箱項目は独立**という規則を採用した。
正本は[完全削除の対象集合](../../docs/design/v3-model-decisions.md#完全削除の対象集合)。
fixtureはBの削除時に捕捉した可視部分木をpurge scopeにするためCを外し、この決定に一致する。

実行command:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/loro-purge/run.ps1 -Action purge-scope
```

対象操作: `C`をtrash → `B`をtrash → Bのpurge確認集合`[B,D]`でpurge → Cの状態を観測。

### B削除時グループと物理Tree

| 観測 | 値 |
| --- | --- |
| Cの単独Tombstone | scope `[C]`、recorded parent `B` |
| BのTombstone | scope `[B,D]`、recorded parent `A` |
| B削除後のTree | Bはdeleted root直下、DはBの物理子、Cは**別のdeleted root直下** |
| Cの論理上の元親 | `B`（C自身のTombstoneに記録） |
| Cの現在の物理親 | `Deleted`（Bの物理子ではない） |

Bの削除時点でCはすでに可視Treeから外れているため、Bの可視部分木は`[B,D]`で、
物理的にもBのdeleted subtreeはB+Dである。一方、Cの記録上の親はBのまま残る。
したがって「Bの論理子孫（C,D）」と「Bの現在の物理子孫（D）」は一致しない。

### B purge後のC

Bのpurge確認集合は`trash_scope("B")`の`[B,D]`。実装は確認集合を集合比較した後、
`record.nodes`（同じ`[B,D]`）だけを本文削除・purged記録の対象にする。
確認画面へ渡す集合と実際に処理する集合は、このfixtureでは同じTombstone recordから作られ、一致する。

実装位置: `trash_parent` [src/shared.rs:197]、`tree_probe` [src/shared.rs:205]、`purge` [src/shared.rs:436]。
観測test: [tests/shared_undo.rs:610](tests/shared_undo.rs#L610)。

| Cの側面 | 観測 |
| --- | --- |
| 本文 | trash中は`text(C)=None`。B purge後も保持され、確認付き復元で`"charlie"` |
| 論理ID | `C`のまま。復元後も`C` |
| ゴミ箱項目 | `trash_scope(C)=["C"]`のまま。B purgeでは消えない |
| 元親 | record parent `B`のまま。Bはpurgedなので利用不能 |
| purged記録 | `is_purged(C)=false`。B/Dだけがtrue |
| 復元 | 確認なしは拒否。確認付きで独立文書rootのCとして復元（TreeIDは新規）。復元後はtrash recordも消える |
| 物理Tree | 古いC nodeはdeleted root直下に残る。B/Dの物理nodeもpurged markだけで物理削除しない |

B/Dはpurged=true、trash recordなし、本文は通常APIから見えない。Cはpurged=false、
trash recordあり、本文は通常APIから見えないが、確認付き復元で同じ本文/IDを戻せる。

このfixtureの`purge_scope_excludes...`testは、上記の独立したゴミ箱項目の契約を検証する。
ゴミ箱全体を空にする操作は未実装であり、別項目も明示的に対象へ含める製品側の受入は別途必要。

## 8. 変更file

- `src/shared.rs`: `SharedWorkspace`、Tombstone、Tree操作、SQLite retry/purge。
- `tests/shared_undo.rs`: 上記13件の公開操作テスト。
- `src/lib.rs`: 旧`Workspace`を残し、`SharedWorkspace`とfixture-only `TreeProbe`を公開。
- `examples/shared_purge_scope.rs`: 上記7節の最小観測example。
- `run.ps1`: `purge-scope` action。
- `README.md`: 共通履歴fixtureへの導線、検証件数、`purge-scope` actionと採用済み対象集合の注記。
- このファイル: command、case、観測、成立/未成立、限界、追加確認。

`docs/`配下は変更していない。旧fixtureの失敗期待値・ignore・診断exampleも変更していない。
