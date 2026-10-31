# v3 実装前の決定事項・未決事項

整理日: 2026-10-30。状態: 判断一覧。以下の「候補」「推奨」「未決」は採用済み・実装済みではない。
ユーザー指定の5領域を、既存決定の再検討と混同しないために整理する。
製品仕様は[v3決定事項](v3-model-decisions.md)、詳細は[名前契約](v3-naming-and-search-contract.md)と
[初回F01〜F16](v3-first-release-scope.md)。試験・製品機能・CI・Alloyの実装完了とは区別する。

2026-10-31追補:
D1の対応表・PBT/E2E分担とD5の追加対象は[検証対応計画](v3-verification-plan.md)で決定した。
本書の候補一覧より同計画の判断を優先する。試験実装・合格は別途追跡する。 2026-10-31依存追補:
[製品Rust依存](v3-rust-dependencies.md)に基づき、root workspaceと3
crateのCargo.toml/Cargo.lockを作成した。テスト用途に限定しない。

## 1. 既に決定した前提

| 領域            | 固定して使う決定                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| runtime/保存    | Tauri 2＋Svelte 5。文書/Block/Relationの正本はBackend単一LoroDoc。SQLiteへsnapshot＋差分を耐久化                 |
| 正本とUI        | 未保存draft/選択/focusはFrontend。fold/カード開閉は独立したSQLite UI設定。保存済み版だけを公開                   |
| 操作と同一性    | UUIDv7論理ID、移動/復元で維持、複製は新ID。通常削除/ゴミ箱復元と完全削除を分離                                   |
| Undo            | Backendのworkspace共通履歴。入力/IME/複合操作の区切り、再起動で終了、purge耐久化後に履歴clear                    |
| RelationとTree  | Block endpointを保持しTopicへ投影。filter前の世代/SCC、Topic投影循環をKnotへ。Svelte Flow予定、ELK配置が第一候補 |
| 名前と初回scope | 別名は実体Block、固有見出しは参照項目。検索/補完の到達IDとF01〜F16の初回必須/後続は策定済み                      |
| 移行保護        | 旧DBを保全、別DBへ変換、dual-writeしない。保留情報も読出し/export/backup復元を保証。全写像は#384で未決           |

ライブラリのversion/featureや実行方式は、この表だけでは確定しない。
アーキテクチャは[関数型core＋ports/adapters](v3-architecture.md)を採用し、v3 C4を作成した。
製品moduleの具体型・実行/通信境界・障害時の実装詳細は引き続き未確定。

## 2. 実装前に決める5領域

| ID | 決める対象                | 既存資産・確認できた状態                                                                                                                                    | 残る決定と成果物                                                                                                 |
| -- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| D1 | テスト戦略：仕様→PBT・E2E | [検証対応計画](v3-verification-plan.md)でV01〜V16、独立oracle、PBT再現/初期予算、E01〜E08と層別責任を決定。Rustはproptest採用                               | native driver、製品test/fixtureの実装、F表への実行証拠                                                           |
| D2 | 採用ライブラリとCargo構成 | [製品Rust依存](v3-rust-dependencies.md)でcore/infra/desktop全体の直接依存/featureを選定し、manifest/lockを作成。Rust PBTはproptest                          | native E2E driver、MSRV実機/他OS、transitive license/脆弱性、frontend依存と製品接続                              |
| D3 | 品質ガードレール          | [品質ゲート計画](v3-quality-gates.md)で方針を採用。互換mise task/workspace lintに加え、Q1のtool版/lock・Windows/Linux Rust CI・全workflow検査をローカル実装 | GitHub runner実行、Biome formatter移行、cargo-deny/境界規則/Rust行数gate、required集約と追加基線の接続・実行証拠 |
| D4 | アーキテクチャとC4        | Rust core/infra/desktop、pure planner＋application coordinator、port所有を採用。[v3 C4](v3-architecture.md)を作成                                           | writer/DB実行単位、port/DTO/version/通知、UI設定/索引/Importerの具体的な接続                                     |
| D5 | 追加モデル検査            | [検証対応計画](v3-verification-plan.md)でA01共通Undo/保存、A02削除集合、A03既存差分監査を決定                                                               | 具体モデル・scope/witness/反例対照と実行記録、Rust/PBTへの接続                                                   |

D2でPoC用manifestを製品の確定依存一覧として扱わない。
syncularのPoCが存在することは、初回対象外の端末同期を採用する根拠ではない。

## 3. D1：PBTへ落とす仕様の一覧

以下はテスト化する候補の対応表。実装の関数をそのままテスト側へコピーせず、
単純な参照モデル・独立した性質・固定の具体例を併用する。
現実装と同じ誤解をoracleへ埋め込まないため、生成する操作と期待結果の根拠を契約へリンクする。

| 仕様         | 性質・oracle候補                                                                                      | 主な生成/操作列                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 構造/ID/境界 | 各live Blockの所属root一意、ID非再利用、通常indentで境界を越えない、移動/切り出し後も参照同一性       | 複数root/深い木、移動/並替/切り出し/複製、無効操作                       |
| 削除/参照    | 削除時の対象集合だけを復元/purge、既削除子を復活させない、外部参照非連鎖、Missing後も自動再接続しない | 子削除→親削除→各復元/purge、代表と参照項目、兄弟/親の消失                |
| Relation投影 | 元edge不変、Topic所属を正しく投影、カード内循環と投影循環を区別、filterで世代/SCC不変                 | 自己loop/複数SCC/diamond/多重edge、通常Blockと参照項目、移動/型設定/撤回 |
| 名前/検索    | 原文/UUID不変、同一ID結果重複なし、別名/見出しで契約上のIDへ到達、削除本文の非露出                    | 同名/Unicode/Markdown/空名、名前変更・移動・削除・復元                   |
| 共通Undo     | 一操作の往復で本文/構造/ID/順序を復元、別paneを跨ぐ順序、autosaveと区切りの独立、再起動で空履歴       | 複合command、入力/IME確定/時刻境界、pane/caret切替、Undo後新入力         |
| 保存と公開   | 耐久化前に成功公開しない、失敗時dirty/draft保持、retryで二重適用しない、purge後clear順序              | export/SQLite失敗、応答喪失/再送、保存→clear間の終了、集約途中失敗       |
| 非同期UI     | 最新要求だけを公開、旧成功/error/finallyが最新stateを変更しない、dispose後公開なし                    | API/layout/保存の応答順列、filter/入力/画面変更、timer/observer終了      |
| 設定/backup  | foldと一時展開が独立、再起動保持、native backupを空DBへ戻して情報一致                                 | pane間設定、設定保存失敗、export/restore、未知version/破損               |

再現規約・初期試行予算・失敗/skipの扱いは[検証対応計画](v3-verification-plan.md#3-pbtの実装契約)で決定した。
runnerごとの実装とCI接続は残る。
任意の状態へ丸ごと復元するoracleで、UUID発行履歴やUndo後のRedo失効まで消してはいけない。

### E2Eの拡張で決める境界

1. mock UI：keyboard/focus/選択、応答逆順・保存失敗・layout遅延。既存資産を再利用する。
2. 実Backend結合：本物のLoro/SQLite/command/DTOを通す保存・再起動・参照反映・backup。
3. 実Tauri：配布に近いWebView、invoke、IME/caret、Worker asset/CSP、OS file dialog、終了/再起動。
4. 配布受入：実ディスクのcrash/retry、空DB復元、対象端末の規模性能。

2〜4のrunner/driver、OS対応、GUI操作と障害注入の接続、CIで再現可能な範囲はD4/D2と照合して決める。
ブラウザのmock E2E成功を実Tauri/永続化の合格へ読み替えない。native
IMEには手動実機受入が必要かも判断する。
優先する縦断シナリオは「編集→参照反映→保存→再起動」「移動→検索/Relation→Undo」
「削除/復元/purge」「backup→空DB」「古い応答」「IME中のカード高さ変更」とする。

## 4. D2〜D4：技術選定の論点

| 論点            | 既存決定・候補                                                                  | 未決部分                                                                            |
| --------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Rust保存        | PoCでloro =1.16.2、rusqlite =0.32.1 bundled                                     | 製品版の採用version/features、接続/実行単位・耐久性・集約・schema migration         |
| Rust基盤        | Tauri 2予定。PoCにtracing-subscriber/tempfile                                   | serde/error/logging/UUID/async実行の必要依存、MSRV、build/dev分離                   |
| graph           | coreでpetgraphを採用（std/stable_graph）                                        | 反復Tarjan契約の移植、深いgraphのstack耐性、domain IDと内部index分離をV09で確認     |
| frontend        | Svelte Flow予定・ELK第一候補。既存OverType/Valibot/fast-check/Vitest/Playwright | 解決版/lock/asset/CSP・配布license、RustのPBT runner候補、実Tauri E2E driver        |
| 正本と通信      | 文書Loro、UI設定SQLite、draftはController                                       | command/DTO/version/error、writer queueとquery、read model公開/通知、再接続/dispose |
| 派生索引        | 名前/検索/逆参照は再生成可能                                                    | 保存先/再構築/版管理、更新とquery整合、fold設定とは別の障害回復                     |
| module/Importer | feature固有port、外部I/O adapter、独立Legacy Importer                           | 製品crate/module境界・composition、Importerとの共用範囲/配布境界                    |

この表は依存追加の指示ではない。候補版はPoC/過去調査の記録であり、製品選定時に一次資料と解決版を再確認する。
製品Cargoの初期構成は[製品Rust依存](v3-rust-dependencies.md)へ反映した。writer実行方式/DTO・native
driverの残件を移植時に具体化する。

D3では少なくとも既存の型安全・runtime
validation・原因保持・Promise処理・状態所有・scope制限を維持する。 Rust
fmt/Clippy/test、静的解析・依存/権限・workflow検査、基線/例外の扱いは[品質ゲート計画](v3-quality-gates.md)で決定した。
現在のmise入口は既存Deno gateを維持する移行形であり、CIや全Frontend formatterの切替完了ではない。

### 決定後のC4

既存の[C4](c4-system-landscape.md)はv2の履歴として保持する。
[v3アーキテクチャ/C4](v3-architecture.md)へContext/Container/Componentと保存の動的図を記録した。
図は採用した目標構成。writer/DB実行方式などの未決や未実装を、図だけで実装済みとしない。

## 5. D5：追加モデル検査の候補と優先度

| 候補                                        | 理由                                                                             | 推奨する検証の分担（未採用）                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 共通Undo＋purge barrier＋新しい削除対象集合 | 旧モデルは複数session履歴。共通manager・独立ゴミ箱集合・再起動終了への追従が必要 | 最初に既存モデルとの差分監査。必要部分だけAlloy追補＋Rust状態機械PBT/障害fixture  |
| Block→Topic Relation投影                    | 同一Topic内関係とTopic投影上の循環、filter不変の契約が追加された                 | 小scope Alloyの要否を評価し、主に独立SCC oracleとのgraph PBT                      |
| 非同期公開と保存順序                        | 旧成功/finally・応答喪失・durable前公開は重大な不整合を作る                      | 純粋な要求状態機械PBT＋実Backend障害試験。Alloy追加は抽象化の効果がある箇所だけ   |
| 名前/参照・コピー                           | 新しい別名/固有見出しの所有と参照項目IDが増えた                                  | property/固定fixture中心。Unicode/Markdownを無理にAlloy文字列モデルへ押し込まない |

Alloyの既存文書モデル/legacyは30 command（12 witness、15正条件、3 negative
control）の有界検査記録がある。
purge検査にも別の有界記録がある。単純合算して最新仕様全体の検証済み件数にしない。 共通Undoの実Loro
fixture 13件は製品UI・crash・規模・新契約のモデル検査の代わりではない。
scope、仮定、witness、negative control、model hash/固定commit、実装への引継ぎを新旧別に残す。
v2変換のモデル追加は#384の仕様確定後に別途判断する。

coreの判断を純粋関数へ寄せ、infraとのやり取りもphase/版/dirty/durable/公開可否を持つ
状態遷移として検査できる境界にする方針は採用した。対象は保存protocolであり、
Loro/SQLite/OS内部の全挙動の形式的証明ではない。追加モデルとfault/crash対応は[検証対応計画](v3-verification-plan.md)へ具体化した。実装・実行はこれからである。

## 6. 決める順序と終了条件

1. D4の残るmodule/実行/通信/障害境界と、D1の検証したい公開契約を一緒に固定する。
2. D1/D5の[検証対応計画](v3-verification-plan.md)を具体runner・モデル・fixtureへ接続する。
3. D2で必要依存だけを選び、製品Cargo.toml/Cargo.lock・frontend依存へ反映する。
4. D3で選んだ構成を強制するgateを決め、CI/ローカル検証へ実装する。
5. 決定したD4をv3 C4へ描き、最初の縦断sliceと検証fixtureに接続する。

各Dを「判断・理由・代替・影響契約・検証・後から変える費用・担当工程」で記録する。
既決の単一Doc/共通Undo/Relation等を再選択する工程にしない。全周辺機能の実装を先行条件にもしない。
終了は決定一覧/C4/依存/gate/仕様→検証対応が整合し、必要な未検証点が明示された状態。
仕様決定、試験基盤の実装、試験合格、製品の完成を分けて追跡する。
