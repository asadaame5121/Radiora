---
title: 暗黙的FROM関係の適用計画
date: 2026-08-22
status: approved
tags:
  - radiora
  - domain
  - design
  - specification
description: アウトライナーの親子関係を暗黙的FROM関係として扱い、同じWork間の手動リンクを優先するための設計計画。
---

# 暗黙的FROM関係の適用計画

## 1. 目標

アウトライナー上の親子関係（`OutlineItem.parentId`）を、暗黙の意味関係 `FROM`（親 →
子）として扱います。

ただし、親子のWork間にユーザーが明示的な意味関係（`VS`、`LIKE`、`RELATED`、手動の `FROM`
など）を設定している場合は、明示的な関係を優先し、暗黙の `FROM` は適用しません。

この仕様は、グローバル系統図、創発的提案、ルールクエリなど、意味関係を参照する機能へ一貫して適用します。

## 2. 仕様

- 親と子が異なるWorkを参照する場合、親Work → 子Workの暗黙 `FROM` を生成します。
- 同じWorkを参照する親子間には生成しません。
- 同じWorkペアに明示的な関係がある場合、種類や向きを問わず暗黙 `FROM` を生成しません。
- 同じWorkペアを表す親子配置が複数あっても、暗黙 `FROM` は1件にまとめます。
- 暗黙リンクは永続化せず、参照時に明示リンクと合成します。

## 3. 提案される変更

### 3.1 ドメインロジック

#### [NEW] `src/services/implicit_relation.ts`

明示的な意味関係と、アウトライナーの親子関係から得られる暗黙 `FROM` を合成する純粋関数
`mergeImplicitFromLinks` を定義します。

処理は次の順序とします。

1. 明示リンクのWorkペアを向きに依存しないキーで記録する。
2. `OutlineItem.id` から親項目を引けるMapを作る。
3. 親子が異なるWorkを参照し、かつ明示リンクのないペアだけ暗黙 `FROM` を加える。
4. 生成済みペアを記録し、複数配置による重複を防ぐ。

#### [NEW] `src/services/implicit_relation_test.ts`

次を保証する最小限のユニットテストを置きます。

- 異なるWorkの親子から暗黙 `FROM` が生成される。
- 明示リンクがあるWorkペアでは生成されない。
- 同一Workの親子では生成されない。
- 同じWorkペアの複数配置から重複生成されない。

### 3.2 既存サービスへの適用

意味関係を一覧取得・処理する次の境界で `mergeImplicitFromLinks` を適用します。

- [MODIFY] `src/services/branch_service.ts`
- [MODIFY] `src/services/discovery_operations.ts`
- [MODIFY] `src/services/occurrence_operations.ts`
- [MODIFY] `src/services/semantic_link_operations.ts`
- [MODIFY] `src/services/comparison_service.ts`

各サービスに合成処理を複製せず、共通関数を呼び出します。必要な依存ポートには `listItems()`
を最小限追加します。

## 4. 検証計画

### 4.1 自動テスト

```bash
deno task test
```

新しい純粋関数のテストに加え、グローバル系統図、創発的提案、ルールクエリ、比較処理の既存テストで回帰がないことを確認します。

### 4.2 手動検証

1. アウトラインで項目Aの下に項目Bを配置する。
2. 全体系統ビューで、項目A → 項目Bの `FROM` が表示されることを確認する。
3. 項目Aと項目Bの間に `VS` などの明示リンクを作成する。
4. 暗黙 `FROM` が消え、明示リンクだけが表示されることを確認する。
