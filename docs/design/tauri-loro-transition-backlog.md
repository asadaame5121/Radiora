# Tauri / Loro移行：現行版の退出gateとIssue実行計画

状態: 現行版の新機能追加凍結（G0）・既存改修によるv0.7.0リリース・新機能のTauri版実装はユーザー承認済み。
G1は未到達、G2/G3の利用切替・保守終了は未承認。GitHub Projectsへ反映済み（実績は末尾）。
入力: ユーザー提供の2026-10-16棚卸し（コード基点 `259bdb9`、open 43件）、
[移行計画](tauri-migration-plan.md)、[Loro調査とPoC仕様](loro-backend-migration-research.md)、
追加提供の[Topicルート/文書設計](topic-document-design.md)。
本worktreeの照合基点は `faa8c16`。入力のIssue stateは履歴情報であり、現時点のopenを保証しない。

新バージョンのPoC・文書・実装は `v3` ブランチへ集約する（起点 `fe090e8`）。
最新の製品決定と#381〜#385の担当境界は[v3決定事項](v3-model-decisions.md)を参照する。
旧Branch中心の互換案や当時の未決事項を、最新v3モデルの決定として扱わない。

## 1. 方針：現行版を完成させてから移行しない

**現行版への新機能追加は凍結する。昨日までに行った性能・UI改修を反映したv0.7.0はリリースし、
ここまで挙げた新機能はTauri版で実装する。** これはユーザーの決定である。
これと「今すぐ現行版を使えなくする」「旧データを捨てる」は別である。
43件の消化率ではなく、保存・復元・日常作業の証拠を切替条件にする。

v0.7.0は既存改修の検証・配布を行う限定releaseであり、未完了Issueの追加実装をまとめて引き受けるreleaseではない。
ユーザーが指定したrelease境界は**PR #340のmergeとStack #369の完了**。
両方の確認に加え、**前回releaseからのChangelog案をユーザーへ提示し、明示承認を得てから**v0.7.0を切る。
Changelog承認前はtag作成/push・release公開・公開を開始するworkflowを実行しない。
条件付きreleaseの依頼であり、当該PR/Stackのmergeを代行する許可ではない。
Stack #369の構成PRとrelease targetへの包含、最終tagとの差分はrelease準備で照合し、未監査の範囲を完成扱いしない。
現行版で今後修正する例外としては、データ喪失/破損、backupや旧データ読出し不能、
移行検証を妨げる重大な不具合、セキュリティ問題を提案する。個別に範囲を判断し、新機能を紛れ込ませない。
置換予定Backendの単独リファクタリングは原則保留。新規UI機能も現行版ではなくTauri版へ載せる。
テスト・共有契約の整備は実装先と区別し、移行と並行可能でも優先着手とは限らない。

現行版を追加整備するかは次の順で判断する。

1. 利用・データ保護のため、今直さないと困るか → 現行版で最小修正し回帰を残す。
2. 移行先で同じ意味を再現するために必要か → 契約・fixtureを抽出し、実装は新版へ。
3. UI資産としてそのまま持ち越せるか → 新機能ならTauri版で実装。既存改修のv0.7.0受入と混同しない。
4. 置換予定のTS構造だけを改善するか → 原則保留。移行の前提にしない。

## 2. 「放棄」を4段階に分ける

| Gate | 判断 | 必要な証拠・条件 |
| --- | --- | --- |
| G0：機能追加の凍結 | 承認済み。新機能はTauri版へ。現行版は既存改修をv0.7.0としてリリースする | v0.7.0の具体的な収録差分・検証・配布は未実施。初回Tauri範囲と例外保守を別途確定。現行版の利用は続ける |
| G1：新版への実装投資を継続 | M0-Lの中核検証後。現行版は保守対象として残す | snapshot＋差分の保存/再起動、失敗・retry・応答喪失、本文共有/安定ID、undo/session方式、1万件測定。未達は原因と代案を記録し、保存不能のまま全面移植へ進まない |
| G2：日常利用先の切替 | Tauriの必須sliceと実データコピー試験後 | 初回必須操作、全保存データの変換照合、backup→空DB復元、再起動、IME/focus、配布build、診断、実効耐久性設定、失敗回復、対象端末性能。利用者が欠落機能と復帰限界を確認して切替を承認 |
| G3：旧runtimeの保守終了・撤去 | 新版の利用・配布と復帰手順を確認した後 | 旧DBの保管、新版編集後の復帰可否、未解決の重大障害、旧runtime不要のrelease artifactを照合し、明示的に承認。旧コード削除は別PR |

G2までは旧版と新版を**別DB**で検証する。日常利用するwriterは一方だけとし、dual-writeしない。
G2後に旧DBへ戻れば、新版だけの編集は失われ得る。旧形式への逆export/importが未検証なら、
「旧版へ無損失rollbackできる」とせず、新版DBを保全したうえで前方修復する手順を用意する。
旧binary/DBの保管期限と保守窓はG2で決め、日数を根拠なくここで固定しない。

## 3. 元の棚卸しから変えること

- **製品モデルの判断を追加**：root＋子孫＝文書、タイトルもblock、内部block参照の方針を取り込む。
  Topic＝Work/文書＝Work/block＝Occurrenceは未決定。下記T-00で初回境界操作・同一性・旧共有の移行規則を決める。
  「既存モデルをそのままRustへ再現」だけでは製品の受入条件を満たさない。
- **#286**：現行TSへ限定的Loroを導入してから再移植することを必須にしない。
  操作/undo単位を固定し、Backend Loroとsession分離のPoC→新版実装へ進める。
- **#290**：所有・互換性の判断は先行するが、新しい名前モデルの実装完了まで保存PoCを待たない。
  未決なら現行の意味を暫定fixtureとし、schemaを変える前に決着させる。
- **#254/#255/#260/#261**：全メソッドの契約表を完成させる長い準備工程ではなく、
  最初の本文/配置sliceに必要な不変条件から抽出する。未提供操作の契約は次sliceで追加する。
- **#266**：旧SQLite row/payloadの互換性は移行readerの契約。
  新版の通常保存はLoro snapshot/Updateであり、旧record schemaを将来の保存APIに固定しない。
- **#267/#268**：現行TSの全面Result化ではなく、起動・import・永続化失敗のcodeと保護条件を固定する。
- **#329**：現行版の最小baseline smokeと、新版の保存/再起動smokeを分ける。
  現行Denoの大規模E2E基盤を完成させることを移行着手条件にしない。
- **#235/#236→#288/#269**：初回範囲の判断を早く行う。保留なら保存済み定義・理由・feedbackの保護は必須だが、
  新ranking/理由再利用/ルールエンジンは移行のcritical pathへ入れない。採否は未決定。
- **#72系**：28日観測と保存安全性のgateは別。移行前後で基線を分け、既存release gateの変更は明示承認する。
  「今回の移行を速める」だけで既存の観測/配布条件を黙って無効化しない。

## 4. 実行順：契約と検証をslice単位で進める

`P0`等は本計画内の優先順であり、新しいGitHub triage labelではない。
`T-*`は出力時の照合keyであり、GitHub Issue番号ではない。
既存Issueは再利用し、複数成果を持つものは必要な場合だけchildへ分割する。

| Key | 優先/実装先 | 作業と受入条件 | 先行条件 | 関連Issue |
| --- | --- | --- | --- | --- |
| T-V07 | P0・現行release | PR #340とStack #369を含む収録差分を照合し、既存verify/保存復元/実機受入とChangelog案を準備。ユーザー承認後にv0.7.0を配布。新機能は追加しない | #340 merge＋Stack #369完了をliveで確認し、Changelogの明示承認を得る。merge代行は含めない。未達ならtag/公開をせず停止 | 既存release追跡を再利用。#121等のopen全体完了とは別 |
| T-00 | P0・製品モデル判断 | Topic/文書/block、初回の境界操作とID/参照、既存共有・複数配置の対応を決める。旧構造上の読取り投影とfixtureで検証。未採用候補は区別 | なし。保存技術PoCと並行可 | #290 #286 ＋製品モデル判断の新規候補 |
| T-01 | P0・判断 | G0、初回機能、名前/見出し、undo対象・session、保留機能データ保護を決める。Loro方針と旧ADRの置換関係を記録 | なし | #290 #286 #235 #236 #288 #204 |
| T-02 | P0・現行検証/共有 | 固定データの読込→編集→保存→再起動baselineとbackup往復を確保。既知バグと仕様を分ける | なし。T-01と並行 | #329 #79 #254 #255 |
| T-03 | P0・共有契約 | 最初の本文/配置sliceの型・validation・参照・失敗・DTO・fixture。独自関係型、非UUID ID、欠損/null、Unicodeを保持 | T-01の当該判断 | #254 #255 #260 #261 #266 #267 |
| T-04 | P0・独立Rust PoC | M0-L。先に最小モデルで差分永続化・失敗/再試行・snapshot最新1世代の集約を証明し、session undoと1万件測定へ。結果を保存 | 最小入力モデル。T-03全件完了は不要 | #286 #329 ＋移行固有作業 |
| T-05 | P0・新版移行reader | 旧DB→別DBのLoroモデル変換。17種類全件の保持、schema/version拒否、再実行、全snapshot＋差分から復元。旧linkと共有の意味を照合 | T-00の対応規則、T-03/T-04の保存形式確定 | #266 #267 #79 ＋移行固有作業 |
| T-06 | P0・Tauri＋既存UI | invoke adapter、独立DTO、本文表示/編集/耐久保存/同Branch反映/再起動、draft/旧応答保護。実WebViewでIME/focus | T-04中核合格、T-05の対象fixture | #329 #121 #265 |
| T-07 | P1・新版操作 | 配置の作成/移動/削除/子の昇格、行分割等の複合command、session別undo。本文autosaveとの境界を通す | T-06、T-01のundo契約 | #286 #260 #261 |
| T-08 | P1・新版互換 | Revision/Recovery、link、検索/補完、Tree意味投影、JSON/OPML入出力を初回範囲に沿って追加。保留機能のデータも往復 | 当該sliceの契約/fixture。T-07と一部並行可 | #290 #268 #257 #253 #264 #79 |
| T-09 | P1・新版計測/配布 | OperationLogの意味/保持/削除、privacy、release build、署名/更新、対象OS試験。観測は版別に区分 | ログ契約はT-01と並行、配布受入は必須slice後 | #209 #210 #211 #72 #74 #75 #76 #77 #78 #80 #81 |
| T-10 | P1・切替判断 | G2の証拠一覧、初回範囲の欠落/制約、移行と復帰runbook、既知障害を照合。承認後に利用先を切替 | T-05〜09の必須受入 | #81 #79 #329 |
| T-11 | 後続・撤去判断 | G3の保守終了承認後、旧起動/transport/runtimeを撤去。旧DB/archiveは別扱い | G2後の利用結果・復帰方針・明示承認 | #204 ＋移行固有作業 |

T-04のstorage CLI PoCはTauri shellの完成を待たない。T-06の最初の保存sliceはPetgraph/ELKの完成を待たない。
T-00未決でも最小fixtureによる永続化方式の検証は進められるが、最終doc/schemaの採用と製品データ変換は待つ。
G2には採用した文書モデルと境界操作・内部参照の受入も含める。旧共有を独立コピーへ黙って変換しない。
Treeが初回必須なら既存layoutの意味を維持して提供し、ELK/Svelte Flowへの置換は独立した任意評価とする。
性能目標はPoC仮説と実機の正式gateを区別する。未達時に保証を落として成功扱いにしない。

## 5. 43件の既存Issueの実行先（入力一覧の全件対応）

同じ行のIssueでも完了条件を混ぜない。ここでの「契約抽出」は元Issue全体の完了やcloseを意味しない。
親Issueはchild成果を参照する追跡単位とし、親とchildの両方を独立した実装工数へ加算しない。

| 入力Issue | 推奨する実行先・扱い |
| --- | --- |
| #290 #286 | T-01で仕様、T-03/04で契約とPoC、T-07/08で新版実装。現行TSへの先行機能実装は必須でない |
| #235 #236 #288 | T-01で初回採否と既存データ保護。高度化は後続候補。#288は#235判断後 |
| #254 #255 #260 #261 #266 #267 #268 #329 | T-02〜08の対応sliceで契約・fixture・新版受入へ分配。現行TS構造改善を一括で要求しない |
| #328 #292 #283 #189 #186 #134 #130 #121 #265 #258 #259 | 新規機能はTauri版、テスト/回帰は共有候補。昨日までの既存改修だけをT-V07へ。#130は再現、#134/#265は実WebView、#121は起動区間測定。#186/#292は親計画。未完了UI全体をv0.7.0へ積まない |
| #262 #264 #257 #253 #269 #204 | TS単独整理は保留。#264/#257/#253は対応sliceのfixtureへ、#269は#236後。#204は移行/保留の追跡を更新する候補 |
| #209 #210 #211 #72 #74 #75 #76 #77 #78 #79 #80 #81 #216 | T-09/10と観測へ。#79の復元検証はT-02から。#216の国際化は需要依存で切替条件外 |

入力でNot Plannedの #120 #212 #213 #215 #263 は再開しない。
旧MSIX作業の再開と、新Tauri配布で必要な署名・更新・データ保持の検証を混同しない。
最新GitHub stateを照合し、既にclosedのIssueを計画に合わせて再openしない。必要な未完了差分だけを別作業へ関連付ける。

## 6. GitHub Projectsへの出力

出力先はユーザー指定の[Project #4](https://github.com/users/asadaame5121/projects/4)。
ユーザーから権限追加完了の連絡を受け、既存field/itemを照合して反映する。新規boardや重複Issueを先に作らない。
GitHub Issueを作業の正本、Projectを順序・状態の表示とし、本書は方針とgateの根拠を保持する。

- 既存43件はIssue URLで照合して追加済みか確認する。出力の再実行で同じitemを増やさない。
- 移行固有の保存PoC、変換reader、縦断slice、切替/撤去のgateは未存在の場合だけ新規Issue候補とする。
  `T-*` keyと既存Issueの範囲を照合してから作成する。
- 最小fieldは既存のStatusと、必要なら「実行先」（現行保守/共有契約/新版/後続）・「Gate」。
  既存fieldが同義なら再利用し、独自labelを大量追加しない。triageは既存5 labelの意味を維持する。
- native dependency/sub-issueが利用できれば使う。使えなければ本文に `Blocked by` / `Part of` を置く。
- 表示候補: 直近の着手可能作業、移行critical path、現行版の例外保守、後続/保留。
  View作成API等が使えなければ手動設定事項として明記し、できたふりをしない。
- 仕様未決定はReadyにせず、契約抽出だけでIssue全体をDoneにしない。
  実装Doneは固定base/mainのsymbol・回帰と照合し、配布済みやG2/G3承認とは区別する。
- Project反映はIssue一括close、再open、label変更、G0/G2/G3の実行を暗黙には含めない。

公開結果はProject URL、追加/再利用したIssueとitem、変更したfield、未反映項目を記録する。
権限・接続・出力先が不明ならローカル原稿までで止め、必要な情報だけ確認する。

## 7. 今回の証拠と未決定

保存層だけでなく、既存ControllerのDTO portで波及を抑えられることを先行Scout調査で確認した。
UIからstorageへの直接importは0件、Controller 43ファイル、API 85メソッドという静的集計であり、
全callerの意味的互換性や性能の証明ではない。全Controllerの書換えを既定工数にしない。

G0の新機能凍結、v0.7.0の限定release、新機能のTauri版実装、Projects出力先は確定した。
v0.7.0の具体的収録差分、初回Tauri機能一覧、正式性能gate、G2後の保守窓/復帰方式は確定が必要。
コード・依存・DBは変更せず、runtime test/実機/1万件PoCは未実施。GitHub state・反映結果は確認できた事実だけ別途追記する。

### GitHub読取りの確認結果

Luna ScoutがremoteとREST APIで照合した結果、対象repoは `asadaame5121/Radiora`、
上記43件はすべてOpen、除外5件はすべてClosed / `not_planned` だった。
#286/#290/#235/#236は `needs-triage`、#266/#329は `ready-for-agent`。
labelが既存計画のままでも、今回の契約変更が実装準備済みとは扱わない。
取得時のIssue stateであり、以後の更新やmainの実装状態まで保証しない。

初回のProjects v2一覧取得は `read:project` scope不足で失敗した。
その時点では出力先ID・field/view・書込み権限を確認できず、Project不存在とは判断しなかった。
その後ユーザーから権限追加とProject #4の指定を受けた。再確認・反映の実績は完了報告で区別する。

### GitHub Projectsへの反映実績

Luna workerが[Project #4「RadioraV3」](https://github.com/users/asadaame5121/projects/4)
（`PVT_kwHOBGeCgc4BncWF`）へ反映した。既存51項目（43 Issue＋8 PR）を保持し、draft 7件を追加して計58項目。
43 Issueはすべて既存itemを再利用し、repository Issueの新規作成はしていない。

既存Status（Todo / In progress / Done）を維持し、single-select「実行先」を追加した。
選択肢は「現行v0.7.0」「共有契約・検証」「Tauri版」「後続・保留」。
Gate専用field・新label・viewは作成していない。

| 追加draft | Project item ID |
| --- | --- |
| 移行計画概要（G0承認・G1未到達・G2/G3未承認、T-00〜11） | `PVTI_lAHOBGeCgc4BncWFzhBaf8Y` |
| 現行v0.7.0 release境界 | `PVTI_lAHOBGeCgc4BncWFzhBagCE` |
| T-00 文書モデル判断 | `PVTI_lAHOBGeCgc4BncWFzhBaf8A` |
| T-04 Loro差分永続化・1万件PoC | `PVTI_lAHOBGeCgc4BncWFzhBaf8U` |
| T-05 旧SQLite→新Loro移行reader | `PVTI_lAHOBGeCgc4BncWFzhBaf8w` |
| T-06 Tauri縦断slice | `PVTI_lAHOBGeCgc4BncWFzhBaf8o` |
| T-10/T-11 切替・撤去の判断gate | `PVTI_lAHOBGeCgc4BncWFzhBagE8` |

draftはTodoに設定し、既存IssueのStatusは変更していない。既存Issueの「実行先」設定は次の19件。

- Tauri版：#283 #286 #290
- 共有契約・検証：#253 #254 #255 #257 #260 #261 #264 #266 #267 #268 #328 #329
- 後続・保留：#204 #216 #262 #269

残り24件は親計画・複数実行先・残作業/初回scope監査待ちのため未設定。
既存Issue全体をv0.7.0へ割り当てず、既完了の改修を照合するrelease draftだけを現行版laneへ置いた。
T-01/02/03/07/08/09は概要draftと既存Issueで追跡し、重複した実装ticketを作っていない。

Issueのclose/reopen・label/assignee/body、既存PR、Project名/README、既存3 viewは変更していない。
Not Planned 5件は追加・再開していない。release/tag/push・G2/G3・旧DB削除は未実行。
移行専用viewは必要なら手動で設定する。v0.7.0の具体的収録commit/asset・release noteの監査は次作業として残る。

### 移行固有Issueの起草・登録

ユーザーの起草依頼により、Luna workerが以下を登録した。上の58項目は初回反映時の件数であり、
登録後は59項目（既存draftのin-place変換4件＋新規item 1件）、draftは概要・release・G2/G3の3件。

| Key | Issue | triage / 実行先 |
| --- | --- | --- |
| T-00 | [#381 文書モデル・境界・ID・旧共有の移行規則](https://github.com/asadaame5121/Radiora/issues/381) | needs-triage / 共有契約・検証 |
| T-01 | [#382 初回スコープ・保留データ保護・ADR置換](https://github.com/asadaame5121/Radiora/issues/382) | needs-triage / 共有契約・検証 |
| T-04 | [#383 Rust Loro/SQLite差分永続化・失敗復旧・1万件PoC](https://github.com/asadaame5121/Radiora/issues/383) | ready-for-agent / Tauri版 |
| T-05 | [#384 旧SQLite→別Loro DB移行reader・backup・未知schema保護](https://github.com/asadaame5121/Radiora/issues/384) | needs-triage / Tauri版 |
| T-06 | [#385 Tauri本文編集→耐久保存→再起動の縦断slice](https://github.com/asadaame5121/Radiora/issues/385) | needs-triage / Tauri版 |

#381/#383/#384/#385は既存draftから変換しProject item IDを維持した。
#382だけ新規item `PVTI_lAHOBGeCgc4BncWFzhBapIE`。すべてTodoで実装済みではない。
native dependencyは #384が#381/#383に依存、#385が#383/#384に依存。
#381/#382/#383はblockerなしで、モデル判断と最小保存技術PoCを並行できる。
初回製品scopeの採否は#382、当該commandの仕様・実装準備完了は各Issueで確認する。

横断DTOは#385のsliceに含め、既存#254/#255/#266/#267との独立重複Issueを作っていない。
G2/G3は判断draftを維持。既存43 Issueの本文・label・Status・assignee、
release draft、タグ/公開、コードには変更を加えていない。

### 着手順とnative dependencyの反映

追加で #382→#384、#258→#259、#235→#288、#236→#269 を設定した（矢印はblocker→blocked）。
既存の #381/#383→#384、#383/#384→#385 は保持した。関係の削除はしていない。
反映後の全state Issue読取りとDFSでは全15 edgeに循環はなく、Projectは59項目のまま。

最初の着手候補は #381/#382の仕様判断、#383の独立技術PoC、#329の最小baseline/backup検証。
これらは相互にblockしない。#384は#381/#382/#383の完了待ち、
#385は#383/#384待ち（モデルとscopeは#384経由）とする。
#286/#290は#381に入力する設計を含むため、Issue全体をblockせずフェーズコメントで実装開始条件を区別した。
#254/#255/#260/#261の契約抽出も#381待ちにはしない。

Project概要へFIRST/NEXT/DO NOT STARTを追記し、#286/#290/#329/#384/#269/#288へ説明コメントを追加した。
未決schemaでの実データ変換、現行Denoへの新機能、任意TS整理を移行の必須条件にする進め方、
未承認のG2/G3やreleaseの実行は禁止/保留として区別した。
Issue本文・label・Status・assigneeとrelease draftは変更していない。PR/sub-issue関係は今回の循環検証対象外。
