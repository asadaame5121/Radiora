# Phase 5 工程表・実装手順

- 作成日: 2026-07-30
- 対象: `#61` Phase 5: 長文と可搬性（sub-issue `#62`-`#71`）
- 状態: 計画案
- 前提Phase: `#51` Phase 4の全sub-issue完了とcloseout検証
- 設計の正本:
  - [[../design/product-direction]]
  - [[../design/schema-evolution]]

## Phase 5の出口

次をすべて満たした時点でPhase 5完了とする。

- Occurrenceの順序、深さ、`revisionSelector`を保った連続原稿を表示・編集できる
- Markdown、OPML、JSONを目的別の契約で出力できる
- 日本語、改行、Markdown、`radiora://`内部参照を壊さず往復できる
- JSON完全backupを空DBへrestoreし、件数、ID、リンク方向、本文hashが一致する
- 破損、中断、容量不足が発生しても現DBと入力backupを変更しない
- `#62`-`#71`が完了している
- 親エージェントが最終的に`deno task verify`を実行し、成功している
- Windows Desktopでexportから空DB restoreまで手動確認が完了している

検証失敗中は完了扱いにしない。生成DB、診断ログ、build出力、手動試験の個人データを
Jujutsu changeへ含めない。

## 現行実装から再利用する足場

- `Occurrence`は配置順、深さ、Branch追従またはRevision固定の`revisionSelector`を持つ
- `GraphStore.listItems()`はWorking Copyと固定Revisionを現在の表示本文へ投影できる
- `renderOutlineSnapshotMarkdown()`は階層、`orderKey`、孤児、循環、Stashを決定的に出力する
- `MarkdownEditor`とautosave coordinatorは原稿ビューの直接編集にも再利用できる
- `radiora://work/<id>`と`radiora://revision/<id>`のparser、resolver、completionが存在する
- `JsonGraphStore`はversion付きenvelopeとv0から現行versionまでの段階migrationを持ち、
  未来versionを拒否する
- JSONにはWork、Occurrence、Branch、Working Copy、Revision、Recovery Snapshot、Bookmark、
  Resume Position、意味リンク、System Relation、aliasなどが保存されている
- migration前cold backup、失敗時restore、Snapshot保護の先例がある
- UI文言は`UiVocabulary`から注入し、設計用語をSvelteへ直書きしない

`JsonGraphStore`の内部ファイル保存を、そのまま利用者向け完全backup APIとは見なさない。
Phase 5では、純粋なencode/decode/validateと、通常のstore永続化、明示export、restoreを分離する。

## 先に固定する設計境界

### 原稿投影

- 原稿は永続エンティティではなく、起点Occurrence以下を読み取る一時投影とする
- 並び順は親子関係と`orderKey`で決め、同値時はOccurrence IDで安定化する
- 深さは原稿内の相対深さとし、Markdown見出しレベルへ変換する
- Branch追従Occurrenceは現在のWorking Copy、固定Occurrenceは指定Revision本文を使う
- 原稿ビューからの編集はBranch追従本文だけを実Working Copyへ保存する
- 固定Revisionは変更不能とし、編集開始には新BranchまたはWorking Copyへの明示的な派生が必要
- 原稿表示、文字数計算、exportはRevisionを暗黙作成しない
- 同じWorkの複数配置を勝手に重複排除しない。原稿はWork集合ではなくOccurrence構成である

### 交換形式

- Markdownは人間可読な成果物であり、完全round-trip形式にはしない
- OPMLは階層、順序、表示本文の交換形式とし、Radiora固有のRevision DAGや意味リンクを
  推測復元しない
- JSONだけを完全backup/restore形式とする
- Markdownの参照モードは次の三種類を明示する
  - `radiora`: 正準`radiora://`参照を保持
  - `portable`: 解決済み表示ラベルだけを残す
  - `obsidian`: 解決可能な参照を`[[表示名]]`へ変換
- 壊れた参照、削除済み参照、scope不一致は黙って別対象へ付け替えない

### 完全restore

restoreは次の段階を越えるまで現DBへ書き込まない。

1. 入力を読み取り専用で取得する
2. formatとschema versionを判定する
3. 一段ずつ現行backup schemaへ変換する
4. ID、必須field、参照整合性、Revision DAG、Branch/Working Copy、Occurrence親子、
   リンク端点、Bookmark/Resume Positionを全体検証する
5. restore previewとして件数、source version、警告、置換対象を返す
6. 現DBの保護backupまたは保護Snapshotを作る
7. staging領域または一つのtransactionへ全データを反映する
8. staging側を読み戻し、件数、ID集合、リンク方向、本文hashを再検証する
9. 成功時だけ現DBと切り替える

入力backupを上書きしない。失敗時はstagingだけを破棄し、現DBとschema metadataを変更しない。
SurrealDBで全置換を一transactionに安全に収められない場合は、既存DBを部分更新せず、
新しいnamespace/databaseまたはcold database directoryで構築して検証後に切り替える。

## 工程表

見積りは実装、対象テスト、レビュー修正を含むagent-dayの目安であり、待ち時間を含まない。

| Wave | Issue | 成果 | 依存 | 難易度 | 推奨モデル | 目安 |
|---|---:|---|---|---|---|---:|
| 0 | #51 | Phase 4 closeout、開始schemaの確定 | - | 中 | 親 Sol・medium | 0.5日 |
| 1 | #62 | 原稿投影器 | #51 | 中 | Terra・medium | 1-2日 |
| 2 | #63 | 原稿ビュー、直接編集、文字数 | #62 | 高 | Sol・medium | 2-3日 |
| 2 | #66 | JSON完全backup codec/export | #51 | 中-高 | Sol・medium | 1-2日 |
| 3 | #64 | Markdown三参照モード | #62、#63 | 中-高 | Sol・medium | 1.5-2.5日 |
| 3 | #65 | OPML import/export | #62 | 高 | Sol・medium | 2-3日 |
| 4 | #68 | v0から現行versionへのmigration chain監査 | #66 | 中-高 | Sol・medium | 1-2日 |
| 4 | #67 | transactional JSON import/restore | #66、#68 | 最難 | Sol・high | 3-5日 |
| 5 | #69 | 破損・中断・容量不足restore試験 | #67 | 最難 | Sol・high | 2-3日 |
| 6 | #70 | 全形式round-trip fixture | #64、#65、#67、#69 | 中 | Terra・medium | 1-2日 |
| 7 | #71 | Windows Desktop空DB restore E2E | #70 | 高 | 親 Sol・medium | 1-2日 |

総量目安は15-23 agent-day。Wave 2とWave 3の各行は論理上並行可能だが、共有ワークツリーでは
同じ`bindings.ts`、`App.svelte`、codec、fixtureを同時編集しない。原則としてissueごとに
逐次changeを積む。

```text
# 原稿・人間可読形式
#51 -> #62 -> #63 -> #64 ----\
          \-------> #65 -----+-> #70 -> #71

# 完全backup・restore
#51 -> #66 -> #68 -> #67 -> #69 --/
```

## Issue別の実装手順

### #62 [P5-01] Occurrence順と版選択から原稿を作る投影器

難易度は中。永続化を伴わない境界が明確なためTerra・mediumを推奨する。

1. `ManuscriptProjection`、section、source selector、相対depth、breadcrumb、編集可否を定義する
2. 起点Occurrenceから子孫を親子関係と`orderKey`で決定的に巡回する
3. Branch追従とRevision固定を別経路で解決し、固定Revisionの所有Workも検証する
4. 循環、孤児、削除済みWork、存在しないBranch/Revisionを削除せず診断付きsectionへ投影する
5. 枝単位と全体の文字数を、表示ラベルではなく投影本文から計算する
6. `OutlineService`の読み取りAPIへ接続する

受け入れテスト:

- 兄弟順、深さ、複数配置、Branch追従、Revision固定
- 同じWorkの複数Occurrenceが原稿内にそれぞれ現れる
- 投影前後でstore全状態が変化しない
- 循環や孤児でも無限ループせず、対象を黙って失わない

### #63 [P5-02] 原稿ビュー・直接編集・文字数表示

難易度は高。UI、選択状態、autosaveをまたぐためSol・mediumを推奨する。

1. 起点Occurrenceを選ぶ「原稿として開く」入口を追加する
2. #62のsectionを連続表示する専用Svelteコンポーネントを作る
3. 相対depthを見出しとして表示し、枝別・全体文字数を常時再計算する
4. Branch追従sectionを既存Markdown editor/autosaveへ接続する
5. Revision固定sectionは読み取り専用にし、派生操作なしの直接編集を拒否する
6. Outline側の並べ替え後に再投影し、原稿順が更新されることを保証する
7. 非同期再投影で古い応答が現在の原稿を上書きしないようrequest tokenを持つ

受け入れテスト:

- 直接編集が投影コピーではなく対象Working Copyを更新する
- 編集対象以外のBranch、Revision、Occurrence配置を変更しない
- autosave flush後に表示本文と文字数が一致する
- UI文言がすべてUiVocabulary経由である

### #64 [P5-03] Markdown exportを三つの参照モードで実装

難易度は中-高。内部参照の欠損時ルールに設計判断があるためSol・mediumを推奨する。

1. #62の原稿投影を入力にするpure rendererへ既存Markdown exportを整理する
2. `radiora`、`portable`、`obsidian`の参照変換strategyを分離する
3. WorkとRevision参照をresolverで解決し、label escapeを共通化する
4. 見出しlevel 6超過、空本文、末尾改行、code内URLを決定的に扱う
5. export直前にautosaveをflushし、一つのUTF-8 Markdownとして保存する
6. 選択したモードと未解決参照件数をUIへ表示する

受け入れテスト:

- 三モードのgolden test
- code、escape、同名Work、削除済み参照、Revision参照
- exportがRevision、Snapshot、リンクを生成しない

### #65 [P5-04] OPML import・export

難易度は高。階層生成と一括書き込みをまたぐためSol・mediumを推奨する。

1. 対応するOPML subsetを文書化する（`outline`階層、`text`、複数行本文用属性）
2. #62の原稿投影から順序と階層を保つXML serializerを実装する
3. XML entity、CDATAを推測混在させず、一つのescape規則へ固定する
4. importは全XMLをparse/validateしてからWork、main Branch、Working Copy、Occurrenceの
   作成計画を生成する
5. IDはimport時に新規生成し、OPMLの表示名から既存Workへの同一性を推測しない
6. 一括作成はstoreのatomic batch境界へ置き、途中失敗時に部分Workを残さない
7. 意味リンク、Revision、Branch DAGはOPMLから暗黙生成しない

受け入れテスト:

- 階層、順序、日本語、絵文字、XML特殊文字、複数行本文の往復
- malformed XML、過深階層、巨大入力の上限
- import失敗時の全状態不変

### #66 [P5-05] JSON完全backup export

難易度は中-高。既存実装を再利用できるが完全性監査が必要なためSol・mediumを推奨する。

1. `StoredGraph`の構築、envelope encode、decodeを`JsonGraphStore.persist()`からpure codecへ抽出する
2. GraphStoreから全エンティティをinclude-deleted/history付きで取得するsnapshot APIを定義する
3. schema metadata、app version、export時刻、source storage versionをenvelopeへ記録する
4. WorkからRecovery SnapshotまでのID集合と件数manifestを計算する
5. 一時ファイルへUTF-8で書き、完了後に利用者の指定先へ確定する
6. 通常のJSON store保存と明示backup exportが同じcodecを使うことを契約テストで固定する

完全性監査の対象:

- Workのtrash、Stub、merge provenance
- Branch、Working Copy、Revision DAG、Recovery Snapshotと保護情報
- Occurrence、Bookmark、Resume Position
- active/retracted意味リンク、Revision端点、System Relation
- alias、保存Query、候補/feedback、Knot、purge manifest

### #68 [P5-07] backup migration 0→1と未来version拒否

難易度は中-高。後方互換境界のためSol・mediumを推奨する。

Issue名は`0→1`だが、実装時点ではv0から現行versionまでの一段chainを対象にする。
既存`JsonGraphStore`にはすでにv0読取、段階migration、未来version拒否があるため、重複実装しない。

1. #66で抽出したcodecへ既存migration関数を移し、各`N -> N+1`を独立させる
2. v0、各公開済み中間version、現行version、未来versionのfixture matrixを作る
3. 変換前入力を変更しないことと、versionごとの`.vN.bak`保護責務を分離する
4. migration後に完全なdomain invariant validationを実行する
5. 未知format、非整数version、欠落version stepを明示エラーにする

backupの形を変更した場合だけbackup schema versionを一段上げる。storage tableを変更しない限り
storage schema versionは上げない。

### #67 [P5-06] JSON import・restoreをtransactionalに実装

難易度は最難。現DB破損の危険が高いためSol・highを推奨する。

1. parse/migrate/validateだけを行うread-only preview APIを先に実装する
2. 現DBを置換するrestoreと、既存DBへ追加するimportを別commandに分ける
3. restore前に保護backupを作り、source schema versionとhashを記録する
4. Memoryはclone後commit、JSONはtemp fileとatomic replace、SurrealDBはtransactionまたは
   staging databaseを使う
5. 全entityを投入後、参照整合性と件数/hashを読み戻して検証する
6. 成功後だけstore/runtimeを新DBへ切り替え、UI選択・履歴を安全に初期化する
7. 失敗時は旧storeを開いたままにし、原因と保護backupの場所を返す

停止条件:

- SurrealDBのschema操作または大量record置換を一transactionで保証できない
- Windows上でDB directoryのatomic swap条件を確定できない
- restore中のdesktop process再接続手順で現DBとの同時書き込みを排除できない

このいずれかでは実装を続けず、staging database方式とcold swap方式を比較して親へ返す。

### #69 [P5-08] 破損・中断・容量不足を含むrestore試験

難易度は最難。障害注入とデータ保全を扱うためSol・highを推奨する。

1. filesystem、codec、store swapへfault injection pointを設ける
2. truncated JSON、hash不一致、参照切れ、未来versionを用意する
3. migration中断、record投入途中失敗、readback validation失敗を再現する
4. temp書込と確定renameの双方で容量不足を再現する
5. 各失敗で現DB、入力backup、schema metadata、migration journalが不変であることを確認する
6. 再起動後に旧DBを正常に開け、再試行できることを確認する
7. UIには失敗段階、原因、現DBが維持されたこと、復旧方法をUiVocabulary経由で表示する

実OSのディスクを満杯にしない。容量不足は抽象化したwriterまたは制限付きtemp領域で注入する。

### #70 [P5-09] 日本語・Markdown・内部参照のround-trip fixture

難易度は中。仕様が固定された後の品質作業なのでTerra・mediumを推奨する。

1. 個人情報を含まない一つの正準fixture corpusを作る
2. LF/CRLF、末尾改行、日本語、絵文字、結合文字、Markdown、XML特殊文字を含める
3. Work/Revisionの`radiora://`、同名ラベル、壊れた参照を含める
4. Markdown三モード、OPML、JSONについて期待結果を固定する
5. JSONは本文だけでなくID、件数、リンク方向、Revision親、Occurrence親も比較する

golden更新は仕様変更としてレビューし、テストを通すためだけに期待値を書き換えない。

### #71 [P5-10] Windows Desktopでexportから空DB restoreまで検証

難易度は高。最終統合判断を含むため親Sol・mediumを推奨する。

1. 個人情報を含まない専用Desktopデータセットを作る
2. 原稿表示と三モードMarkdown exportを確認する
3. OPMLをexportし、新規領域へimportして階層と順序を確認する
4. JSON完全backupをexportする
5. 別の空DBへrestoreし、件数、ID集合、リンク方向、本文hashを比較する
6. restore後に主要画面を開き、編集、検索、Revision比較、Snapshot復元をsmoke testする
7. Desktopを再起動し、同じ状態を読み込めることを確認する
8. 最後に`deno task verify`を実行する

手動試験のDB、exportファイル、スクリーンショット、診断ログはコミットしない。結果だけを
Phase 5 closeout記録へ残す。

## モデル割当と昇格規則

| 条件 | 割当 |
|---|---|
| pure projection、fixture、機械的テスト追加 | Terra・medium |
| UIと状態管理、形式変換の設計、複数レイヤー変更 | Sol・medium |
| transactional restore、DB切替、障害注入、データ破損リスク | Sol・high |
| issue統合レビュー、最終verify、Desktop release gate | 親 Sol・medium |

Terra担当は、同じ検証が一回の修正後も失敗する、不変条件を確定できない、UI/状態/永続化へ
範囲が広がる、後方互換またはデータ破損リスクが判明した時点で編集を止め、親がSol・medium以上へ
昇格する。

Sol・highは#67と#69のデータ保全境界に限定する。単に実装量が多いことを理由にhighへ上げない。

## changeと検証の運用

1. issue開始前に`jj new -m`で対象issueを宣言する
2. 一つのissueを一つのchangeへ閉じる
3. schema/backup形式変更では、実装前に変更理由、前後例、migration、fixture、rollbackを決める
4. 対象テストを先に実行し、親レビュー後に`deno task verify`を実行する
5. verify成功後だけchange確定とpush可否を判断する
6. #71完了後、Phase 5 closeoutログを`docs/log/`へ追加する

各sub-issueの共通停止条件:

- 同じ検証が一回の修正後も失敗する
- 仕様と既存コードから不変条件を確定できない
- データ損失なしにSurrealDBとJSONの実装を揃えられない
- backup schemaとstorage schemaのどちらを上げるべきか判断できない
- 現DBまたは入力backupを部分更新する案しか成立しない

## Phase 5開始前チェックリスト

- [ ] Phase 4の全sub-issueとcloseoutが完了している
- [ ] Phase 4終了時のstorage/backup schema versionを記録した
- [ ] `JsonGraphStore`の現行envelopeに全エンティティが含まれるか再監査した
- [ ] v0から現行versionまでのfixtureが揃っている
- [ ] restore試験専用の個人情報なしデータセットとtemp領域を用意した
- [ ] Windows Desktopで空DBを安全に切り替える手順を確認した
- [ ] `deno task verify`が開始時点で成功する
