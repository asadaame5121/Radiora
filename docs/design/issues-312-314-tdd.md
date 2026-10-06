# #312 / #313 / #314: TDD用の受入テスト

初回TDD追加のBookmarkは `test/issues-312-314`。その時点ではproduction codeを変更していない。
既存のCodex設定変更は親changeに保持した。続く#312のローカル実装・検証は下に記録する。
ローカルのRed/Green確認とmainへの反映・Issue完了は別である。

## 境界

- 動作の正本はIssue本文と[UI所有契約](ui-state-ownership.md)。ブラウザテストは実際のAppを操作し、HTTPだけを外部境界で制御する。
- preference保存は内部変数の検査ではなくreload/remount後の公開UIで確認する。
- unmountはテスト専用harnessでSvelteの本物のmount/unmountを呼ぶ。production hookは追加しない。
- 未実装のController名・メソッド・共通props型は先に決めない。
- 構造テストは責務の移動を検出する補助ゲート。動作・a11y・所有関係の検証の代用ではない。

## 受入条件とテスト

| Issue | 実装すべき契約                                                        | テスト                                                                             |
| ----- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| #312  | 明示したInspector collapsed/width設定を再起動後も維持する             | `tests/ui/layout-regression.spec.ts`: explicit Options changes                     |
| #312  | Outline復帰のlive collapsedを後のwidth/nav保存に混入させない          | 同: restoration / width・navigation                                                |
| #312  | resize幅を240〜560pxへclampし、完了時に保存する                       | 同: resize clamps                                                                  |
| #312  | pointerup/cancelでgestureを終了し、その後のmoveを受理しない           | 同: resize stops                                                                   |
| #312  | resize中のunmountでlistenerと保存権限を解放する                       | `tests/ui/app-lifetime.spec.ts`: unmount during resize                             |
| #312  | 設定writer・resize listenerをAppからLayout側へ移す                    | `tests/app_composition_acceptance_test.ts`: #312の2件                              |
| #313  | runtime/npm一覧・全文・既存エラー文言・loadingを表示する              | `tests/ui/licenses-regression.spec.ts`: notices / index failure / selected license |
| #313  | close時にfocusを戻し、再表示で前のdetail/errorを捨てる                | 同: Escape and reopens / index failure                                             |
| #313  | 新しい選択へ古い成功・HTTP失敗・通信失敗を公開しない                  | 同: stale detail 200・503・network                                                 |
| #313  | close→reopen後へ旧detailを公開しない                                  | 同: detail from a closed dialog 200・503・network                                  |
| #313  | 一覧取得中もdialogを閉じられ、旧応答で再openしない                    | 同: index loading is closable 200・503                                             |
| #313  | 再表示で新しく取得した一覧を旧一覧/errorで上書きしない                | 同: old index 200・503                                                             |
| #313  | App破棄後に一覧取得が完了してもdialogを公開しない                     | `tests/ui/app-lifetime.spec.ts`: pending license index 200・503                    |
| #313  | license用Rune・取得手順をAppから取り除く                              | `tests/app_composition_acceptance_test.ts`: #313の2件                              |
| #314  | Options/dialogを経由してもOutline選択・caret・Inspector tabを維持する | `tests/ui/layout-regression.spec.ts`: #314                                         |
| #314  | AppはAPI portの薄い委譲にとどまり、feature I/O手順を持たない          | `tests/app_composition_acceptance_test.ts`: #314の2件                              |
| #314  | 主要画面・Tree/Help・比較からのOutline復帰、保存guardを維持する       | 既存`tests/ui/screen-navigation.spec.ts`の対象7件を再実行                          |

構造ゲートはTypeScript ASTを使い、コメント・文字列の単純検索では判定しない。 API接続の単一expression
arrowは許可し、App内での複数手順の実行を拒否する。
`recordViewChange`/`recordClientOperation`はfeature stateを取得・更新しない計測接続として除外する。
既存license state名の検出は補助的であり、renameだけで所有契約を満たしたとは扱わない。

## 実行

```bash
npx playwright test --config playwright.ui.config.ts tests/ui/layout-regression.spec.ts tests/ui/licenses-regression.spec.ts tests/ui/app-lifetime.spec.ts
# 個別Issueは上のコマンドへ --grep '#312' / '#313' / '#314' を追加する。

deno test --allow-read --allow-env tests/app_composition_acceptance_test.ts
# 個別Issueは上のコマンドへ --filter '#312' / '#313' / '#314' を追加する。

deno test tests/ui_layout_preference_test.ts
```

実装は各IssueのRedを一つずつGreenにし、その都度既存動作テストを再実行する。
期待値変更・skip・todoでRedを消さない。特に一覧競合のテストは現在「取得中にdialogが開かない」
段階で失敗するため、open/loadingを実装した後に旧応答のassertionまで到達することを確認する。

## 初回実行結果

- 新規ブラウザ24件: **10通過 / 14 Red**。
  - #312: 復帰設定混入2件、pointercancel後のmove1件、unmount後の保存1件がRed。
  - #313: detailの旧応答6件、一覧loading/close・再表示の4件がRed。
- 新規構造6件: **6 Red**。既存Appに残る責務を実際に検出した。
- 既存screen-navigation対象7件、Omni lifetime1件、layout preference4件: 通過。
- 追加TypeScriptの型チェック、Biome: 通過。既存productionのSvelte checkも0 errors / 0 warnings。
- Redは実装前の受入条件であり、このchange単独でCIがGreenになるとは扱わない。

## #312のローカル実装・検証

2026-10-06。`LayoutController`へ設定writerとlive Inspector contextを移し、
`InspectorLayoutAdapter`をViewのmount/unmountに接続した。
復帰apply・関係編集の一時openでは永続設定を書かず、幅/nav保存にも混入させない。
Optionsは保存設定のcollapsedを表示し、shell/復帰はlive contextを読む。

- #312ブラウザ: 既存8件と追加した狭幅2件、**10件通過**。
- Layout/adapter単体16件＋既存ScreenNavigation Workspace22件: **38件通過**。
- #312構造2件、preference/Omni/Inspector/Options契約16件: **18件通過**。
- #314のOptions/dialog復帰1件＋既存screen-navigation対象7件: **8件通過**。
- Svelte checkは0 errors / 0 warnings。追加単体/ブラウザの型チェック、Biome、build成功。
  Appの既存複雑度等のBiome警告とbuildのchunkサイズ警告は残る。

旧App所有を固定していた既存source契約テストだけをLayoutへの配線に更新した。 元の#312
TDDテストは期待値を変更せずGreenになった。
#313/#314の未実装受入条件を含む全体CIのGreenは、この検証では主張しない。
作業開始HEADと手元mainとの差は[UI所有契約の#312記録](ui-state-ownership.md)を参照する。

## 完了時に別途確認するもの

本テストだけで3件のIssue全体を完了と判定しない。以下は実装形状が決まった後の追加検証・レビュー対象。

- #312の追加対象は上の狭幅ブラウザとLayout/adapter単体で検証済み。
- #313: 新しいfeature ownerのport/dispose契約に対する直接テスト、全文取得中のowner破棄。
  既存Appのunmountテストだけでは、破棄済みowner内部への書込みがないことまでは証明しない。
- #314: startup/Outline編集/Tree/コマンド/a11y/visualの既存suite、DOM順・aria-busy/inert・CSS所有。
  最小props、二重writer・循環依存、親#294の再評価、所有表と残す責務の更新はレビューも必要。
