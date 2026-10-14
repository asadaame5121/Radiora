# PR #342〜#347 レビュー指摘の検証・修正記録

2026-10-14。対象は #344 (`f139d89`)、#345 (`366a9b8`)、#346 (`35c6b73`)、#347 (`9a3358d`)、#342
(`830b98a`)、#343 (`adde36c`)。前提となる JSON 永続化変更は `2af8d5a`。#342 と #343 はともに #347 を
base とする兄弟 PR であり、直列スタックではない。

実際の PR refs を取得し、#343 と #342 をローカルで統合した worktree
`/workspace/Radiora-review`、branch `review/p3-contract-fixes` で検証・修正した。 GitHub への
push・PR 更新・merge は実施していない。

## 指摘ごとの判定

| 指摘                                | 検証結果                                                                                                                                                                                                        | 対応                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Standards: 行数目的の基底クラス抽出 | 独立した状態・I/O・transaction を所有しない委譲専用クラスである点は確認。抽出の動機そのものはコードだけでは断定できない。                                                                                       | 委譲専用クラスを削除し、queue・batch 文脈・transaction・rollback を所有する `SqlitePersistence` へ置換。            |
| Standards: TDD 違反                 | 実装 commit が追加テスト commit に先行する履歴は確認。ただし開発中の Red 実行を履歴だけから否定できず、報告の「User Rule 7」は本環境の規約から確認できない。                                                    | 違反の断定を保留。既存 PR の履歴は書き換えず、今回の構造変更では回帰テストの失敗を先に確認。                        |
| Standards: 文書・実装不整合         | 妥当。本文に局所保存がある一方、操作表・rollback 説明には旧契約が残っていた。                                                                                                                                   | 局所保存・構造変更 fallback・batch と、それぞれの rollback を表・本文で明示。                                       |
| Standards: Middle Man               | 委譲専用クラスという設計上の懸念は妥当。                                                                                                                                                                        | 永続化責務を composition へ移し、`SqliteGraphStore` は `MemoryGraphStore` を直接継承。                              |
| Standards: Refused Bequest          | 祖父クラスへの直接 `prototype.call` は確認。ただし、それだけでは機能的な継承契約違反の証明にはならない。                                                                                                        | 初期化・復元を通常の `super.restoreGraphState()` に戻し、永続化境界から復元 callback を呼ぶ。                       |
| Standards: 構造変更判定の重複       | 妥当。Memory と SQLite が同じ parent / Work 比較を持っていた。                                                                                                                                                  | `hasOccurrenceStructureChanged()` を共有し、SQLite は計画時の判定結果を再利用。                                     |
| Spec: RPC 検証 C03 の未実装         | 誤り。#335 の時点で Valibot による配列・ID・boolean 検証と C03 テストが存在する。PR diff にないことは未実装の根拠にならない。一方、文書の UUID 保証は誤り。                                                     | 実装は維持し、文書を `IdSchema` の「空でない文字列」に訂正。                                                        |
| Spec: 小更新の障害注入不足          | 部分的に妥当。既存テストには Occurrence の transaction 開始前の失敗があるが、本文更新、SQL 適用後、COMMIT、再起動の組合せが不足。                                                                               | 新規 20 テストで補完。                                                                                              |
| Spec: 中間クラスはスコープ逸脱      | 分割単位への懸念は妥当だが、「全 state clone 廃止と汎用 store 全面改造を一緒にしない」だけで単純抽出を禁止したとは断定できない。                                                                                | SQLite 専用の永続化境界へ限定。全 store 改造や schema 変更は行わず、構造変更・batch の全 snapshot fallback を維持。 |
| Spec: JSON テストの混入             | 無関係とはいえない。スタックの前提 `2af8d5a` は JSON の batch・queue・close を変更しており、#342 はその契約も検証する。テスト PR 分割はレビュー運用上の判断。                                                   | 既存の回帰テストを維持。                                                                                            |
| Spec: batch 中の C04 バイパス       | 誤り。`planOccurrenceUpdate()` は親へ委譲する前に `planTargetedOccurrenceUpdate()` を実行し、C04 を検証済み。親の更新は配列 `map` による再適用であり、指摘された Map 構築とは異なる。二重更新の無駄は存在する。 | batch / 非 batch とも検証済み step を適用。構造変更は Knot dirty を記録し、コミット時に一度再構築。                 |

## 修正と回帰検証

- `sqlite_persistence.ts` が queue と非同期 batch 文脈、全差分 / 局所 transaction、close 待機、
  メモリ回復を所有する。queue gate は操作の成否にかかわらず解放される。
- `sqlite_targeted_mutations.ts` の Occurrence 計画に構造変更判定を含める。 `sqlite_store.ts` は同じ
  step の適用後に Knot dirty を記録し、親での再更新を避ける。
- `sqlite_targeted_failure_contract_test.ts` は本文・branch 本文・collapse・構造変更・ResumePosition
  更新 / 解除の 6 経路 × BEGIN / SQL 適用後 / COMMIT の 3 障害地点を検証する。 実際の SQLite DB
  を使い、直後のメモリ、再起動、失敗後の次の queued mutation と再保存を照合する。
- 追加 2 テストは batch 内の Branch / Revision / Bookmark / ResumePosition 検証と、 局所 step
  の適用・Knot 保存を確認する。後者は修正前に失敗し、修正後に成功した。
- 文書の Memory batch 排他説明も既存 `OutlineBatch` と整合させた。

## 検証結果

Deno 2.9.3（CI と同じ版）と既存 frontend dependencies を使用。

- 追加テスト 20 件成功。SQLite の既存契約、局所計画、RPC、batch 分離、Knot、共通 store 契約も成功。
- 全体 `deno test -A src tests scripts`: 969 成功、3 失敗。 この実行後に追加した batch 内 C04
  テストも単独実行で成功。
- 3 失敗は `turso_migration_test.ts` の Windows パスと `desktop_build_backend_test.ts` の Windows
  専用 MSIX 処理。修正前の同じファイルでも 3 件すべてを再現し、今回の回帰でないことを確認した。
- frontend unit tests: 525 / 525 成功（52 files）。
- `deno check src/main.ts`、`npm run check`、`npm run build` 成功。
- lint、implementation-line quality、magic-number ratchet、duplicate ratchet、format check、
  `git diff --check` 成功。lint の既存 warning と Vite の既存 chunk size warning は残る。

Windows デスクトップ packaging の成功は本 Linux 環境では確認していない。
