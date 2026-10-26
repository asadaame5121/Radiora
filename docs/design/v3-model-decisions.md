# Radiora v3：決定事項とIssue別の所有

状態: ユーザーの設計決定を記録。実装・全移行検証の完了を意味しない。
新バージョンのPoC・文書・実装は `v3` ブランチへ集約する。
起点は `poc/loro-undo` の `fe090e8`（PoC、設計文書、Alloyモデルを含む）。
現行版releaseと `main` の更新は別作業とし、ここから自動でmergeしない。

旧資料の「UUID/参照構文/Doc単位は未決」「Branch中心のモデルをそのまま移植」は現在の決定ではない。
製品仕様は本書、実装の詳細・検証は各Issue、検査の証拠はAlloy成果物で区別する。

## 所有表

| Issue | 決定・検証のowner | このIssueへ残さないもの |
| --- | --- | --- |
| [#381](https://github.com/asadaame5121/Radiora/issues/381) | 文書/Block、境界操作、論理ID、参照・削除の意味 | Importerの配布/変換詳細、DB保存方式、初回scope全体、UI統合の実装 |
| [#382](https://github.com/asadaame5121/Radiora/issues/382) | 初回対象/対象外、保留データ保護、旧ADRの置換、切替判断 | 個別変換算法、モデル検査を実装済みとする判定 |
| [#383](https://github.com/asadaame5121/Radiora/issues/383) | 単一Doc、差分耐久化、snapshot集約、障害/規模検証 | 文書モデルの再決定、最終Importerの全実装 |
| [#384](https://github.com/asadaame5121/Radiora/issues/384) | Legacy Importer、旧情報/共有の対応、ID写像、診断/配布/再実行 | Work＝Topic等の機械的変換、旧DBの破壊的変更 |
| [#385](https://github.com/asadaame5121/Radiora/issues/385) | TauriのBlock編集・保存・参照項目反映・再起動、実UIの操作検証 | v2 Branch同期をv3の製品モデルとして固定すること |

決定そのものは以下に一度だけ定義し、各Issueは担当節と依存先へリンクする。
決定を別Issueへ移すことで「再び未決」に戻したり、引継ぎだけで実装完了扱いにしない。

## 1. #381：文書モデル・境界・同一性

### 決定

- LoroTreeの親を持たないBlockと子孫を一つの文書（Topic）とする。root自身がタイトル。
  独立したタイトルfieldは必須にせず、空/子なしの文書も許可する。
- root/通常Blockは同一ID体系。所属文書は親子関係から決まり、Hoist/Zoomは所属を変えない。
- root Enterは最初の子Blockを生成し、rootを分割して文書を増やさない。
  通常BlockはEnterで分割、Shift+Enterで改行する。
- 通常のindent/outdentは文書境界を越えない。
  通常Blockの部分木の文書切り出し、文書間移動は提供し、IDを維持する。
- Undo/Redoは元の親子・順序・同一性を復元する。複製は新IDを発行する。
- Block IDはUUIDv7、workspace内で一意、削除後も再利用しない。
  移動・切り出し・Undo・復元で維持する。Loro TreeIDとは別の論理IDとして扱う。
- 正準内部リンクは `[表示名](radiora://block/<UUID>)`。
  ラベル変更と参照先の同一性を分け、本文リンクと型付きRelationを別機能にする。
- 通常削除は復元可能なTombstone。内部リンク/Relationは残す。
  完全削除は本文/タイトルを除去し、削除済みIDの最小記録とMissing参照を残す。
  中間Blockの削除で隣接Relationを自動接続しない。
- v2の操作モデルを完全再現せず、蓄積された情報と参照関係を黙って失わせない。

### 残る仕様境界・検証

- 通常削除の部分木範囲、親も削除済みの場合の復元、完全削除をUndoできるか。
- コピー時の内部参照の再対応、参照chainの可否、代表削除時の参照項目の意味。
- 折りたたみの所有/保存先。具体的なUI表示は#385。
- 実Loroの内部ID再生成、複数段Undo/Redoで論理ID・本文・順序が維持されることは#286/#383/#385で検証する。

Alloyのscope内で成立した条件と、追加で置いた仮定は
[検査記録](../../spikes/document-model-alloy/results.md) /
[仮定一覧](../../spikes/document-model-alloy/README.md#仮定未決事項を確定しないための境界)を参照。
Alloyの削除・復元・直接参照等の仮定を、ユーザー決定として採用しない。

## 2. #382：初回対象外・データ保護・旧方針の置換

### 決定

初回対象外:

- rootの通常Blockへの降格、文書同士の統合専用操作。
- 独立した原稿編集ビュー、v2 Branch/Merge機構の完全再現。
- 全過去Revisionを通常Topicとして表示すること。
- 参照項目上での共有本文の直接編集。
- Loro履歴・既存backupまで含めた物理的な完全抹消。
- ATProto等の外部公開/同期。

これらは採否不明ではなく初回対象外である。
一方で、旧Branch/Revision/Recovery、リンク/Relation、stub、未配置、削除記録、
新モデルに直接対応しない旧recordの情報保全は必須とする。
旧機能の画面/操作を提供しないことを、旧情報の廃棄許可にしない。
現行Deno版への新機能追加は凍結し、新機能はTauri版で実装する。

### 残る判断

- #235/#236等を含む初回機能一覧の最終確認、保留機能ごとの最低保持/読出し保証。
- 旧ADR 0003の限定Loro導入方針との置換記録、他の設計契約との整合。
- 新版への日常利用切替・旧runtime撤去は未承認。旧DB/archive保管・復帰限界と別に判断する。

## 3. #383：保存・Doc・履歴管理の検証

### 決定

- **単一workspaceに一つのLoroDoc**。Doc分割は現在の未決事項として扱わない。
- BackendのLoroがSSOT。ControllerはBackend APIを使い、UI draft/focus/navigationのownerを維持する。
- SQLiteは最新1世代の全snapshot＋後続Updateを保存する。
  通常更新の成功は差分の耐久化までで、毎回全snapshotを待たない。
- snapshot置換と取り込み済み差分削除は同じtransaction。
  集約周期は差分量・件数・復元時間の測定から決める。内部履歴GCは別判断。
- 完全削除は過去履歴やbackupからの物理抹消まで保証しない。

### 残る実装・証拠

- crate固定、実効SQLite耐久性設定、writer/公開境界、保存失敗/retry/idempotency。
- UUIDv7生成器・衝突検出、削除済みID registry、履歴GCの具体方式。
- 単一Docでの1万件、編集履歴蓄積、メモリ、snapshot/復元、DB/WAL実容量。
- 実Loroのmove/cut/undoをPoCで検証する。AlloyモデルでLoro自体が検証済みとはしない。

モデル決定#381と、最小fixtureを使う保存技術PoCは並行できる。
単一Doc方針が実測で成立しない場合は、勝手に分割せず決定の見直しとして報告する。

## 4. #384：旧データとLegacy Importer

### 決定

| 旧データ | 変換・保全 |
| --- | --- |
| 単一Occurrenceの通常Work | 原則通常Block |
| OccurrenceなしWork | root Topic |
| stub | 通常Topic、旧属性は保全 |
| 複数Occurrenceの共有内容 | 代表Block＋その本文を表示する参照項目 |
| Occurrenceごとの子構造 | それぞれ独立した階層として維持 |
| 異なるBranch/固定Revision | 一つの現在本文へ無条件に統合しない |
| pinned/内部リンク・Relationから参照されたRevision | 参照可能な独立Blockとして実体化 |
| 参照されない過去Revision | 旧履歴archive。全件を通常Topic化しない |
| 旧内部リンク | ID写像で新形式へ。ラベル維持、code/fence等の非リンク文字列は書き換えない |
| 解決不能な参照 | 任意Blockへ付替えずMissingとして保全、診断に記録 |

独立Legacy Importerとして設計し、移行期間中はアプリ同梱、同梱終了後も公式サイトから単体提供する。
Dry-run、変換結果、旧ID→新ID対応、未変換データと理由をレポート化する。
曖昧な変換を完全成功扱いせず、共有解除・旧履歴/record破棄を黙って行わない。
原本SQLiteは変更せず、別DBへ変換。in-place/dual-writeはしない。

### 残る実装・証拠

- 同じWorkの異なるBranch/Revisionを区別した共有グループと、決定的な代表選択。
- archiveの形式・参照/読出し方法、17種類全recordの対応、再実行marker・中断復旧。
- 旧ID写像、衝突、曖昧参照の診断、文字列/Markdownの安全な変換。
- 部分木、pinned、孤立Work、複雑なBranch/Revision、backup往復等のfixture。
- 同梱・単体配布・互換versionの具体的な提供手順。

## 5. #385：Block編集と参照項目のTauri縦断slice

### 決定・受入へ反映すること

- #381のEnter/改行・階層・切り出し・文書間移動を、保存/undoと一貫した操作単位で提供する。
- `[[`で内部リンク補完、表示名の前方一致、root/通常Block両方を候補にする。
  同名候補は所属文書/パンくずで区別する。
- 参照項目は代表Blockの本文を表示し、自分の子構造は独立して持つ。
  直接本文編集は提供せず、代表へ移動して編集する手段を設ける。
- 実UIでの編集→差分耐久化→参照項目反映→再起動を検証する。
  **v2の「同一Branch反映」は旧互換の検証とし、v3のモデル名として固定しない。**
- draft、IME、caret/focus、画面移動、旧応答失効、保存失敗/retryを検証する。

### 残る実装・証拠

- command/DTO/version token、複合command、session別Undoの配線。
- 補完索引/検索性能、Missing/削除/参照先への移動、pinned実体化後のUX。
- 通常表示・補完・検索cacheから完全削除本文を除く挙動。

## 6. GitHub反映の作業境界

本書作成時はGitHub APIとHTTPSへの接続がtimeoutしたため、Issue本文はまだ再配分していない。
復旧後、最新本文・コメントを再取得して上の担当節を転記/リンクし、
#381にはモデル決定と各Issueへの索引を残す。旧全文は履歴として退避し、決定を消さない。
#385の題名はBlock編集・参照項目反映へ更新する候補とする。
state/label/assignee/Project Statusを勝手に変更せず、振り分けだけでclose/依存解除しない。
依存は既存の #384←#381/#382/#383、#385←#383/#384を基準に、最新状態を照合する。
