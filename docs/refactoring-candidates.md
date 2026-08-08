# リファクタリング候補一覧

大型ファイルの責務を、挙動を維持したまま段階的に分割するためのロードマップ。
構造変更と仕様変更は同じ差分に混ぜず、各段階で `deno task verify` を通す。

## 進捗

- [x] `PhylogeneticTree.svelte` からカメラ計算を `tree_camera.ts` へ分離
- [x] `PhylogeneticTree.svelte` からラベル衝突用空間インデックスを `tree_spatial_index.ts` へ分離
- [x] `App.svelte` から Today 表示を `TodayView.svelte` へ分離
- [x] `App.svelte` から Stub 一覧を `StubListView.svelte` へ分離
- [x] `App.svelte` から Unplaced 一覧を `UnplacedInboxView.svelte` へ分離
- [x] `App.svelte` から Tags、Trash、Options 表示を各 feature view へ分離
- [x] 確認フローを `ConfirmationController` と `ConfirmationDialog` へ分離
- [x] Command Palette と Licenses のダイアログ描画を分離
- [ ] `App.svelte` から editor/navigation/work 操作を feature controller へ分離
- [ ] `surreal_store.ts` から row mapper、migration、backup/restore を分離
- [ ] `DiscoveryOperations` を search、emergence、rule query に分離
- [ ] `GraphStore` の利用側依存を feature-specific port へ縮小

## P0: `src/ui/App.svelte`

アプリ全体の状態、導出値、ライフサイクル、入力イベント、RPC 呼び出し、各ビューの
テンプレートが集中している。最終的にはルーティング、共有状態の所有、feature 間の接続に
責務を限定する。

### ビュー分割

次の順で、独立性の高い表示からコンポーネントへ移す。

1. Today、Stub List
2. Unplaced Inbox
3. Tags、Trash、Options
4. Outline 本体と Inspector

子コンポーネントは表示とローカルな導出に集中させる。RPC、選択状態、画面遷移は当面
`App.svelte` に残し、コールバック経由で接続する。

### 操作分割

ビューの境界が安定した後、次の操作群を controller/action モジュールへ移す。

- editor: オートセーブ、resume position、内部参照、インラインリンク補完
- navigation: 検索、オムニウィンドウ、コマンドパレット、パンくず、ペイン
- work: quick capture、unplaced、stub、duplicate、trash、merge
- analysis: tags、rules、emergence、lineage、comparison、revisions

## P0: `src/storage/surreal_store.ts`

DB 接続、行変換、CRUD、複数テーブル更新、バックアップ、マイグレーション、診断ログが
一つのクラスに集まっている。

推奨境界:

- `surreal_connection`: 接続、認証、共通 query 実行
- `surreal_row_mapper`: RecordId とドメイン型の相互変換
- work repository: work、occurrence、branch、revision、snapshot
- relation repository: link、relation、knot、alias、emergence
- backup repository: export、restore、purge manifest
- migrations: schema version と migration journal

## P1: `src/storage/memory_store.ts`

メモリ状態の保持に加え、merge、trash、restore、purge、投影、リンク重複排除を担当している。
状態コンテナと純粋なドメイン変更処理を分け、可能なロジックは Surreal 実装と共有する。

## P1: `src/services/discovery_operations.ts`

検索、prefix suggestion、alias、emergence suggestion、feedback、rule query、query projection が
同居している。

推奨境界:

- search operations
- emergence suggester
- emergence persistence/resolution
- rule query operations
- prefix suggestion operations

## P1: Tree UI

`PhylogeneticTree.svelte` と `GlobalLineage.svelte` から、カメラ、hit testing、controls、filter、
inspector を段階的に分離する。純粋計算は D3/Svelte 非依存にし、単体テストで境界を固定する。

## P2: Parser とストレージ契約

- `inline_semantic_link.ts`: scanner、grammar、diagnostics を分離
- `graph_store.ts`: Outline、Revision、Relation、Discovery の feature-specific port を追加

`GraphStore` interface の一括分割は変更範囲が大きいため、先に利用側の依存を狭める。

## 分割時の完了条件

- 公開されている挙動と UI 文言を変更していない
- RPC と永続化の呼び出し位置が意図せず子 UI に移っていない
- 対象の契約テストを新しいファイル境界へ追随させている
- 新しい純粋ロジックには直接テストがある
- `deno task verify` が成功する
