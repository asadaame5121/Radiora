# PR #285: 画面遷移と履歴保存の順序の点検

2026-10-03。`screenNavigation.open()` と、Controller の `openView` / `setView` 経由の呼び出し、
既存の `prepareOpen()` 経路を点検した。

画面履歴は呼び出し元の選択、Zoom 範囲、フィルター、インスペクター、比較状態を保存する。
遷移先の状態に書き換えた後の `open()` は、その書き換え後の状態を呼び出し元として保存する。
未保存フォームが選択を保留する場合も、画面と履歴を先に確定してはいけない。

## 今回の修正対象

| 経路                                                             | 変更前の問題・候補                                                                                                         | 修正                                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EditorReturnController.restore` → `KeyboardWorkspaceController` | 編集項目と Zoom 範囲を復元してから Outline を開き、Tree の呼び出し元を失う。選択が保留されると、承認後も復帰処理が続かない | 保存・復元前に準備し、選択の承認を待って復元・確定する。Cancel は画面・範囲・履歴を変更しない                                                                      |
| `confirmPendingAction` の別稿作成                                | 新しい配置を `load()` で選択してから Outline を開く                                                                        | `BranchRewriteController` に委譲し、作成前に準備、再読込の選択承認コールバックから確定する                                                                         |
| `openOutline` / `openTree` / `openLongForm` / `saveLongForm`     | 原稿の保存・再読込・開始の後に履歴を保存するため、その処理が選択を変えると元の選択を失う                                   | 処理前に準備する。保存による再選択も承認を待ち、失敗・Cancel は遷移しない。原稿保存後の復帰は `restore()` に保存も委譲する                                         |
| `ComparisonController.openWork` / `openLink`                     | `clear()` が比較ペア・Work・Link の状態を消した後に履歴を保存する                                                          | 状態を消す前に準備し、取得成功時に確定して結果を置き換える。取得失敗時は元の比較状態を保持する                                                                     |
| コンテキストメニューの Outline / Zoom / Work lineage             | 対象を再選択してから遷移する。通常はメニューを開いた時点で同じ対象を選択済みだが、順序上は同じ問題の候補                   | 遷移処理前の再選択を除き、選択前に準備、承認後に範囲変更・確定する。その他のコマンドもメニューを開いた時点の選択を使い、対象が変わった古いメニューからは実行しない |

## 既に準備・確定を分離していた経路

- Tree の項目、Today の配置、Inspector の配置、Query 結果、内部参照バックリンク:
  `openOutlineOccurrence()`。
- 栞、前回の編集位置、内部参照の解決先: `openNavigationTarget()`。
- 最近編集した項目: `openRecentItem()`。
- 疎アウトライン: `handleSparseOutlineSelect()`。
- 未配置 Work の配置、Root へのクイック入力: `WorkController.prepareView()` と
  `reload(..., afterSelection)`。

これらは選択前に履歴を準備し、選択が受理されたコールバックから確定する。

## 即時の `open()` を維持する経路

| 経路                                                              | 確認した順序                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Today / 日付範囲 / 週表示 (`DateProjectionController`)            | 日付投影の取得後に開く。保存対象の選択・Zoom 範囲・比較状態は変更しない |
| 未配置 / Stub / 重複候補 / ゴミ箱 (`WorkController`)              | 一覧取得後に開く。呼び出し元の保存対象は変更しない                      |
| タグ管理 (`openTags`)                                             | タグと未配置一覧の取得後に開く。呼び出し元の保存対象は変更しない        |
| Option / Help / Help から Outline・Option                         | 画面を直接切り替える                                                    |
| Work lineage の Outline ボタン / Inspector の Work lineage ボタン | 選択と範囲を変えずに画面を切り替える                                    |
| Query Inspector (`openInspectorTool`)                             | `open()` または `remember()` で履歴を保存してから Inspector を変更する  |

`ComparisonController.openRevision()` も、従来は履歴保存後に比較状態を変更しており安全だった。
今回、比較 Controller の port を `prepareView()` に統一した。

## 回帰テスト

- `vitest/keyboard_navigation.svelte.test.ts`: Tree 呼び出し元、選択の Save / Discard / Cancel、
  原稿処理前の履歴保存。
- `vitest/branch_rewrite_navigation.svelte.test.ts`: 元の配置、選択の Save / Discard / Cancel、
  作成・再読込失敗時の履歴。
- `vitest/comparison_controller.svelte.test.ts`: Work / Link 比較を開く前の比較ペアの保持。
- `vitest/keyboard_controller.svelte.test.ts`: 保存後の再選択が Cancel された場合の原稿保持。
- `tests/ui/screen-navigation.spec.ts`: 別稿作成後の Today
  の元の選択・フィルター、編集位置への復帰後の Tree の選択・Zoom 範囲、年代フォームの Save / Discard
  / Cancel と戻る履歴、Tree のコンテキストメニューからの Outline / Zoom / Work lineage / 原稿 /
  版比較。

別稿の新しい配置は通常、元の配置と同じ Work に属するため、年代フォームのガードを通過する。 別 Work
の未保存フォームによる保留は、Controller の port テストで承認コールバックの契約を検証する。
