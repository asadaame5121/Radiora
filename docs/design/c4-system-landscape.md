---
title: Radiora v2 アーキテクチャ全景（C4モデル）
date: 2026-09-17
status: accepted
tags:
  - radiora
  - architecture
  - c4-model
  - design
---

# Radiora v2 アーキテクチャ全景（C4モデル）

本書は、本文主体のアウトライナー **Radiora v2**
の現時点におけるアーキテクチャ全景を、**C4モデル（Context, Container, Component, Code）**
に基づいて可視化・整理したドキュメントです。

---

## 1. システム概要と基本思想

Radiora
は、日々生じる短い着想から長文の稿までを「思索（Work）」として記録し、その仮配置、意味関係、改稿、派生、異本を追跡する**完全ローカル・オフライン動作の思考・執筆環境**です。

### 主要な設計原則

1. **実身（Work）と化身（Occurrence）の分離**:
   同一の思索を複数のアウトライン文脈に複製せず配置可能。
2. **改稿は破壊ではなく分岐（DAG構造）**:
   過去の版（Revision）は不変。別稿（Branch）や複数親の混成稿（Merge）として追跡。
3. **関係を早く決めすぎない**: 暫定的な階層配置と、断定的な型付き意味リンク（`FROM`, `SUPPORT`,
   `VS`, `PART_OF` 等）を分離。
4. **日付・歴史年代は座標**:
   日付ノードを思索の親に強制せず、時間軸・カレンダー座標（HistoricalTime）として扱う。
5. **完全ローカル第一（Local-First）**:
   外部クラウドやネットワークに依存せず、すべてのデータと計算をローカル完結。

---

## 2. Level 1: System Context（システムコンテキスト＆全景）

利用者を起点とし、Radiora Desktop
システムと外部エコシステム（ファイルシステム、連携ツール、OS環境）との境界および関係性を表します。

```mermaid
flowchart TD
    User["思索者 / 著者<br>(Thinker / Writer)<br>[Person]<br>着想の記録、階層構成、意味リンク付与、版管理、長文執筆"]

    subgraph RadioraBoundary ["Radiora System Boundary"]
        RadioraApp["Radiora Desktop Application<br>[Software System]<br>Deno Desktop + Svelte 5 + SQLite による<br>完全ローカル・思索アウトライナー"]
    end

    subgraph LocalStorage ["ローカルストレージ・OS環境"]
        LocalFS["ローカルファイルシステム<br>[Local OS]<br>SQLite DB, 起動キャッシュ, 診断ログ, コールドバックアップ"]
        OSPlatform["デスクトップ環境<br>(Windows / Linux)<br>[Operating System]<br>ウィンドウ管理, 入力イベント, 自動更新, MSIX"]
    end

    subgraph ExternalEcosystem ["外部エコシステム・データ交換"]
        Obsidian["Obsidian / 外部PKM<br>[External Tool]<br>WikiLink形式 ([[...]]) のMarkdown原稿受領"]
        OpmlOutliners["OPML対応アウトライナー<br>(Dynalist / Workflowy 等)<br>[External Tool]<br>階層構造・項目のインポート / エクスポート"]
        TextEditors["外部テキスト・Markdownエディタ<br>[External Tool]<br>ポータブルMarkdown原稿の閲覧・組版"]
        LegacySurreal["レガシー SurrealDB (v0)<br>[Legacy Store]<br>旧形式データ（スタンドアロン移行ツールで移行）"]
    end

    User -->|"思索の入力、整理、リンク編集、系統樹閲覧"| RadioraApp
    RadioraApp -->|"データ永続化 (ACID), キャッシュ保存, ログ出力"| LocalFS
    RadioraApp -->|"ネイティブUI表示, 自動アップデート, ウィンドウ制御"| OSPlatform
    RadioraApp -->|"Markdownエクスポート (WikiLink形式)"| Obsidian
    RadioraApp -->|"OPML相互変換 (インポート/エクスポート)"| OpmlOutliners
    RadioraApp -->|"標準Markdown / 原稿エクスポート"| TextEditors
    LegacySurreal -.->|"スタンドアロン移行ツール (storage:migrate:legacy)"| LocalFS
```

### システムコンテキストの構成要素

- **思索者 / 著者 (User)**: 日常のメモから論文・書籍の構成までを扱うエンドユーザー。
- **Radiora Desktop Application**:
  思索の階層化、DAG版管理、グラフ関係性計算、歴史年代軸可視化を担う中核システム。
- **ローカルファイルシステム**: `%LOCALAPPDATA%\RadioraV2` 配下の SQLite
  データベース、起動キャッシュ、診断ログ。
- **外部エコシステム**: 組版や共同編集は抱え込まず、Markdown（Radiora形式 / ポータブル形式 /
  Obsidian形式）や OPML で外部ツールと連携。

---

## 3. Level 2: Container（コンテナ図）

Radiora Desktop
アプリケーションを構成する実行単位（プロセス、ランタイム、ストレージ、通信境界）を示します。

```mermaid
flowchart TB
    User["思索者 / 著者<br>[Person]"]

    subgraph RadioraAppContainer ["Radiora Desktop Application (Runtime Boundary)"]
        subgraph FrontendUI ["フロントエンド・コンテナ (WebView / Chromium)"]
            SPA["Svelte 5 Single Page Application<br>[Container: Svelte 5, Runes, TypeScript]<br>仮想化アウトライン, ライブエディタ, 系統樹, インスペクタ"]
            RpcAdapter["RPC Transport Adapter<br>[Component: TypeScript Proxy]<br>型付けされた RadioraBindings のプロキシ呼び出し"]
            SPA --> RpcAdapter
        end

        subgraph BackendHost ["バックエンド・コンテナ (Deno Desktop Runtime)"]
            HttpServer["ローカル HTTP / RPC サーバ<br>[Container: Deno.serve]<br>静的アセット配信, /api/rpc/* エンドポイント"]
            BindingHandlers["RPC Binding Handlers<br>[Component: register_bindings.ts]<br>リクエストの検証・ディスパッチ"]
            AppServices["Application Services Layer<br>[Component: OutlineService, RevisionService 等]<br>ビジネスロジック, グラフ計算, 整合性維持"]
            DomainCore["Domain Model & Invariants<br>[Component: Work, Occurrence, DAG Revision]<br>実身/化身分離, 不変条件, スキーマ検証"]
            StoreAdapter["Storage Adapters<br>[Component: SqliteGraphStore]<br>トランザクション直列化キュー, SQLマッピング"]

            HttpServer --> BindingHandlers
            BindingHandlers --> AppServices
            AppServices --> DomainCore
            AppServices --> StoreAdapter
        end

        subgraph LocalDataStore ["ローカルデータストア"]
            SqliteDB[("SQLite Database<br>[Container: radiora.db via node:sqlite]<br>思索, 版, 階層配置, 意味リンク, 時間軸")]
            SnapshotCache[("起動キャッシュ<br>[File: startup-snapshot.json]<br>初回起動の高速描画用データ")]
            LogFile[("診断ログ<br>[File: startup.log]<br>JSONL形式の構造化実行ログ")]
        end
    end

    User -->|"操作 (キーボード / マウス / ショートカット)"| SPA
    RpcAdapter -->|"HTTP POST (JSON-RPC) /api/rpc/*"| HttpServer
    StoreAdapter -->|"Direct In-Process SQL (ACID Transaction)"| SqliteDB
    AppServices -->|"起動時高速ロード / 終了時保存"| SnapshotCache
    BackendHost -->|"構造化ログ出力"| LogFile
```

### コンテナ間の通信・結合特性

- **Frontend $\leftrightarrow$ Backend**: Deno の組み込み `Deno.serve` を経由したローカル HTTP
  通信。`createRpcAdapter` による TypeScript Proxy
  経由で、完全な型安全性を維持しながら疎結合に通信。
- **Backend $\leftrightarrow$ Database**: Deno 標準の `node:sqlite`
  による同一プロセス内の直接アクセス。`mutationQueue` による Promise
  ベースの直列化でトランザクション競合を排除。
- **起動高速化キャッシュ**: バックエンド起動完了を待つ間、前回セッションの `startup-snapshot.json`
  を先行描画して体感起動速度を極小化。

---

## 4. Level 3: Component（コンポーネント図）

主要コンテナである「Frontend (Svelte 5)」と「Backend (Deno
Desktop)」の内部コンポーネント構成および依存関係です。

### 4.1 Frontend Component Diagram

```mermaid
flowchart TD
    subgraph UIComponents ["UI Views & Shell (src/ui/)"]
        AppShell["App.svelte / AppTopBar.svelte<br>レイアウト統括, モーダル管理, キーボードショートカット"]
        OutlineView["OutlineView / OutlineRowItem<br>階層アウトライン, ドラッグ＆ドロップ, 折りたたみ"]
        EditorView["LongFormEditor / MarkdownEditor<br>OvertypeMarkdownEditorAdapter, 補完ポップアップ"]
        TreeView["PhylogeneticTree / HistoricalTimeline<br>系統樹, 時間軸・世代X軸, 循環Knot隔離表示"]
        InspectorView["InspectorView / Panels<br>概要, 意味リンク, 版履歴, Datalog風クエリ, 重複候補"]
        NavigationUI["PrimaryNavigation / CommandPaletteDialog<br>モード切替, コマンドパレット (Ctrl+K)"]
    end

    subgraph StateControllers ["State Controllers & ViewModels (*.svelte.ts)"]
        WorkCtrl["work_controller.svelte.ts<br>Work作成, 配置, ゴミ箱, 重複統合"]
        EditorCtrl["editor_controller.svelte.ts<br>自動保存, キャレット復帰, 内部参照補完"]
        NavCtrl["navigation_controller.svelte.ts<br>ブラウジング履歴 (進む/戻る), ズーム"]
        LinkCtrl["link_editor_controller.svelte.ts<br>意味リンク編集, 方向性・型検証"]
        EmergenceCtrl["emergence_controller.svelte.ts<br>創発提案 (橋渡し/欠落リンク) 調停"]
        TimelineCtrl["historical_time_controller.svelte.ts<br>歴史年代入力, タイムライン表示"]
        OutlineVM["outline_view_model.ts<br>階層のフラット化, 可視ノード計算"]
        TreeLayout["tree_layout.ts / tree_camera.ts<br>系統樹DAGレイアウト, 座標計算, ズーム"]
    end

    subgraph ClientTransport ["Client Transport (src/ui/rpc_adapter.ts)"]
        RpcProxy["createRpcAdapter<br>RadioraBindings プロキシ"]
    end

    AppShell --> NavigationUI
    AppShell --> OutlineView
    AppShell --> EditorView
    AppShell --> TreeView
    AppShell --> InspectorView

    OutlineView --> OutlineVM
    OutlineView --> WorkCtrl
    EditorView --> EditorCtrl
    TreeView --> TreeLayout
    TreeView --> TimelineCtrl
    InspectorView --> LinkCtrl
    InspectorView --> EmergenceCtrl
    NavigationUI --> NavCtrl

    WorkCtrl --> RpcProxy
    EditorCtrl --> RpcProxy
    NavCtrl --> RpcProxy
    LinkCtrl --> RpcProxy
    EmergenceCtrl --> RpcProxy
    TimelineCtrl --> RpcProxy
```

### 4.2 Backend Component Diagram

```mermaid
flowchart TD
    subgraph TransportLayer ["Desktop & RPC Transport (src/desktop/)"]
        MainEntry["src/main.ts<br>Deno.serve, BrowserWindow, ライフサイクル"]
        RpcDispatch["register_bindings.ts<br>RadioraBindings RPC ディスパッチャ"]
        SnapshotCache["startup_snapshot_cache_file.ts<br>起動スナップショットのJSON入出力"]
        MainEntry --> RpcDispatch
        MainEntry --> SnapshotCache
    end

    subgraph AppServicesLayer ["Application Services (src/services/)"]
        OutlineSvc["OutlineService<br>アウトライン走査, 移動, 子ノード昇格, RuleQuery"]
        RevisionSvc["RevisionService<br>不変Revision生成, 枝分かれ, 混成稿, 差分"]
        BranchSvc["BranchService<br>Branchライフサイクル, 系統投影 (Global / Work)"]
        LinkOps["SemanticLinkOperations / AdvancedLinkResolver<br>意味リンク整合性, 構文解析, 未解決Stub生成"]
        RefSvc["InternalReferenceService<br>内部参照 (radiora://) 解決, バックリンク集計"]
        DupSvc["DuplicateCandidates / WorkMergeService<br>類似度スコア算出, トランザクション統合"]
        EmergenceSvc["EmergenceSuggestionCalculator<br>三角形関係・近傍クラスタ検出, 創発提案"]
        TimeSvc["HistoricalTimeService / DateProjection<br>歴史年代計算, カレンダー変換, 座標投影"]
        PortabilitySvc["MarkdownExport / OpmlService / JsonBackup<br>Markdown/OPML/完全JSONインポート・エクスポート"]
        RecoverySvc["RecoverySnapshotService / WorkingCopyAutosave<br>定期自動スナップショット, クラッシュ復元"]
    end

    subgraph DomainLayer ["Domain Core & Invariants (src/domain/)"]
        DomainModels["models.ts<br>Work, Occurrence, Branch, Revision, Link, Stub"]
        RelationModel["relation_type.ts<br>型定義 (FROM, SUPPORT, VS, PART_OF 等), 対称性"]
        TimeModel["historical_time.ts<br>歴史年代型 (BCE/CE, 不確実性, 精度)"]
        ValidationSchemas["schemas.ts / input_schemas.ts<br>ランタイム検証, 不変条件チェック"]
    end

    subgraph StorageLayer ["Persistence Layer (src/storage/)"]
        StorePort["GraphStore / RelationTypeDefinitionStorePort<br>ストレージ抽象インターフェース"]
        SqliteStore["SqliteGraphStore<br>node:sqlite, トランザクション直列化キュー"]
        SqliteRecords["sqlite_records.ts / sqlite_schema.ts<br>SQLスキーマ, 行マッパー, マイグレーション"]
        MigrationTool["turso_migration.ts / legacy_surreal_exporter.ts<br>SurrealDBからの安全なデータ移行"]
    end

    RpcDispatch --> AppServicesLayer

    OutlineSvc --> DomainModels
    RevisionSvc --> DomainModels
    BranchSvc --> DomainModels
    LinkOps --> RelationModel
    TimeSvc --> TimeModel
    AppServicesLayer --> ValidationSchemas

    AppServicesLayer --> StorePort
    SqliteStore -.->|implements| StorePort
    SqliteStore --> SqliteRecords
    MigrationTool -.-> SqliteStore
```

---

## 5. Level 4: Code & Domain Model（コード・詳細構造）

システムの根幹を支えるドメインエンティティの関連性と、中核設計パターンを示します。

### 5.1 中核エンティティ関連図（ER/Class Diagram）

```mermaid
classDiagram
    class Work {
        +string id
        +HistoricalTime historicalTime
        +string createdAt
        +string updatedAt
        +string deletedAt
        +WorkStub stub
        +string mergedIntoWorkId
    }

    class Occurrence {
        +string id
        +string workId
        +string parentOccurrenceId
        +number orderKey
        +boolean collapsed
        +RevisionSelector revisionSelector
        +string contextualHeading
    }

    class Branch {
        +string id
        +string workId
        +string name
        +string headRevisionId
        +string createdAt
        +string promotedAt
    }

    class WorkingCopy {
        +string branchId
        +string workId
        +string text
        +string updatedAt
    }

    class Revision {
        +string id
        +string workId
        +string text
        +string[] parentRevisionIds
        +RevisionKind kind
        +string createdAt
        +string message
    }

    class RecoverySnapshot {
        +string id
        +string workId
        +string branchId
        +string text
        +string contentHash
        +SnapshotProtection protection
    }

    class OutlineLink {
        +string id
        +LinkEndpoint source
        +RelationTypeName type
        +LinkEndpoint target
        +LinkStatus status
        +LinkOrigin origin
    }

    class Bookmark {
        +string id
        +string workId
        +string occurrenceId
        +string createdAt
    }

    class ResumePosition {
        +string workId
        +string occurrenceId
        +number caretOffset
        +string updatedAt
    }

    Work "1" -- "0..*" Occurrence : "化身として配置"
    Work "1" -- "1..*" Branch : "別稿を持つ"
    Branch "1" -- "0..1" WorkingCopy : "作業中下書き"
    Work "1" -- "0..*" Revision : "不変版 (DAG)"
    Revision "0..*" -- "0..*" Revision : "parentRevisionIds"
    Branch "1" -- "0..1" Revision : "headRevisionId"
    Work "1" -- "0..*" RecoverySnapshot : "編集過程スナップショット"
    Work "1" -- "0..*" OutlineLink : "意味リンク (source/target)"
    Work "1" -- "0..*" Bookmark : "栞"
    Work "1" -- "0..1" ResumePosition : "キャレット再開位置"
```

### 5.2 アーキテクチャ上の主要パターン

1. **実身・化身（Work-Occurrence）モデル**:
   - `Work` は思索の「同一性・本文・版・意味リンク」を保持する。
   - `Occurrence` はアウトライン上の「配置（親ノード参照、並び順 orderKey、見出し上書き
     contextualHeading）」を保持する。
   - 1つの思索が複数の文脈に現れても、本文は単一の実身に紐づき整合性が保たれる。
2. **DAG型版管理（Revision DAG）**:
   - `Revision` は上書きされず、`parentRevisionIds` を複数持てる有向非巡回グラフ（DAG）として記録。
   - 単純な一本道の履歴だけでなく、分岐（Branch）や複数親の混成稿（Merge）をネイティブに表現。
3. **循環参照の隔離（Knot列）**:
   - 意味リンクや `FROM`
     系譜に循環が発生した場合、系統計算を破綻させず自動検出して特殊列（`Knot`）へ隔離投影。
4. **Svelte 5 Runes と State Ownership**:
   - View（`.svelte`）には状態遷移やロジックを書かず、純粋な描画とイベント送出に徹する。
   - 状態所有は各ドメイン単位の Controller（`*.svelte.ts`）に集約し、テスト容易性と保守性を確保。

---

## 6. 品質特性・横断的関心事（Cross-Cutting Concerns）

| 関心事                     | 実装アプローチ・設計上の担保                                                                                                                                                                                                                                     |
| :------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **オフライン・自律性**     | 完全ローカルファイル永続化（SQLite / JSON）。外部通信不要。                                                                                                                                                                                                      |
| **データ整合性・保護**     | SQLite ACID トランザクション。直列化キュー（`mutationQueue`）。自動回復スナップショット（`RecoverySnapshot`）と保護フラグ。                                                                                                                                      |
| **マイグレーション安全度** | 旧SurrealDBからの移行時は、元DBを変更せずコールドバックアップを作成してからSQLiteへ移行。未移行時は起動を停止して破壊を防止。                                                                                                                                    |
| **起動・描画性能**         | `startup-snapshot.json` によるファストパス描画。アウトラインの仮想スクロールおよびインデックス走査。                                                                                                                                                             |
| **テスト駆動・品質防壁**   | - **単体/結合テスト**: Deno test, Vitest<br>- **UI回帰**: Playwright UI / Visual / a11y<br>- **変異テスト**: Stryker による Controller / Service の網羅度・検出力検証<br>- **コードメトリクス**: Biome, knip, jscpd (重複検知ラチェット), 実装行数制限ラチェット |
