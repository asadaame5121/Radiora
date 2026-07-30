# phase4

## #51 [P4] Phase 4: 検索と知識整備 (phase, CLOSED)

### 目的
Sparse Outline、保存Query、Stub、重複統合、発見候補を一時投影上で統合する。

### Phase完了条件
- 検索・Query・候補表示が実データを複製せず、統合操作で来歴を失わない。
- 全sub-issueが完了している
- deno task verifyが成功している

### 依存
前Phase #38 の完了後に開始する。

### 設計の正本
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/product-direction.md
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/schema-evolution.md

利用者向け表示語彙はUiVocabularyから注入し、開発用語をUIへ直書きしない。

---

## #52 [P4-01] 検索・Today・Query共通の一時Occurrence投影モデルを実装する (task, area:search, CLOSED)

### 目的
検索・Today・Query共通の一時Occurrence投影モデルを実装する

### 完了条件
- 仮想ビューが永続Occurrenceを作らない。
- 関連する自動テストを追加または更新する
- deno task verifyが成功する

### 設計
- Phase: Phase 4: 検索と知識整備
- Parent: #51
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/product-direction.md
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/schema-evolution.md

### 対象外
この完了条件に不要な機能追加と、設計上分離された責務の再統合。UI文言はUiVocabulary経由とする。

---

## #53 [P4-02] Sparse Outline生成器を実装する (task, area:search, CLOSED)

### 目的
Sparse Outline生成器を実装する

### 完了条件
- 一致、祖先、直接リンク、順位理由を最小文脈で返す。
- 関連する自動テストを追加または更新する
- deno task verifyが成功する

### 設計
- Phase: Phase 4: 検索と知識整備
- Parent: #51
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/product-direction.md
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/schema-evolution.md

### 対象外
この完了条件に不要な機能追加と、設計上分離された責務の再統合。UI文言はUiVocabulary経由とする。

---

## #54 [P4-03] 保存Query結果をSparse Outline表示へ接続する (task, area:search, CLOSED)

### 目的
保存Query結果をSparse Outline表示へ接続する

### 完了条件
- 結果から実Workを編集でき、再実行で投影が更新される。
- 関連する自動テストを追加または更新する
- deno task verifyが成功する

### 設計
- Phase: Phase 4: 検索と知識整備
- Parent: #51
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/product-direction.md
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/schema-evolution.md

### 対象外
この完了条件に不要な機能追加と、設計上分離された責務の再統合。UI文言はUiVocabulary経由とする。

---

## #55 [P4-04] Stub状態・作成文脈・Backlink・一覧を実装する (task, area:domain, CLOSED)

### 目的
Stub状態・作成文脈・Backlink・一覧を実装する

### 完了条件
- 本文追加後にStub状態を明示解除できる。
- 関連する自動テストを追加または更新する
- deno task verifyが成功する

### 設計
- Phase: Phase 4: 検索と知識整備
- Parent: #51
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/product-direction.md
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/schema-evolution.md

### 対象外
この完了条件に不要な機能追加と、設計上分離された責務の再統合。UI文言はUiVocabulary経由とする。

---

## #56 [P4-05] 重複候補のscoreと根拠表示を実装する (task, area:search, CLOSED)

### 目的
重複候補のscoreと根拠表示を実装する

### 完了条件
- 自動統合せず、利用者へ候補と根拠だけを提示する。
- 関連する自動テストを追加または更新する
- deno task verifyが成功する

### 設計
- Phase: Phase 4: 検索と知識整備
- Parent: #51
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/product-direction.md
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/schema-evolution.md

### 対象外
この完了条件に不要な機能追加と、設計上分離された責務の再統合。UI文言はUiVocabulary経由とする。

---

## #57 [P4-06] 重複統合previewとtransactional mergeを実装する (task, area:domain, CLOSED)

### 目的
重複統合previewとtransactional mergeを実装する

### 完了条件
- 配置、リンク、Revision、alias、来歴を失わず統合できる。
- 関連する自動テストを追加または更新する
- deno task verifyが成功する

### 設計
- Phase: Phase 4: 検索と知識整備
- Parent: #51
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/product-direction.md
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/schema-evolution.md

### 対象外
この完了条件に不要な機能追加と、設計上分離された責務の再統合。UI文言はUiVocabulary経由とする。

---

## #58 [P4-07] 非統合時にLIKE・RELATEDを選ぶ経路を実装する (task, area:ui, CLOSED)

### 目的
非統合時にLIKE・RELATEDを選ぶ経路を実装する

### 完了条件
- 候補却下と意味リンク採用を明確に区別する。
- 関連する自動テストを追加または更新する
- deno task verifyが成功する

### 設計
- Phase: Phase 4: 検索と知識整備
- Parent: #51
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/product-direction.md
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/schema-evolution.md

### 対象外
この完了条件に不要な機能追加と、設計上分離された責務の再統合。UI文言はUiVocabulary経由とする。

---

## #59 [P4-08] 発見候補を確定リンクと別エンティティへ移す (task, area:search, CLOSED)

### 目的
発見候補を確定リンクと別エンティティへ移す

### 完了条件
- 採用、却下、保留と根拠を追跡できる。
- 関連する自動テストを追加または更新する
- deno task verifyが成功する

### 設計
- Phase: Phase 4: 検索と知識整備
- Parent: #51
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/product-direction.md
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/schema-evolution.md

### 対象外
この完了条件に不要な機能追加と、設計上分離された責務の再統合。UI文言はUiVocabulary経由とする。

---

## #60 [P4-09] 高密度データの性能・選択文脈テストを追加する (task, area:quality, CLOSED)

### 目的
高密度データの性能・選択文脈テストを追加する

### 完了条件
- 大量結果でも祖先、選択、順位理由を見失わない。
- 関連する自動テストを追加または更新する
- deno task verifyが成功する

### 設計
- Phase: Phase 4: 検索と知識整備
- Parent: #51
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/product-direction.md
- https://github.com/asadaame5121/Radiora/blob/main/docs/design/schema-evolution.md

### 対象外
この完了条件に不要な機能追加と、設計上分離された責務の再統合。UI文言はUiVocabulary経由とする。
