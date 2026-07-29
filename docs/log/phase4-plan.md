# Phase 4 実装計画

- 作成日: 2026-07-29
- 対象: `#51` Phase 4: 検索と知識整備（sub-issue `#52`-`#60`）
- 状態: 承認済み、実施中

## 前提（調査結果）

- 現行 schema: storage / backup とも version `3`
- 既存の足場:
  - `OutlineService.searchItems` が `score`・`reasons`（順位理由）・`ancestorIds` を返す
  - `DateProjectionService`（Today）が「永続 Occurrence を作らない読み取り専用投影」の先例
  - `SavedRuleQuery` の永続化と実行は済み。不足はアウトライン投影・結果からの編集・再実行更新
  - `SearchAlias` は永続化済み（統合時の旧名称保持に利用）
  - `EmergenceSuggestion` はフィンガープリント ID の一時生成 + `emergence_feedback` のみ永続
  - `LinkOrigin = "human" | "suggestion" | "import"`、`LinkStatus` で候補と確定を区別可能
  - 永続 Stub 概念は未実装（`OutlineItem.referenceStub` は再帰表示マーカーで別物）
- UI 文言は `UiEntityCode` / `DEFAULT_UI_VOCABULARY` への追加が必須（直書き禁止の契約テストあり）

## スキーマ変更計画（3 段）

| migration | version | 対象 issue | 内容 |
|---|---|---|---|
| `0004_stub_state` | 3->4 | #55 | `Work.stub`（作成日時・作成文脈）追加 |
| `0005_merge_provenance` | 4->5 | #57 | `Work.mergedIntoWorkId` 追加。旧実身を保持・非表示 |
| `0006_emergence_suggestion` | 5->6 | #59 | `emergence_suggestion` 永続テーブル（kind/evidence/score/status/根拠） |

各 migration は `up` + `validate` + 旧 version fixture + 日本語本文 round-trip テストを必須とする
（schema-evolution §9）。`#52`・`#53`・`#54`・`#56`・`#58`・`#60` はスキーマ変更なし。

## 実装順序（依存関係により issue 番号順ではない）

```text
#52 -> #53 -> #54   一時投影 -> Sparse Outline -> 保存Query接続（スキーマ変更なし）
#55                 Stub / schema v4（独立）
#56                 重複候補 score+根拠（計算のみ、永続化なし）
#57                 統合 preview + transactional merge / schema v5（親または高能力エージェント担当）
#58                 非統合時 LIKE/RELATED 経路
#59                 発見候補エンティティ化 / schema v6
#60                 高密度データの性能・選択文脈テスト（最後）
```

共有ワークツリーの並行編集を避けるため逐次実施する。

## issue 別の委譲指示

### #52 [P4-01] 一時 Occurrence 投影モデル

- 結果: 検索・Today・保存 Query が共有する一時投影型を `src/domain/models.ts` に定義し、
  投影サービスを実装する。投影ノードは永続 Occurrence ID を持たず、実 Occurrence/Work への参照と
  祖先パンくずを保持する。既存 `DateProjection` をこのモデルへ適合させる
- 編集可能範囲: models.ts、新規投影サービス、date_projection.ts、対応テスト
- 不変条件: 投影が store へ一切書き込まない（永続 Occurrence/Working Copy を生成しない）。
  既存 Today ビューの表示と動作を変えない
- 検証: 「投影実行後に store の Occurrence 件数が変わらない」テストを追加 + `deno task verify`
- 停止条件: DateProjection との統合/適合の設計判断がつかない場合

### #53 [P4-02] Sparse Outline 生成器

- 結果: 一致ノード・祖先チェーン・直接リンク先・順位理由を最小文脈で含む疎なアウトライン木を
  構築する生成器。入力は `SearchResult[]` 等、出力は #52 の投影モデル。UI 接続は #54
- 不変条件: `SearchReason`（順位理由）を欠落させない。複数一致で祖先を共有する場合は木へ
  畳み込む。永続化なし
- 検証: 一致・祖先・直接リンク・理由の保持、祖先共有、リンク先の文脈付与のユニットテスト + verify

### #54 [P4-03] 保存 Query を Sparse Outline 表示へ接続

- 結果: 保存 Query の実行結果を Sparse Outline 投影として表示。結果ノードから実 Work の
  Working Copy を既存エディタで編集できる。再実行で投影が更新される（複製ではなく投影）
- 編集可能範囲: App.svelte、新規 UI コンポーネント、command_service、bindings.ts（必要時）、
  UiVocabulary
- 不変条件: 投影からの編集は実 Work の本文を更新する（投影コピーを編集しない）。
  Query 実行は書き込みを行わない。UI 文言は UiVocabulary 経由
- 検証: UI 契約テスト + サービステスト + verify

### #55 [P4-04] Stub 状態・作成文脈・Backlink・一覧（schema v4）

- 結果: `Work.stub?: { createdAt, createdVia }` を追加。Stub 一覧ビュー、Backlink 表示
  （既存 `internal_reference_service` 再利用）、本文追加後の明示解除。作成導線は Stub 一覧からの
  新規作成と、Advanced Link Editor での明示確認付き Stub 作成
- 不変条件: 未解決入力から Stub を暗黙作成しない（Phase 3 の既存契約を維持）。Stub 解除は本文が
  非空の場合のみ。`OutlineItem.referenceStub`（再帰表示）とは別概念として混同しない
- 検証: migration 0004 の validate/fixture/round-trip テスト、3 store 契約テスト更新、
  サービステスト + verify

### #56 [P4-05] 重複候補の score と根拠表示

- 結果: 重複候補を計算するサービス（タイトル正規化一致・alias・共有タグ・共有リンクを根拠とする
  スコア + 根拠リスト）と、候補+根拠の表示 UI。計算のみで永続化なし
- 不変条件: 自動統合しない。同一 Work・ゴミ箱・統合済み（#57 後）を候補から除外。
  書き込み操作を含まない
- 検証: 根拠種別ごとのスコアと除外条件のユニットテスト + verify

### #57 [P4-06] 統合 preview + transactional merge（親または高能力エージェント / schema v5）

- 結果:
  - preview: 統合前に本文・化身・リンク・Revision・alias を比較表示（`ComparisonService` 再利用）
  - merge: `GraphStore` に atomic な `mergeWorks` を追加（Memory/JSON/Surreal 3 実装）。
    化身の付け替え、リンク端点の張り替えと対称重複の除去、旧名称の `SearchAlias` 保存、
    Revision/Branch は旧 Work に残して来歴保持、旧 `Work.mergedIntoWorkId` 設定で通常ビューから
    非表示
  - migration `0005_merge_provenance`
- 不変条件: 配置・リンク・Revision・alias・来歴を失わない。失敗時に部分適用を残さない
  （Surreal は transaction、JSON/Memory は全成否）。利用者の明示操作のみ
- 検証: 3 store 契約テスト、migration テスト、失敗時ロールバックテスト + verify
- 停止条件: SurrealDB transaction で全操作をカバーできない場合は分割方針を親へ相談

### #58 [P4-07] 非統合時に LIKE・RELATED を選ぶ経路

- 結果: 重複候補に対し「統合する / LIKE を作成 / RELATED を作成 / 却下（何もしない）」を明確に
  区別する UI。LIKE/RELATED は `origin: "human"` の asserted リンクとして既存 `createLink` で
  作成し、候補の根拠を `reason` に引き継げる
- 不変条件: 候補からリンクへの自動昇格なし。却下とリンク採用を別操作として区別
- 検証: UI 契約テスト + サービステスト + verify

### #59 [P4-08] 発見候補を確定リンクと別エンティティへ（schema v6）

- 結果: `emergence_suggestion` 永続エンティティへ移行（kind/evidence/score/status/タイムスタンプ）。
  採用 -> `origin: "suggestion"` の asserted リンク + status 更新、却下 -> status + 理由、
  保留 -> held 状態。既存の一時生成 + `emergence_feedback` 方式から移行
- 不変条件: 候補が自動的にリンクへ昇格しない。採用リンクが人間確定リンクと識別可能であること
- 検証: migration 0006 テスト、採用/却下/保留の追跡テスト + verify

### #60 [P4-09] 高密度データの性能・選択文脈テスト

- 結果: 数千 Work・高密度リンクの fixture で、Sparse Outline 生成・検索の性能と、大量結果でも
  祖先・選択・順位理由を見失わないことのテストを追加
- 不変条件: テスト追加が本体。性能問題が見つかった場合の実装変更は親へ相談
- 検証: verify

## 作業場所と運用

- 作業は jj workspace `phase4`（`../Radiora-phase4`）で実施する
- issue ごとに独立した change を積み、各 change で親が `deno task verify` を実行してから確定判断する
- 検証失敗中は完了扱いにしない
- 生成物・診断ファイルはコミットしない
- Phase 完了後: `jj workspace forget phase4` で workspace を畳み、change の統合・push 可否は親が判断

## 実装エージェントへの共通停止条件

1. 1 回の修正後も同じ検証が失敗する -> 親へ返す
2. 不変条件を仕様・既存コードから確定できない -> 返す
3. 変更が UI/状態管理/永続化の複数領域へ拡大した -> 返す
4. 複数の実装案から設計判断が必要になった -> 返す

## Phase 完了条件

- 全 sub-issue（`#52`-`#60`）完了 + `deno task verify` 成功
- 検索・Query・候補表示が実データを複製せず、統合操作で来歴を失わない
- `docs/log/` に過去 Phase と同形式のクローズアウト記録を追加
