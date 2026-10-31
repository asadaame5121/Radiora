# Radiora v3 C4アーキテクチャ図

整理日: 2026-10-31。ユーザー採用済みの**目標構成**を図示する。 現在はCargo
workspace/依存と品質gateの入口までで、図の製品機能は未接続。
設計契約は[v3 architecture](v3-architecture.md)、製品仕様は[v3決定事項](v3-model-decisions.md)。
C4のContext / Container / ComponentをMermaid flowchartで表現し、保存のDynamic viewを添える。
Containerは実行・保存の単位、Componentはその内部責務。crateとprocessを同一視しない。

## C1：System Context

```mermaid
flowchart LR
  User["Person: 利用者"]
  App["Software System: Radiora v3<br/>Topic / Block編集・検索・Relation・縦Tree"]
  Importer["Software System: Legacy Importer<br/>原本を保全して別workspaceへ変換"]
  Legacy[("v2原本DB / 関連asset<br/>読取り専用")]
  Peer["External System: 別端末のRadiora<br/>将来: iroh共有"]
  PDS["External System: atproto PDS<br/>将来: 暗号化backup保管"]
  User -->|"編集・閲覧・保存・復元"| App
  User -->|"dry-run・診断・明示導入"| Importer
  Importer -->|"読む"| Legacy
  Importer -->|"変換済みworkspace / 診断を引き渡す"| App
  App -.->|"移植後: Loro差分 / asset"| Peer
  App -.->|"移植後: 端末側暗号化backup"| PDS
  classDef future fill:#f3f4f6,stroke:#777,stroke-dasharray:5 5
  class Peer,PDS future
```

iroh/PDSは初回対象外。図は同期時の認可・Undo・削除やPDSの鍵管理/保持を確定しない。
Importerは通常UIのwriterとは別の導入工程で、原本変更/in-place/dual-writeを行わない。

## C2：Container

```mermaid
flowchart TB
  User["利用者"]
  subgraph Radiora["Software System: Radiora v3 / 一台の端末"]
    UI["Container: Frontend / WebView<br/>Svelte 5 View + Controller + Workspace<br/>未保存draft・IME・caret・選択を所有"]
    Host["Container: Desktop backend / Rust + Tauri 2<br/>core + infraを組立<br/>workspace単一writer・共通Undo"]
    DB[("Container: workspace SQLite<br/>Loro snapshot / updates<br/>独立UI設定・再生成可能な派生情報")]
    Files[("Container: ローカルファイル<br/>version付きnative backup / 関連asset")]
    UI -->|"Tauri invoke: command / query"| Host
    Host -->|"保存済み版の結果 / version付き通知"| UI
    Host -->|"耐久化・再起動読出し"| DB
    Host -->|"出力・検証・空DBへの復元"| Files
  end
  Importer["Legacy Importer"]
  Native["将来の置換host: Slint / GPUI<br/>core + infraを再利用"]
  Peer["将来の別端末"]
  PDS["将来のPDS"]
  User --> UI
  Importer -->|"通常writerと同時に書かず別DBへ変換"| DB
  Native -.->|"Tauri/WebViewの置換案"| Host
  Host -.->|"iroh transport adapter"| Peer
  Host -.->|"remote backup adapter"| PDS
  classDef future fill:#f3f4f6,stroke:#777,stroke-dasharray:5 5
  class Native,Peer,PDS future
```

backendはdesktop hostと同一processを基本とし、WebViewのprocess構成はruntimeに従う。
UI/backend間はTauri IPCであり、独立HTTP serverを追加する設計ではない。 native hostは現在のTauri
hostへ通信する追加クライアントではなく、その置換先を示す。
LoroDocはbackend内の文書モデル、SQLiteのsnapshot/updatesが耐久表現。独立した二つの文書正本を作らない。
fold/カード開閉はSQLiteのUI設定。文書Loro・共通Undo・将来の文書同期から分離する。

## C3：Desktop backendのComponent

```mermaid
flowchart TB
  UI["Frontend Controller / Workspace"]
  subgraph Backend["Container: Desktop backend"]
    subgraph Desktop["radiora-desktop"]
      Bind["Tauri binding<br/>信頼境界のvalidation / DTO / version付き応答・通知"]
      Root["Composition root<br/>起動・終了・組立のみ"]
    end
    subgraph Core["radiora-core"]
      App["Application coordinator<br/>単一writer・要求/版・保存/公開protocol"]
      Pure["Pure rules / planners<br/>状態 + command + 明示ID/時刻 → 計画/error"]
      Graph["Pure projection<br/>Block→Topic / SCC / Knot / 世代"]
      Ports["Feature-specific ports<br/>文書保存 / committed query / 設定 / backup"]
    end
    subgraph Infra["radiora-infra"]
      Storage["文書adapter<br/>LoroDoc + 共通Undo + SQLite耐久化の協調"]
      Read["Committed read model / 索引<br/>再生成・版管理・削除情報の失効"]
      Settings["SQLite UI設定adapter"]
      Backup["File / native backup adapter"]
      IDs["ID / clock adapter<br/>値をcoreへ渡す"]
    end
    UI --> Bind
    Bind --> App
    App --> Pure
    App --> Graph
    App --> Ports
    Storage -.->|"implements"| Ports
    Read -.->|"implements"| Ports
    Settings -.->|"implements"| Ports
    Backup -.->|"implements"| Ports
    IDs -->|"明示的な値"| App
    Storage -->|"耐久化成功後に更新・公開"| Read
    Root -->|"組立"| Bind
    Root -->|"注入"| App
    Root -->|"生成 / 寿命管理"| Storage
    Root -->|"生成 / 寿命管理"| Settings
    Root -->|"生成 / 寿命管理"| Backup
  end
  DB[("SQLite")]
  Files[("Backup / asset")]
  Storage --> DB
  Settings --> DB
  Backup --> Files
```

実線は利用/データ受渡し、implements線はinterfaceの実装関係。
portはcore側が定義し、実装への呼出しは注入したportを通る。Loro/SQL/Tauri型をcoreの公開契約へ漏らさない。
索引の保存形態/更新方式と通知protocolは実装時の残件。図は索引の独立正本化やwriter増設を要求しない。
Loro適用・export・耐久化・Undo・purge barrierを汎用CRUDの独立transactionへ分解しない。

## FrontendのComponentと交換箇所

```mermaid
flowchart LR
  Workspace["ScreenNavigation Workspace<br/>画面を跨ぐprepare / guard / commit"]
  Controller["Feature Controller<br/>draft・要求世代・選択・公開操作"]
  View["Svelte View<br/>Outline / Topicカード"]
  Flow["描画adapter: Svelte Flow"]
  Layout["配置adapter: DOM計測 + ELK<br/>寸法版・filter key・要求世代"]
  RPC["Tauri client adapter"]
  Core["Backend application interface"]
  Workspace --> Controller
  View -->|"利用者操作"| Controller
  Controller -->|"読み取り値 / callback"| View
  Controller --> RPC
  RPC --> Core
  View --> Flow
  Controller -->|"保存済み投影"| Layout
  Layout -->|"最新要求だけ位置を公開"| Flow
```

layoutへ渡すのは論理IDと投影/寸法で、座標やSvelte Flow Nodeを文書正本にしない。
Slint/GPUIへの移行ではView、editor、IME/caret、UI adapter、layout接続の再実装・実機検証が必要。
core/infra再利用はUIを無変更で交換できる保証ではない。

## Dynamic view：編集・耐久化・公開とpurge

```mermaid
sequenceDiagram
  participant U as Controller / Workspace
  participant A as Application writer
  participant P as Pure planner
  participant I as Loro + Undo / SQLite adapter
  participant Q as Committed read model
  U->>A: command + identity / expected version
  Note over U,A: purgeはbarrier開始後に専用権限でdraft flush・対象集合確認
  A->>P: 整合した読取り状態・操作・明示ID/時刻
  P-->>A: 計画 / domain error
  A->>I: 計画を適用し差分を耐久化
  alt 保存失敗
    I-->>A: dirty / 失敗phase
    A-->>U: 失敗・draft保持・retry/復旧導線
    Note over A,I: 適用済みなら再適用せず保存だけretry。未耐久化の成功公開なし
  else 耐久化成功
    I-->>A: durable version
    opt purge
      A->>I: 共通Undo / Redoをclear
      I-->>A: clear完了
      Note over A,I: 完了前は成功表示・通常操作再開を禁止
    end
    A->>Q: 保存済み版へ更新・索引失効を整合
    Q-->>A: 公開可能な版
    A-->>U: committed result / version付き通知
  end
```

異常時の正確な権限/禁止は[purge契約](purge-undo-contract.md)を優先する。 SQLite
commit後・応答前、およびdurable後・clear前のcrashを[V01/V12・A01](v3-verification-plan.md)で検査する。
図はLoroメモリとSQLiteを一つのACID transactionにできるという意味ではない。 command
identity/dedup、read model更新失敗、購読再接続、thread/実行方式の具体型は保存sliceで固める。

## 検証・運用への接続

| 対象                         | 確認方法                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Pure core / graph            | proptest、独立oracle、固定反例：V02〜V09/V11/V12                                            |
| Application protocol / infra | 状態機械PBT・実Loro/SQLite障害/再起動・Alloy：V01/V11/V12、A01/A02                          |
| View / Controller / layout   | fast-check/Vitest/mock E2E、実Tauri/IME：U/N/R・E01〜E08                                    |
| Backup / Importer            | 空DB往復・非破壊拒否・原本保全：V13/V15。全v2写像は#384待ち                                 |
| 開発・CI                     | mise run verify、普段は mise run test --staged。[品質gate](v3-quality-gates.md)Q1〜Q5は後続 |

C4は責務と接続の設計を示す。未実装のport/型を図に合わせて一度に雛形生成せず、
#383保存中核→#384対象変換fixture→#385編集/参照/再起動の縦断sliceで必要な実装を増やす。 既存v2
C4・Alloy/PoCの検証記録は履歴として保持し、v3製品の完成証拠と混同しない。
