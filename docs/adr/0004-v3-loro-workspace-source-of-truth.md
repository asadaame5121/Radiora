# ADR 0004: v3 では workspace 文書の正本を Backend の Loro に置く

## ステータス

Accepted（2026-11-23、#382）。main の
[ADR 0003](https://github.com/asadaame5121/Radiora/blob/2c247187c709a74dbf54e3bc007749e4da005354/docs/adr/0003-loro-edit-session-undo.md)
（Proposed のまま未採用）を置き換える。

main の 0003 本文はこの v3 ブランチへ複製せず、上の固定 commit を参照する。現行版 main
へは自動で反映しない。 v3 を main へ取り込むときに、0003 のステータスを「Superseded by
ADR-0004」へ更新する。

## 日付

2026-11-23

## コンテキスト

ADR 0003 は、v2 の正本を SQLite に保ったまま、編集セッションの live state にだけ Loro
（`loro-crdt`）を使って Undo/Redo を得る案だった。0003 自身が Phase 3 として「文書の正本を Loro
へ移すかは別 ADR で判断し、その時点で本 ADR は supersede される」と定めている。

v3 では、Tauri へ移行するにあたって文書の正本を Rust の Backend に置き、Loro
をその正本にすると決めた
（[v3決定事項](../design/v3-model-decisions.md)、[Tauri全体計画](../design/tauri-migration-plan.md)
§6.5）。0003 が想定した契機（端末間同期・オフラインファースト）とは異なる。共同編集・端末同期は、 v3
の初回でも対象外のままである。

## 決定

workspace ごとに一つの LoroDoc を Backend（Rust の core/infra）に置き、文書の正本とする。SQLite
は最新 1 世代の snapshot と、それ以降の差分を保存する。Undo/Redo は workspace 共通の履歴とする。

0003 の決定 1〜10 の扱いは次のとおり。

| 0003 の決定                                             | 0004 での扱い                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Loro は編集セッションの live state 限定、正本は DB    | **置換**: workspace 単位の単一 LoroDoc を正本とし、SQLite は snapshot＋差分の保存先とする                                                                          |
| 2 Ctrl+Z / Recovery Snapshot / Revision の役割分担      | **置換**: Undo は workspace 共通履歴。新モデルに Revision・Recovery Snapshot を作らず、旧データは archive に保全する。時間が経った後の復旧はゴミ箱と backup が担う |
| 3 Undo は新しい現在状態の適用、完了済み書込を戻さない   | **維持**: Undo も新しい操作として差分を耐久化する                                                                                                                  |
| 4 自分のセッションの操作だけを Undo する                | **置換**: 別 pane の操作も Undo 対象になり得る。別 pane が対象のときは通知と明示的な移動で示す                                                                     |
| 5 Loro の識別子を永続化しない                           | **精密化**: binary の内部には含まれるが、業務 ID・RPC ID として公開しない。業務 ID は UUIDv7 の論理 ID                                                             |
| 6 削除の Undo は再作成で、TreeID が変わる               | **維持・精密化**: 論理 ID は変わらない。TreeID の再生成を外部へ見せない                                                                                            |
| 7 Undo スタックはセッション内だけ                       | **維持**: 再起動後は空履歴。Branch 切替は v3 に存在しない                                                                                                          |
| 8 共同編集・端末同期は対象外                            | **維持（初回）**: iroh・atproto は将来案として [アーキテクチャ](../design/v3-architecture.md) に記録する                                                           |
| 9 Frontend の Controller が Loro を所有する             | **置換**: Loro は Rust の core/infra の port の背後に置く。Frontend は Loro を直接扱わず、UI Controller は draft・navigation・focus だけを所有する                 |
| 10 既存 DB API への投影、250 ms autosave、mergeInterval | **置換**: Backend の単一 writer が差分を耐久化してから公開する。Undo の区切りは入力 1 秒・IME 一確定・複合操作一つ・明示境界で、autosave とは独立させる            |

### 採らなかった選択肢

- **0003 の限定導入を v3 でも続ける**: SQLite の正本と Loro の live state
  を二重に管理することになる。投影の順序・再構築・失敗時の整合を Frontend と Backend
  にまたがって保つ必要があり、Rust Backend へ正本を移す v3 の目的と合わない。
- **独自のコマンドスタック**: 0003
  と同じ理由で採らない。構造操作ごとに逆操作を自作することになり、操作を足すたびに保守が増える。
- **Recovery Snapshot だけで復旧する**: 0003 と同じ理由で採らない。粒度が合わず、Redo もない。

## 結果と影響

- 保存・公開境界、失敗時の扱い、再試行、checkpoint、耐久性、互換性は
  [Tauri全体計画](../design/tauri-migration-plan.md) §6.5 と #383 の PoC に従う。
- v3 ブランチに残る次の設計契約は、v2
  の現行実装に対する契約である。冒頭に注記を置き、書き換えは該当する実装 PR で行う。 v2
  のコードが残っているうちに書き換えると、動いているコードと説明が食い違うため。

| 契約                                                                        | v3 で置き換える内容                                                                                                          | 担当      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------- |
| [ui-state-ownership](../design/ui-state-ownership.md)                       | 本文 draft の owner は維持する。保存経路を Working Copy の autosave から、Backend command とBlock単位の本文版へ替える        | #385      |
| [storage-persistence-contracts](../design/storage-persistence-contracts.md) | Rust の store（Loro＋SQLite の snapshot/差分）の契約へ置き換える                                                             | #383/#385 |
| [product-direction](../design/product-direction.md) §4.2/§4.3/§4.5          | v3 では Revision・Recovery Snapshot・Working Copy を作らない。旧データの扱いは [v3決定事項](../design/v3-model-decisions.md) | #382/#384 |
| [schema-evolution](../design/schema-evolution.md)                           | v3 では Loro binary format・SQLite envelope・アプリ schema を別々に version 管理する                                         | #383/#384 |

- main 側にだけある `docs/design/loro-edit-session.md` と、0003 の PoC ブランチ `poc/loro-undo`
  は履歴資料とする。v3 の正本ではない。
