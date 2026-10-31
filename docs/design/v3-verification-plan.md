# v3 仕様と検証の対応計画

策定日: 2026-10-31。状態: 委任された推奨判断による検証方針の決定。試験実装・実行合格ではない。
契約は[v3決定事項](v3-model-decisions.md)、[名前契約](v3-naming-and-search-contract.md)、
[初回F01〜F16](v3-first-release-scope.md)、境界は[アーキテクチャ](v3-architecture.md)。
本書は検証責任と合格条件を定め、未決の製品仕様をoracleの都合で確定しない。

## 1. 検証層と責任

| 記号 | 対象・実行境界                                                                | 証明しないもの                      |
| ---- | ----------------------------------------------------------------------------- | ----------------------------------- |
| P    | Rust pure coreのPBT/固定例。独立した小さな参照モデルと公開commandの結果を比較 | Loro/SQLite/画面の正しさ            |
| S    | applicationの状態機械PBT。制御可能なportで完了順・失敗・終了を注入            | 実ディスクの耐久性                  |
| I    | 実core＋実Loro/SQLite/backup adapterのheadless結合。製品application入口を通す | Tauri invoke/IME/DOM                |
| U    | TS ControllerのPBTとmock UI E2E。既存fast-check/Vitest/Playwrightを再利用     | 製品Backend/実WebView               |
| N    | 製品Tauriの縦断E2E。実invoke、実DB、終了/再起動、配布asset                    | 自動化できない実IME/OS条件          |
| A    | Alloyの有界モデル検査。抽象protocol/集合の規則を検査                          | 任意規模の証明、ライブラリ/OSの実装 |
| R    | 実機手動受入・規模/配布試験                                                   | 上記の自動回帰試験の代替            |

Rustへ移すdomain規則をTSにもproduction実装して二重管理しない。
Frontendは非同期公開・draft・選択/focusの所有を検査する。TSの既存試験があることだけでRust移植を合格にしない。
I/Nは本物のstorageを使い、mock APIの追加を実Backend検証と呼ばない。
Nのdriver/CI接続方法はD2/D4で確定する。日本語IMEの実機受入は初回必須として残す。

## 2. 初回範囲の検証対応表

各Vは試験群のIDであり、1本の巨大testにしない。詳細な性質・固定例・実行証拠を同じVへ関連付ける。
全行とも製品試験は未接続。既存資産は§7の限定的な参考証拠である。

| ID / scope | 保証する性質・独立oracle                                                                                | 必須検証と代表シナリオ                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| V01 / F01  | 公開版は耐久版以下。成功応答済み操作を再起動後も保持。retryで二重適用なし                               | S/I/N：保存失敗→retry、commit後応答喪失→再送/結果確認、snapshot集約中断→再open                                           |
| V02 / F02  | root Enterは子生成、通常splitは本文/順序/IDを保つ。一つのIME確定を分割しない                            | P/I：空/先頭/末尾/改行/Unicodeの固定例と分割結合。U/N/R：日本語変換・取消・caret・カード高さ変化                         |
| V03 / F03  | live Blockの所属root一意、通常indentは境界不変、move/cutは論理ID維持、duplicateは新IDで内部参照だけ写像 | P/I＋既存A差分監査：独立parent/order表で移動・複製。Undo/Redoで元順序を観測。U/N：操作到達性                             |
| V04 / F04  | 代表本文と参照表示が一致、参照の子/固有見出しは独立、chainなし                                          | P/I/U/N：代表編集→複数参照反映→再起動、参照から代表へ移動。代表/参照それぞれの削除                                       |
| V05 / F05  | 別名は実体、固有見出しは参照項目に属す。metadata変更が一操作で往復                                      | P/I：同名/空名/Unicode/Markdownの期待値fixture、Undo/再起動。U：名前を付けたIDへ到達                                     |
| V06 / F06  | 契約どおりの一致/順位、結果ID重複なし、古い応答を非公開、purged本文/名前を非露出                        | P：小さい全件走査oracle。I：保存/再索引後の一致。U/N：別名補完→正しいBlock、逆順応答                                     |
| V07 / F07  | ラベル変更/移動でUUID解決不変。逆参照が本文リンク集合と一致。Missingとtrashを区別                       | P/I：code/fenceを含むparser固定例、削除/復元/purge。U/N：fold/画面を越えるreveal                                         |
| V08 / F08  | endpointとRelation IDを保持。型/direction/世代設定の意味を守り、配置は元edgeを変更しない                | P/I：作成/変更/撤回/独自型設定→Undo→再open。U/N：通常Block・参照項目への編集                                             |
| V09 / F09  | Topic投影とedge集合一致。filter前世代/SCC不変、派生元が上、Knotは循環成員のみ                           | P：小graphの到達可能性行列からSCCを求める独立oracle。U/N/R：複数root/diamond/循環/可変高編集/明示fit                     |
| V10 / F10  | fold設定と一時展開の独立、設定再起動保持、古いnavigate/focusを非公開                                    | S/U：要求世代と2 paneの操作列。I/N：SQLite設定失敗・再起動、Tree↔Outline・休止pane保護                                   |
| V11 / F11  | 一つのLIFO履歴、入力/IME/複合操作の区切り、再起動で空履歴、Undo後新入力でRedo失効                       | P/S/I：仮想時刻・ID発行台帳・履歴参照モデル。U/N/R：別pane Undo通知/明示移動、IME中のUndo抑止                            |
| V12 / F12  | 削除時対象集合だけを復元/purge。外部参照非連鎖。purge成功は耐久化＋全履歴clear後                        | P/S/I/A：先にC削除→親B削除→B復元/purge、保存/clear境界の失敗・終了。U/N：集合確認・Missing・cache非露出                  |
| V13 / F13  | native backup→空DBで契約上の全情報一致。破損/未知versionは既存DBを変更しない                            | P/I/N：意味的canonical比較、archive/設定/assetを含む往復、中断/欠落/破損・不明versionの固定例                            |
| V14 / F14  | Markdown出力が本文/順序/階層/リンクと参照情報を表す                                                     | P/I：手書き期待出力fixture。U/N：出力導線と実ファイル。完全backupとの等価性は要求しない                                  |
| V15 / F15  | 原本不変、確定した写像・共有/子構造/保留情報を失わない、再実行で重複しない                              | I＋A差分監査：旧DB hash前後比較、ID対応・診断・中断復旧・archive backup往復。全写像は#384待ち                            |
| V16 / F16  | 実WebView/配布条件で操作・a11y・保存/描画性能・復旧が成立                                               | N/R：keyboard/IME、Worker/CSP、file dialog、fresh install、1万Block/履歴蓄積・deep/cycle graph。閾値は既存性能契約に接続 |

PBTの正規化比較は論理ID、本文、parent、兄弟順、参照先、Relation、削除記録、metadataを対象とする。
TreeID/DBページ順/圧縮済みbackupバイト列など、契約が要求しない内部表現の一致を要求しない。
backupに含むUI設定とarchiveは別途比較する。runtimeのUndo履歴はbackup復元の等価条件に入れない。
検索の正規化/順位、名前の抽出は名前契約の手書き期待値も使い、production helperだけをoracleにしない。

## 3. PBTの実装契約

- 小さな参照モデルはMap/配列/集合で表す。Loroやproduction plannerを期待値生成に使わない。
  Undoのoracleには本文/構造の前後、操作group、発行済みID、Redo失効を明示し、状態全体の巻戻しでID台帳まで消さない。
- valid状態は制約を満たす生成器から作り、無効操作は別の生成器で意図的に作る。
  root/leaf/深い木、同名、trash、代表/参照、Missing、self-loop/多重edgeを分類して記録する。
- command列はcreate/edit/split/move/cut/duplicate/delete/restore/purge/Undo/Redoと、
  tick/pane切替/保存完了/失敗/通知/終了を必要な試験群だけで組み合わせる。 全操作を一つの巨大state
  modelへ入れず、共有fixtureで境界の縦断試験をつなぐ。
- preconditionでskipした回数と、実際に適用/拒否/失敗した回数を出す。
  各重要遷移には必ず固定例を置き、乱数が到達しなかった分岐を検証済みにしない。
- 操作列と初期状態を縮小する。参照先の削除などで列が無効化された場合も、縮小後の前提を再評価する。
  縮小で元の不具合を失った場合は最小とは呼ばず、元traceも保存する。
- Rust/TSは同じ契約IDとJSONの固定操作fixtureを共有できる形にする。 最初は共通fixture数件と通常のtest
  runnerで足りる。汎用cross-language runnerは作らない。
- failure artifactはV ID、契約版、commit/依存lock、seedと縮小情報、初期状態、時刻/ID列、
  操作/完了順列、fault位置、期待/実際の差分を含む。実データ/本文をCIへ持ち込まない。
  seedだけに依存せず縮小済みfixtureを回帰testへ昇格する。

実装開始時の予算はpure/state PBTを各property PR 100列×最大50操作、定期1,000列×最大200操作とする。
実adapterはPR 20列×最大30操作から始め、全fault境界の固定例を先に必須化する。
これらは初期値であり網羅性の保証ではない。実測後に根拠付きで調整し、timeout/skipを成功数に含めない。
clockは仮想時刻とし、実sleepで1秒group境界を検査しない。1秒の直前/境界/直後の扱いは実装契約で明文化する。

## 4. infraのfault・crash対応

| 注入点                              | 必須の観測                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------- |
| planner前/古い版の計画              | 無効操作/旧計画は適用・履歴・公開を変えない                                |
| Loro適用後・SQLite commit前の失敗   | dirty保持。保存のみretryし、適用/ID/履歴を重複しない                       |
| SQLite commit後・応答前             | 再起動で保存済み内容。再送で重複しない。旧UI要求の失効でDBを巻き戻さない   |
| purge durable後・clear前            | 成功/再開なし。終了→新しい空履歴とpurged記録で安全に起動                   |
| clear後・公開前                     | retry/再接続で整合した保存版を取得。古いUndo要求を実行しない               |
| snapshot集約/backup作成・復元の途中 | 完成済み世代を失わず、未完了を完成扱いしない。restore先の保全              |
| 索引更新/設定保存失敗               | 文書の成功と区別。古い索引で完全削除本文を公開しない。設定の保存失敗を表示 |

Sでは各注入点を決定的に再現し、Iでは実SQLite失敗と別connection読戻しを行う。
crash試験は子processをcheckpointで停止し、新processが同じ一時DBを開いて観測する。
close/reopenだけの試験をprocess killの代替にしない。process
killを停電/ストレージ故障の証明にしない。 command
dedup/結果照会、snapshot切替、backup置換の具体protocolはD4で決め、その後にcheckpointを実装する。
flush専用権限、queue済みUndoの再検証、購読dispose、旧error/finallyも検査対象とする。

## 5. E2Eの拡張順序

| ID  | 縦断シナリオ                                                 | 層               |
| --- | ------------------------------------------------------------ | ---------------- |
| E01 | 本文編集→参照反映→保存→終了/再起動                           | I/N、IME部分はR  |
| E02 | move/cut→検索・Relation投影更新→Undo/Redo→ID/順序確認        | I/U/N            |
| E03 | C削除→B削除→B復元/purge→外部参照/検索確認                    | I/U/N            |
| E04 | 完全backup→空DB→再export比較、破損restore拒否                | I/N              |
| E05 | 保存/検索/layout/画面遷移の応答逆順・旧失敗・dispose         | S/U、I/Nは代表例 |
| E06 | 可変高カードで日本語IME確定/取消・caret・fold・画面往復      | U/N/R            |
| E07 | purge保存失敗/retry→durable後crash→再起動→新編集Undo         | S/I/N            |
| E08 | 独自Relation型・参照見出し・同名補完・Markdown出力・設定復帰 | I/U/N            |

mock E2Eを全件Nへ複製せず、Nはbinding/保存/OS接続が切れると失敗する代表経路を持つ。
data-testid/role等の安定した操作点と観測版を使い、固定sleep・座標・画像だけで保存を判定しない。
DB改変で画面操作を省略しない。セットアップだけfixture投入を許可し、対象操作は公開入口を通す。
失敗時にtrace/screenshot、操作trace、DBの保存版と診断を残す。自動retryで緑になってもflakyとして追跡する。

## 6. 追加モデル検査の決定範囲

追加は既存Alloyを拡張する。別のモデル検査器は今回選ばない。
最初に既存モデル/最新契約/不足を対応付け、古い検査結果・hashは変更せず新しい結果を分ける。

| ID  | 対象                               | 検査条件と反例対照                                                                                                                     |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | 共通Undo＋purge＋保存/公開protocol | durable前成功禁止、clear前再開禁止、stale Undo拒否、crash/restart後履歴空。早期公開・origin除外のみ・dirty解除の誤実装で反例が出ること |
| A02 | 独立した削除集合・復元             | C削除→B削除後、B操作でCを復活/purgeしない。外部参照非連鎖。元の子孫を全選択する誤実装を反例対照にする                                  |
| A03 | 既存文書/legacyモデルの差分監査    | 新しい削除/参照/ID契約と一致する部分だけ証拠へ対応。#384未確定写像の正しさは保留                                                       |

A01/A02は小scopeから始め、最低限3 Block（親/子/外部参照）、2 pane、1共通履歴、
2操作要求、正常/失敗/retry/crash/restartのwitnessを含む設定を作る。
探索trace長は各witnessに届く長さで明示し、最初の目安は16遷移。必要なatom/履歴数を増やした結果は別に残す。
実行不能な大scopeを合格条件にせず、timeoutは未完了。安全性を遷移後のfactで強制しない。
livenessは保存が永遠に失敗する環境では保証しない。回復後に再開できる有限witnessを要求する。
検査記録はmodel hash、tool/solver、scope/steps、witness、negative control、receipt、限界を含む。

Relation/SCCはまず独立到達可能性oracleのPBT、非同期UIは状態機械PBT、
文字列/Unicode/Markdownは固定例＋PBTとする。全てをAlloyへ重複実装しない。
iroh/PDSと複数端末の削除/Undoは初回対象外。今回のモデル合格を将来同期へ流用しない。

## 7. 既存証拠と実装順序

- [文書/legacy Alloy](../../spikes/document-model-alloy/results.md)：当時の前提/scopeの記録。
  最新削除集合、共通Undo、実保存の証明とはしない。
- [purge旧Alloy](../../spikes/document-model-alloy/purge-results.md)：複数履歴方式。
  A01の参考であり、共通履歴版の合格ではない。
- [共通Undo fixture](../../spikes/loro-purge/shared-undo-results.md)と
  [実test](../../spikes/loro-purge/tests/shared_undo.rs)：実Loro/SQLiteの部分証拠。process
  kill、IME、製品接続は未検証。
- [画面遷移PBT](../../vitest/screen_navigation_pbt.svelte.test.ts)は要求完了順の制御方法を再利用する。
  v2のWork/Occurrenceモデルをv3 oracleへそのまま持ち込まない。
- [UI config](../../playwright.ui.config.ts)は[a11y config](../../playwright.a11y.config.ts)のmock
  Viteを継承する。 現在のUI suiteをNの証拠として扱わない。

実装順は、V01/V11/V12のS/I固定例＋A01/A02差分監査、#385向けE01、
V03/V04、V05〜V10、V13〜V16へ進める。#383→#384対象fixture→#385の依存を解除しない。
v2変換仕様待ちでも保存protocolのPBTやA01は進められる。初回全体の完成は全Vの受入を必要とする。

PRは変更対象Vの固定例/PBTと既存回帰、保存変更はI、UI変更はUを実行する。
定期実行は長い操作列・crash集合、配布前はN/R・全backup/移行・性能とする。 正式なblocking
gate・実行job・時間上限はD3で確定し、この文書だけでCI実装済みとしない。

各Vの証拠は「未接続→実装済み未実行→合格/不合格/保留」と分け、 契約版、test
path/名前、fixture/seed、実行command、対象commit、結果artifact、限界を記録する。
skip/ignored/quarantineは合格へ数えず、理由・Issue・担当・見直し期限を付ける。
データ喪失/耐久化/purgeの失敗をretryやquarantineで通さない。

## 8. 残る実装前の判断

D1は責任分担・対応表・oracle/再現規約・初期予算を本書で決定した。
D5はA01/A02の追加とA03監査を決定し、2026-10-31にモデル作成・実行を行った（§9）。 Rust PBT
runnerは[製品Rust依存](v3-rust-dependencies.md)でproptestを採用した。 native
driverはD2、command/version/実行thread/fault hookはD4、 CI gateはD3、全移行写像は#384で具体化する。
性能数値は[全体計画](tauri-migration-plan.md)と規模fixtureの既存条件を照合してV16へ引き継ぐ。
本計画策定時には試験コード・Cargo・CI・Alloy本体・GitHub Issueを変更していない。
後続の依存整理で製品Cargoを作成した。A01〜A03とPBTオラクルの実装記録は§9に分ける。

## 9. A01〜A03とPBTオラクルの実装記録（2026-10-31）

状態:
**モデル検査の実行合格と、独立oracleの実装・自己検証まで**。製品command・実Loro/SQLite・CIへの接続は未実施であり、
各Vの製品証拠は引き続き「未接続」。

### モデル検査

[v3追加モデル検査の記録](../../spikes/document-model-alloy/v3-results.md)に、hash・scope・witness・negative
control・限界を記録した。

- A01 `shared_undo_protocol.als`: 共通LIFO履歴＋purge
  barrier＋保存/成功応答/公開＋crash/再起動＋要求epoch。27 command全件期待どおり。
- A02 `delete_sets.als`: 削除操作ごとの独立項目・復元先・選択項目だけのpurge・参照非連鎖。18
  command全件期待どおり。
- A03:
  既存`document_model`の部分木全体restore/purgeは最新契約と不一致としてA02で置換、旧`purge_protocol`はA01で置換。
- 既存3モデルを含む5モデル95 commandを再実行し、全件期待どおり（Alloy 6.2.0、OpenJDK
  27.0.1.0.2、SAT4J）。

### PBTオラクル（P層）

`crates/radiora-core/tests/oracles/`（test target
`oracles`）。Map/Vec/Setの参照モデルだけで書き、production code・Loro・SQLiteを呼ばない。
Rust/TS共有の固定例は`crates/radiora-core/tests/fixtures/*.json`（契約ID・契約文・操作列・手書き期待値）。

| V   | oracle                 | 性質（PBT）                                                                                                                              | 固定例                                                                                            |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| V11 | `history.rs` 共通Undo  | ID台帳の単調性、拒否時の無変更、新編集でRedo失効、型付き単位の境界、全Undoで最後のclear時点へ戻る、Undo→Redo恒等、autosave挿入で単位不変 | 12件（1秒境界・別pane/caret/Block切替・IME・paste・ID非再利用・再起動・flush失敗・purge clear）   |
| V12 | `trash.rs` ゴミ箱      | 項目の独立・状態整合・liveの木の閉包、削除集合＝live部分木（既存項目と素）、復元/purgeが当該項目だけ、参照非連鎖、削除→即復元で順序往復  | 7件（契約例C→B、purge後の独立復元、代表/参照項目、兄弟目印の消失、root復元）                      |
| V09 | `lineage.rs` Topic投影 | 全Relationの単一分類、通常edgeで世代増加、Knot＝独立DFSの循環判定と一致、filterで世代/Knot/分類不変、入力順で意味不変                    | 6件（FROM正規化、diamond、Knotと出入り、カード内/自己loop、集約・非世代・ゴミ箱/Missing、filter） |
| V03 | `structure.rs` 複製    | 新IDの非衝突、原本の配置/参照/リンク不変、コピー集合内だけ写像、子順序の複写                                                             | 3件（B→C同時/単独コピー、本文リンクと子孫）                                                       |

PR予算は§3どおり100列×最大50操作（`PROPTEST_CASES`/`RADIORA_PBT_MAX_OPS`で変更）。乱数が到達した分岐を数え、
0件の分岐があればtestを失敗させる（例: Undo拒否理由、通知、兄弟目印消失、Knotと正世代の共存）。
到達率の低い分岐には生成器の偏りを加えた。failureは`proptest-regressions/`へ保存し、縮小済み例を固定例へ昇格する運用とする。

実行証拠（Windows MSVC、Rust 1.98.1）: `cargo test -p radiora-core --test oracles --locked`で14
test成功、 定期予算相当（`PROPTEST_CASES=1000 RADIORA_PBT_MAX_OPS=200`）でも14 test成功（約13秒）。
`cargo fmt --all -- --check`と`cargo clippy -p radiora-core --all-targets --locked -- -D warnings`も成功。
oracle自体の検出力は誤実装の一時注入で確認した（既存項目を飲み込む削除、purge後の本文残存、1秒境界の排他化、
新編集でRedo維持、filter後graphでの循環判定。すべて失敗を検出し、注入は戻した）。

### oracle作成で置いた解釈（製品決定ではない。変更時は固定例を更新）

- 「入力間隔1秒以内」: ちょうど1000msは同じ単位、1001msで分割。
- 「位置の目印となる兄弟」:
  削除時の直前の兄弟（先頭なら親の先頭）。それが元の親のliveな子でなければ末尾へ復元。
- Undo通知:
  要求paneと記録paneが異なるか、要求paneの現在Blockと対象Blockが異なれば通知（画面は動かさない）。
- Knot隣接の世代: Knot成員からのedgeは世代計算に使わない（現行`tree_lineage_projection.ts`と同じ）。

### 残作業

- 製品command/ControllerをこれらのoracleとJSON固定例へ接続する（P/S/I層）。TS側のfixture読込も未実装。
- A01の具体protocol（command
  dedup・snapshot切替・backup置換）がD4で決まったら、fault注入点（§4）とモデルを照合し直す。
- CIへのAlloy/PBT job接続はD3/Q4で行う。現時点ではローカル実行の証拠のみ。
