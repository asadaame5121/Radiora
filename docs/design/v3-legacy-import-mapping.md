# v3 Legacy Importer：旧SQLite→新Loro DBの対応設計

作成日: 2026-11-03 状態: #384（T-05）の設計案。実装・受入の完了記録ではない。
§7の4項目はユーザー採用済み。それ以外の対応・schema案は実装とfixtureでの検証を経て確定する。

前提の正本: [v3決定事項](v3-model-decisions.md) §1/§2/§4、[初回提供範囲](v3-first-release-scope.md)
§3、
[名前契約](v3-naming-and-search-contract.md)、#383の保存形式（`spikes/loro-purge/storage-recovery-results.md`）。
本書はそれらの決定を再決定しない。旧モデルを機械的に新entityへ対応付けない。

## 1. 基本方針：verbatim archive と変換済み文書の二層

**旧17種のrecordは、変換の成否と無関係に全件をそのままarchiveへ写す。変換済み文書はarchiveからの派生とする。**

- archive層: 旧DBの全record（17 table＋`storage_metadata`＋`migration_journal`）の
  `id`・`position`・`payload`
  を改変せずに新DBのSQLiteへ保存する。これが「全保存データを黙って落とさない」の担保。
- 文書層: 新モデルに対応するrecordだけをLoroDocへ変換する。旧ID→新IDの対応表と診断を残す。
- 照合はarchive層で件数・bytes・hashを、文書層で意味（本文・階層・順序・参照・共有）を比べる。
- 変換できない値は文書層で推測・付替えをせず、archive層に残したうえで診断へ理由を記録する。

この分離により、変換規則の誤りは「文書層を作り直す」ことで回復でき、原情報は失われない。

## 2. 新DBの構成（提案）

| 置き場所                     | 内容                                                                                                                       | 由来                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `snapshot` / `updates`       | LoroDocの最新snapshot＋差分                                                                                                | #383 の保存形式                             |
| `import_run`                 | 実行ID、旧DBのpath/size/mtime/SHA-256、旧schema version、importer version、開始/完了時刻、状態（running/completed/failed） | 再実行marker                                |
| `legacy_archive`             | `table`・`legacy_id`・`position`・`payload`（原文JSON）・行hash                                                            | 旧17 table＋metadata                        |
| `legacy_id_map`              | 旧ID（table＋id）→新論理ID（UUIDv7）、対応の種類（block/reference/relation/materialized-revision/missing）                 | 変換                                        |
| `import_diagnostics`         | 重大度、種別、対象の旧ID、理由、採った処置                                                                                 | 変換                                        |
| `ui_fold` 等のローカルUI設定 | 旧`collapsed`の初期値                                                                                                      | foldはSQLite保存の採用契約（v3決定事項 §1） |

文書層・archive層・診断は**同じ新DBファイル**に置き、native backupの対象に含める。
archiveは通常検索の対象にしない（初回提供範囲 §3「現在の文書」と「旧保留情報」を区別）。

## 3. Loro文書schema v1（#385と共有する最小案）

Importerが書き、#385が読み書きする初版。containerの追加はschemaVersionを上げて行う。

- `meta`（LoroMap）: `schemaVersion=1`、`workspaceId`。Loro binary format / SQLite envelope /
  アプリschemaは別versionで管理する。
- `blocks`（LoroTree）: 親を持たないnode＝Topic root。各nodeのmeta（LoroMap）に以下を置く。
  - `id`: 論理ID（UUIDv7）。Loro TreeIDとは別。
  - `kind`: `"block"` | `"reference"`。
  - `text`: LoroText（`kind=block`のみ）。参照項目は本文を持たない。
  - `target`: 参照先の論理ID（`kind=reference`のみ）。chainを作らないため、常に`kind=block`を指す。
  - `heading`: 参照項目の固有見出し（任意）。
  - `aliases`: LoroList（`kind=block`のみ）。
  - `trash`: 通常削除のTombstone（ゴミ箱項目ID・日時）。未削除なら無し。
  - `legacy`: 旧情報の参照（旧Work/Occurrence
    ID、historicalTime、stub属性等）。表示用の正本にしない。
- `relations`（LoroMap、key＝Relation論理ID）:
  `from`/`to`（Block論理ID）、`type`、`status`、`origin`、`reason`、`createdAt`、`legacy`。
- `relationTypes`（LoroMap、key＝型名）: 型定義catalog。
- `deletedIds`（LoroMap）: 完全削除済みIDの最小記録。Missing判定に使う。

## 4. 17種のrecordの対応

全種がarchive層へ入ることは共通。下表は文書層での扱い。

| 旧table                                       | 文書層での扱い                                                    | 備考                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `work`                                        | Occurrenceがあれば配置ごとのBlockへ、無ければroot Topic           | 本文はWork自体に無い。`deletedAt`→ゴミ箱、`stub`→通常Topic＋`legacy.stub`、`mergedIntoWorkId`→`legacy`へ |
| `occurrence`                                  | Blockまたは参照項目（§5の共有グループで決定）                     | `orderKey`→兄弟順、`collapsed`→`ui_fold`、`contextualHeading`→§7 Q2                                      |
| `working_copy`                                | 表示されるBranchの本文の取得元                                    | どのOccurrenceも選んでいないBranchの本文は文書化しない（§7 Q3）                                          |
| `branch`                                      | 共有グループの区別に使う。文書entityにしない                      | `promotedAt`/`archivedAt`は代表選択の入力                                                                |
| `revision`                                    | pinned・リンク・Relationから参照されたものだけを独立Blockへ実体化 | 参照されない過去Revisionはarchiveのみ                                                                    |
| `recovery_snapshot`                           | 文書化しない                                                      | archiveのみ。共通Undoへ置き換えない                                                                      |
| `semantic_link`                               | `relations`へ。端点は§6で解決                                     | `retracted`も状態ごと保持。解決不能端点はMissing                                                         |
| `relation_type_definition`                    | `relationTypes`へ                                                 | built-inとの重複名は定義の差を診断                                                                       |
| `system_relation`（IN）                       | 文書化しない                                                      | archiveのみ。v3の親子・Relationへ推測で写さない                                                          |
| `knot`                                        | 文書化しない                                                      | 旧SCCの派生cache。v3はfilter前SCCを再計算する                                                            |
| `search_alias`                                | 文書化しない                                                      | 旧辞書は別名へ再解釈しない（初回提供範囲 §3）                                                            |
| `emergence_suggestion` / `emergence_feedback` | 文書化しない                                                      | 提案根拠と判断を区別したままarchive                                                                      |
| `saved_rule_query`                            | 文書化しない                                                      | archive。原文を読出し/exportできること                                                                   |
| `purge_manifest`                              | 含まれる旧IDを`deletedIds`へ（新IDを割り当てた上でMissing扱い）   | 本文は復元しない                                                                                         |
| `bookmark`                                    | 文書化しない                                                      | archive。対象が無ければMissingと識別できる情報を残す                                                     |
| `resume_position`                             | 文書化しない                                                      | archiveのみ                                                                                              |
| `storage_metadata` / `migration_journal`      | 文書化しない                                                      | schema判定と拒否条件に使い、archiveへ写す                                                                |

## 5. 共有グループと代表Blockの決め方

旧v2では一つのWorkを複数Occurrenceに配置でき、各Occurrenceは`revisionSelector`（Branchかpinned
Revision）で表示本文を選ぶ。

1. 同じWorkのOccurrenceを、`revisionSelector`が同一のものごとにまとめる（＝共有グループ）。
   異なるBranch・異なるpinned Revisionは別グループとし、一つの本文へ統合しない。
2. グループの代表は、`(親を持たない配置を優先, orderKey, occurrence id)`
   の昇順で最初のOccurrenceとする。
   代表は`kind=block`として本文を所有し、残りは代表を`target`とする参照項目になる。
3. 各Occurrenceの子構造は、そのOccurrence（代表か参照項目か）の下に独立して維持する。
4. pinnedのグループもBranchグループと同じく、最初のOccurrenceが代表となりRevisionの本文を所有する。
   この代表がそのRevisionの「実体化Block」を兼ねる。どのOccurrenceもpinしていないが
   リンク・Relationから参照されたRevisionは、独立したroot Topicとして実体化する。
5. 本文の取得元:
   Branchグループは`working_copy`（無ければheadRevisionの本文、どちらも無ければ空本文＋診断）。
6. Workの「主グループ」は、Work単位の参照（§6）の解決先。
   Branchグループの中から、未archiveのBranchを優先し、`promotedAt`が新しい順（無いものは後）、
   `createdAt`、Branch idの順で決める。Branchグループが無ければpinnedグループをRevision
   idの順で選ぶ。 Occurrenceが無いWorkは、そのroot Topicが解決先になる。
   グループが2つ以上あるWorkへのWork単位参照は、決定的に解決したうえで`ambiguous-primary`診断を出す。

## 6. 参照の解決

- `LinkEndpoint{scope:"work"}` → そのWorkの主グループの代表Block。
- `LinkEndpoint{scope:"revision"}` → 実体化したRevision Block。
- 本文中の `[label](radiora://work/<id>)` / `radiora://revision/<id>` → 同じ規則で解決し、
  `[label](radiora://block/<新ID>)` へ書き換える。ラベルは維持する。 code
  span・fence・リンクでない文字列はMarkdown parserで判定し、書き換えない。
- 解決できない参照は、任意のBlockへ付け替えずMissingとして残し、`unresolved-reference`診断を出す。
- コピー操作の新ID規則（コピー集合内だけ張替え）とは別物であり、混同しない。

## 7. ユーザー採用済みの判断（2026-11-04）

- **Q1 旧版で削除済みのWork**: 旧Work 1件＝ゴミ箱項目1件とし、`旧版の削除`と表示する。
  旧記録から新版の削除グループを推測しない（v3決定事項 §4）。
- **Q2 単一配置Blockの`contextualHeading`**: v3では所有Blockに配置固有の見出しが無いため、
  `legacy`へ保持するだけとし、本文・別名へは自動変換しない。診断一覧で件数を示す。
  参照項目になるOccurrenceの`contextualHeading`は、参照項目の`heading`へ写す。
- **Q3 どのOccurrenceも選んでいないBranchの本文**:
  archiveのみとする（参照されないRevisionと同じ扱い）。 独立Topicとして実体化しない。
- **Q4（2026-11-04）不正payloadはarchive＋診断**:
  payloadのJSON構文・型・文字列/数値のdecoder・identity検証に失敗したrecordは、変換全体を拒否せず、
  原文のままarchiveへ保存する。診断を出し、そのrecordは文書層の入力から除外する。

## 8. 安全性・拒否条件

- 旧DBは読取り専用で開き、変換前後でsize・mtime・SHA-256が不変であることを記録・検査する。
- 変換は一時pathの新DBへ行い、全検証が通った後にだけ目的pathへ移して`import_run.completed`にする。
  途中失敗の一時DBは成功扱いせず破棄する。再実行は常に新規作成（同じ旧DBのhashなら同じ結果）。
- 全体拒否する入力: `schema_version`が2以外、`migration_journal`に`running`/`failed`が残る、
  未知/欠落table、列不一致、同table内のID重複、空のrow ID、positionが整数でない/負、
  payloadがTEXTでない等の行構造不正、旧DBの変更検知。 拒否時は新DBを残さず、旧DBも変更しない。
- payload由来の検証失敗（JSON構文不正、型不正、孤立UTF-16 surrogate、数値範囲外、 row IDとpayload
  identityの不一致）は、その行だけ隔離して続行する。
  `legacy_archive`の原文・件数・bytes・hash照合に隔離行も含め、
  `import_diagnostics`へseverity=`error`、kind=`invalid-record`、対象table/旧ID、
  検証理由、action=`archived-only`を1行ずつ記録する。
- JSONの数値decoderは有限f64を対象とし、serde_jsonの`float_roundtrip`で小数の往復精度を保つ。
  `arbitrary_precision`はworkspaceのfeature統合でIPCへ伝播するため使用しない。
  `1e400`等、有限f64に収まらずJSON parseで失敗するpayloadも原文archive＋診断へ隔離する。
- 隔離されたrecordへの参照はI1 oracleの`Resolution::Missing`扱いとし、別recordへリダイレクトしない。
- 新DBの起動時は、`meta.schemaVersion`・SQLite envelope version・importer
  versionが未知なら開かずに拒否する。
  #383の残課題1（壊れた差分1行で開けない）の扱いは#385の起動処理で決める。

## 9. 作業の分割と担当（難易度は実装計画の5段階）

| #  | 作業                                                                         | 難易度 | 担当                              |
| -- | ---------------------------------------------------------------------------- | ------ | --------------------------------- |
| I1 | 本書の対応・共有グループ・参照解決の設計、PBTの独立oracle                    | 5      | Opus                              |
| I2 | 旧17種payloadのRust型＋runtime validation（`src/domain/schemas.ts`と同値）   | 3      | Codex / Sonnet                    |
| I3 | read-only open・hash検査・拒否条件・archive層のcopyと件数/hash照合           | 3      | Codex / Sonnet                    |
| I4 | 共有グループ・代表選択・参照解決・本文リンク書換え（I1のoracleで検査）       | 4〜5   | Opus設計、Codex実装、Opusレビュー |
| I5 | Loro文書schema v1の書込みと、#383形式での保存・再起動読出し                  | 4      | Codex                             |
| I6 | fixture（T-02のfixtureを入力に、共有・pinned・孤立・削除・Missing・Unicode） | 2      | Codex Luna / DeepSeek             |
| I7 | 中断→再実行、backup→空DB復元、旧DB不変の自動試験と照合記録                   | 3      | Codex                             |

置き場所: 変換規則（純粋計算）は`radiora-core`、SQLite/Loro I/Oは`radiora-infra`。
desktopはLoro/rusqliteへ直接依存しない（v3品質gate 決定3）。
