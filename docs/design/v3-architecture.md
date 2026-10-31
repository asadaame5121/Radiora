# v3 アーキテクチャ：関数型coreとports/adapters

決定日: 2026-10-30。状態: ユーザー承認済みの設計方針。図は目標構成であり、実装済みではない。
製品契約は[v3決定事項](v3-model-decisions.md)、検証・依存の残件は[実装前一覧](v3-preimplementation-decisions.md)。
既存の[v2 C4](c4-system-landscape.md)は履歴として保持する。
2026-10-31に[C4図の正本](v3-c4-architecture.md)を整理した。検証・依存・品質gateの決定も同図へ接続している。

## 1. 採用する境界と理由

Rustのcore、infra、desktopを分離するヘキサゴナル構成とする。
coreの判断・計算を純粋関数に寄せ、I/Oを扱うapplication coordinatorとadapterで実行する。
UI/runtime/保存方式の変更理由を分け、同じ公開操作をheadless testから呼べることを目的とする。
全関数のtrait化、汎用effect DSL、event sourcing、plugin基盤は導入しない。

| 配置予定        | 責務                                                                                                  | 依存                                           |
| --------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| radiora-core    | 文書規則、commandの検証/計画、Relation投影、純粋な状態遷移、application coordinator、必要なportの契約 | Tauri/Svelte/Loro/SQL型を公開しない            |
| radiora-infra   | Loro・共通Undo・SQLite耐久化・ファイル・設定・派生索引のadapter                                       | coreへ依存                                     |
| radiora-desktop | Tauri invoke/通知、起動終了、adapterの組立                                                            | coreとinfraへ依存。Loro/SQLiteへ直接依存しない |
| Frontend        | Svelte View、feature Controller、Workspace、draft/IME/focus、Svelte Flow/ELK接続                      | desktopのDTO境界                               |

crate名とCargo workspaceは[製品Rust依存](v3-rust-dependencies.md)へ反映した。lib
targetのみを置き、製品機能やTauri起動はまだ未接続。
portは実際のI/O・交換・障害注入の境界に限定し、包括的なCRUD storeを作らない。
portの定義は利用するcore側が所有する。composition rootへdomain logicを置かない。

## 2. 関数型coreの契約

- 純粋な判断は「必要な読取り状態＋command＋明示的な時刻/発行ID」から、成功計画またはdomain
  errorを返す。
  関数内で時計、乱数、DB、通知を呼ばない。文書全体のcloneを要求せず、操作に必要な整合した読取り範囲を渡す。
- plannerはIDを含む意味的な変更計画を返し、Loro操作への変換・適用はinfraが行う。
  計画は二つ目の永続正本や独自CRDTではない。
- application coordinatorがwriter権限、版の検証、計画、適用、耐久化、公開を調停する。
  計画時と適用時の間に状態が変わる場合は版を検証し、古い計画を適用しない。
- Workspaceの編集writerは一つ。Loro適用・履歴・export・SQLite保存・purge
  barrierは一つの協調契約で扱う。 独立したCRUD adapterへ分割して、原子性があるように見せない。
- 耐久化前の成功公開を禁止する。適用後の保存失敗ではdirtyを保持し、契約に応じて後続操作を止め、retry/復旧する。
  UI要求が失効しても、完了したDB書込みを巻き戻さない。
- queryは保存済みの版を返す。索引とread modelは再生成可能で、対応する版を識別する。 command
  ID・版・失敗/再送時の結果照会の具体形式は保存sliceで確定する。
- graph出力は論理Block/Topic/Relation IDを使い、Svelte Flow Nodeや画面座標を含めない。
  DOM計測、ELK実行、描画型への変換はpresentation側のadapterが担当する。
- 未保存入力、caret/focus、pane、一時展開はpresentationのownerを維持する。 fold/カード開閉はSQLite
  UI設定として文書・共通Undo・将来の文書同期と分ける。

## 3. C4アーキテクチャ図

図の正本は[Radiora v3 C4](v3-c4-architecture.md)へ集約する。 System
Context、Container、backend/Frontend Component、編集→耐久化→公開とpurgeのDynamic viewを掲載する。
設計と実装状態、単一process内の責務とcrate依存、将来の置換/外部接続を区別する。
各図のport・型を一括生成するのではなく、公開interfaceの縦断sliceで実装・検証する。

## 4. infraも検査できる設計

検査対象はinfra内部のライブラリ実装全体ではなく、保存・公開・再試行・終了のprotocolとする。
phase、要求ID/版、dirty、durable、履歴clear、公開可否を明示し、I/O完了を状態機械への入力として扱う。
失敗・応答喪失・順序逆転・crashを非決定的な環境動作としてモデル化できる境界を保つ。

| 層                       | 検証方法                                                                  |
| ------------------------ | ------------------------------------------------------------------------- |
| pure domain/planner      | 独立oracle・不変条件・往復性のPBT、固定fixture                            |
| application/保存protocol | 純粋な状態機械とfault adapterによるcommand列PBT。有界モデル検査の追加候補 |
| 実adapter                | 実Loro/SQLiteで同じ操作列、障害注入、再起動後状態を照合                   |
| presentation/native      | mock応答順列、実Backend結合、実Tauri/IME/E2E                              |

モデルと実装の対応表を残し、抽象モデルの合格だけで実adapterの耐久性を証明したとしない。
PBT/E2E・infra
fault/crash・追加Alloyの責任と対象は[検証対応計画](v3-verification-plan.md)で決定した。
具体runner・fault hook・モデルの実装と実行合格はこれからである。

## 5. 移植後のirohとPDS

ユーザーの将来案として保持し、v2→v3移植が一段落するまで実装・依存追加しない。
初回scopeへ追加しない。今は外部入力/出力をapplication境界へ接続できる構造を保つだけとする。

### iroh：端末間データ共有

[iroh](https://docs.rs/crate/iroh/latest)は認証・暗号化されたP2P接続とrelay fallbackを提供する。
[protocol構成](https://www.iroh.computer/proto)を使い、将来の通信adapterとしてLoro差分やassetを運べる。
接続相手のEndpointIdの確認と、workspaceへの参加許可は別である。
iroh-docs等を追加の文書正本にせず、mergeの意味はLoroとRadioraの契約が所有する。

remote差分もローカルwriterを通し、validation・耐久化・索引更新・公開の順序を守る。
ネットワークtaskからLoroを直接変更しない。外部変更を純粋plannerで再生成するのではなく、 CRDT
import後の状態・操作由来・不変条件の検証方法を別途設計する。 後続でworkspace
identity、端末認可/失効、同期対象、再送/重複/欠落、schema互換、 remote変更とlocal
Undo、offline端末によるpurge済み情報の再導入を決める。
初回のlocal共通Undoとpurge契約を、複数端末にも自動的に成立すると扱わない。

### atproto PDS：バックアップ保存先

F13の完全native backupを生成・検証した後、暗号化してremote backup adapterへ渡す。
PDSのrecord構造を文書モデルにせず、live同期とも分ける。
[repository仕様](https://atproto.com/specs/repository)は公開データを前提とするため、
利用者の文書を保護するbackupは端末側で暗号化し、公開metadataにも本文/タイトル等を含めない。

[blob仕様](https://atproto.com/specs/blob)ではuploadだけでは永続参照にならず、
recordからの参照・削除・GCが保持に関わる。提供PDSの容量/size制限・retentionも確認が必要。
暗号鍵の保存/回復、暗号化形式とversion、分割/manifest、upload中断、
backup世代の確定/保持/削除、download後の完全性検証と空DB復元を後続で策定する。 PDSのrepository
exportだけで全backup blobも回収できると仮定しない。
PDS単独を唯一の保管先にするかどうかも、復旧検証前に決めない。

## 6. 交換費用と残る決定

| 変更                      | 再利用できるもの                          | 作り直し・検証が必要なもの                                           |
| ------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| Svelte/Tauri → Slint/GPUI | core、保存adapter、論理DTO/command契約    | View/Controller接続、editor、IME/caret、計測/layout接続、OS連携・E2E |
| irohによる共有            | local文書モデル、保存protocol、ID、Loro   | 同期/認可/互換/Undo/削除契約と障害試験                               |
| PDS backup                | native backup/restore、version/完全性検証 | 暗号化/鍵管理、remote blob/record lifecycle、復旧試験                |
| Loroの交換                | domain契約の一部、論理ID、受入fixture     | CRDT/履歴/purge/差分形式、永続データmigration。費用は大きい          |

D4の残件はwriter/SQLiteのthreadと実行方式、portの具体型、DTO/version/error、
通知購読/再接続、索引版管理、Importerとの共有範囲の具体化と製品接続。初期Cargo構成は作成済みで、これらを保存sliceと検証fixtureへ接続する。
