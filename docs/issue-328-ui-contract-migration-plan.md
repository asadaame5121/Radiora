# Issue #328 実装手順書: UI文字列検査から実操作テストへ

## 1. 目的・照合基点・完了範囲

ユーザー提供のIssue本文を仕様とする。GitHub Issueの再取得は行っていない。
照合基点はこのワークツリーの `main`、
`a5478fba21617c20a846ef913df08f37d0438a64`。この節は文書作成時点の計画であり、
当時は実装・テスト移行前だった。現在の累積状況は次の通り。

### 現在の完了状況

- Stage 1–6は親レビュー承認済みで、このthread/worktree内の作業が完了した。Stage 5ではtheme source
  suiteを assertion 40式 / effective execution 44件の対応台帳と代替coverage確認後に削除した。
- Stage 6ではnative Outline blank-click coverage、全体の最終ゲート、文書確認を完了した。
  main未反映・未commit/push。
- 優先command/theme source suiteは削除済み。残る19 UI source suitesは棚卸しのみ完了し、移行・削除は
  後続範囲。本Issueで一括移行・削除していない。
- `blank_click_deselect_contract_test.ts` と `button_style_contract_test.ts` は除外対象として
  HEADとの差分なし。a11y自動検査の結果はWCAG適合全体の保証を意味しない。

本書の行番号・行リンクは照合基点での閲覧補助とする。編集開始後の追跡には、
§3の「編集に耐える参照と再探索」に従い、ファイル・symbol/test名・対象式を使う。

成果物は次の三つとする。

1. 削除するassertionと、保証する契約・移行先testの対応記録。
2. command/themeの実操作保証と、Controller/domainのunit保証。
3. 残る19ファイルの棚卸しと、小さな単位での移行順序。

優先2ファイルはUI文字列検査を残さず、原則削除する。
残る19ファイルを一度に削除することは完了条件にしない。
静的検査が必要な契約はUIテストと分離し、制約・対象・理由を名前と説明に記す。
テスト容易性を理由にApp全体を再設計したり、テスト基盤や依存を追加したりしない。

### Issue本文と現行treeの差

- 初回照合時の `tests/*_ui_contract_test.ts` は21ファイル（優先2を含む）。優先2の削除後、
  現在は19ファイルが残り、棚卸しのみ完了している。
- 本文では不存在とされた [blank click契約](../tests/blank_click_deselect_contract_test.ts#L11)と
  [button style契約](../tests/button_style_contract_test.ts#L3)は、この基点には存在する。
  **本文の除外方針を優先し、両ファイルは削除・改変対象に含めない。**
  後続で扱う場合は別途スコープを合意する。
- CIの[a11y job](../.github/workflows/ci.yml#L124)には `test:ui`、`test:a11y`、`test:storybook`
  が既にある。原則としてCI変更は不要。

## 2. 実装前に確認する責務とテスト境界

[UI所有契約](design/ui-state-ownership.md#L14)を読み、
画面遷移に触れるテストでは[画面遷移設計](design/outline-screen-navigation.md)も確認する。
productionのownerや保存先を変更する移行ではない。

| 契約                                                      | 所有境界                                       | 主な検証先                                       |
| --------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| Paletteの描画、disabled、キー選択、close要求              | `CommandPaletteDialog` View                    | Storybook `play`                                 |
| query/openとcommand一覧の生成                             | Palette Controller、純粋なprojection           | unit。入力からDOM反映までの接続はPlaywright      |
| global shortcut、Appからの操作配線、focus復元、navigation | keyboard/focus adapter、App、Workspace         | Playwright。世代保護やcleanupはunitも併用        |
| availability、dispatch、payload、確認後のAPI呼出し        | command service/Controller、rewrite Controller | 既存unitを拡充                                   |
| テーマ選択callbackと押下状態                              | `ThemeSwitcher` View                           | Storybook `play`                                 |
| preferenceの正本・保存・system listener                   | Theme Controllerとtheme adapter                | unit + AppでのPlaywright                         |
| 実DOMへのtheme適用、OS設定に応じたCSS、可読性             | document、stylesheet、表示中のView             | Playwright/a11y                                  |
| Viewからstorageへの直接依存禁止など                       | 意図的なarchitecture制約                       | 明示的な静的検査。表示実装の文字列固定は残さない |

### 現状を誤認しないための注意

- [Palette View](../src/ui/CommandPaletteDialog.svelte#L48)は `shouldFilter={false}`。
  queryは親へbindし、親が[command一覧を生成](../src/ui/App.svelte#L637)する。
  [既存Filtering story](../stories/command-palette.stories.ts#L51)は
  絞り込み済みpropsを渡すだけなので、入力→一覧更新の保証とは数えない。
- `open` と `query` はcontrolled props。 `onClose` spyが呼ばれただけではDOMの消失を保証しない。
  必要なら小さなstory harnessで `open` を更新し、実Appの状態遷移はPlaywrightで保証する。
  queryのbind確認もharnessで行い、productionのfilter処理をコピーしない。
- [テーマ適用adapter](../src/ui/theme_preference.ts#L56)はpreferenceを
  `document.documentElement.dataset.theme` に書く。Autoは **`data-theme="auto"` のまま**で、
  [CSS media query](../src/ui/styles.css#L33)が実効色を切り替える。 OS変更後に `data-theme="dark"` /
  `"light"` へ変わるというテストは書かない。
- [Theme Controller unit](../vitest/theme_controller.svelte.test.ts#L51)はcleanupを呼ぶが、
  解除callbackの実行自体をassertしていない。ファイルがあるだけでcoverage済みと扱わない。
- [既存a11y](../tests/a11y/app.a11y.spec.ts#L22)のLightテストはOutline編集文字色の検証。
  Light確認dialogの本文・補助文コントラストまでは保証していない。

## 3. 作業開始: ベースラインと移行台帳

1. `git status --short` とHEADを記録する。共同編集の変更を上書きしない。
2. Node/Denoの版は[CI設定](../.github/workflows/ci.yml#L24)に合わせる （現行CIはNode 22、Deno
   2.9.3）。
3. 依存・browserがない場合だけ以下を実行する。

   ```sh
   npm ci
   npx playwright install chromium
   ```

   LinuxでOS依存が不足する場合はCI同様 `npx playwright install --with-deps chromium` を使う。
4. §8の最終コマンドを変更前にも実行し、既存失敗と新規失敗を区別する。
   不一致があっても文字列検査を先に消して緑にしない。原因・環境・再現コマンドを記録する。
5. 以下の表をPR本文へコピーし、**assertion単位**で埋める。
   本書の§4/§5は契約グループであり、そのままではassertion単位の完了記録にならない。

| 元ファイル・symbol/test名・対象式（行番号/Hashは補助）                                                                                                                                                    | 保証したい契約                          | 分類 | 移行先ファイル・symbol/test/story名                                                                                           | 既存再利用/追加/残す | 実行結果 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------- |
| `tests/command_ui_contract_test.ts` / `App routes command buttons and global shortcuts through the command service` / `assert(adapter.includes('target.addEventListener("keydown", this.handle, true)'))` | connect時のcapture登録とcleanup時の解除 | unit | `vitest/global_keyboard_adapter.svelte.test.ts` / `suppresses IME/repeat/modal input and cleans every listener on disconnect` | 再利用しassertを確認 | 未実行   |

ループ中のcommand ID、正負assertion、複数回ある同じtoken検査も取りこぼさない。
重複assertionを同じ移行先へまとめる場合も、元assertionの一覧は残す。
実装詳細しか固定していなかったassertionは「どの意味的契約に置換するか」を書く。
不要な制約なら廃止理由を記し、PRで合意する。テスト名だけの対応付けは禁止する。

### 編集に耐える参照と再探索

参照の主キーは**リポジトリ相対パス + symbol/test/story名 + 対象式や契約**とする。
行番号だけ、Hashだけでは記録しない。symbol改名・ファイル移動時は台帳も更新する。
§4/§5の行範囲は照合基点に限った索引なので、削除前にこの形式へ展開する。

| 参照情報                        | 用途・限界                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| ファイル + symbol名             | Tree-sitter系の構文探索や `ffs symbol` で現在の定義位置を引き直す。名前の重複はファイル/包含class等で区別する            |
| test名・story export名 + 対象式 | 無名callbackや一つのtest内の複数assertionを区別する。test名の文字列が独立symbolとして索引化されるとは限らない            |
| 行番号・行リンク                | 現在位置の閲覧補助。編集後は再探索結果から取り直す                                                                       |
| hashlineの行アンカー            | 読み取った対象内容と編集直前の内容の照合用。対象行の変更でHashも変わり、同一内容や短いHashの衝突もあるため一意IDではない |
| Git commit + ファイル           | 削除・改名後も元のassertionを調べるための履歴参照。照合commitも台帳と併記する                                            |

リポジトリルートからの探索例:

```sh
# Tree-sitterベースのsymbol探索で現在の定義位置を得る
ffs symbol createThemeController --root .
ffs symbol CommandExecutionController --root . --expand --budget 3000

# test名など、symbol探索だけで特定できない箇所は文字列で絞る
ffs grep -F 'command palette projects command service state and guards disabled execution' --root . -g 'tests/command_ui_contract_test.ts'

# 対象を特定してから、編集前の行アンカーを取り直す
hashline read tests/command_ui_contract_test.ts
```

`ffs symbol` が返した現在位置を使い、必要な包含関数/classを
`ffs read <path>:<現在の行番号> --section --budget 3000` で確認する。 利用先の参照探索には
`ffs refs <symbol名> --root .` も使える。 別ディレクトリから呼ぶ場合は `--root`
にこのワークツリーのルートを指定する。 実際に編集するファイルと探索対象のworktreeが同じか確認する。

Tree-sitter/FFSの対応言語・索引範囲によっては、Svelte markupや無名callbackを
symbolとして取得できない。結果ゼロを「実装がない」と扱わず、 `ffs grep` / `rg -n -F`
と周辺読取りへ切り替える。 hashlineも呼出しディレクトリだけでは内容Hashは変わらないが、
古いアンカーを永続参照として使わず、対象特定後に再読取りする。

## 4. 優先1: commandを移行する

### 4.1 移行対応表

元のcommand契約（照合commit
`a5478fba21617c20a846ef913df08f37d0438a64`の`tests/command_ui_contract_test.ts`。 履歴内容は
`git show a5478fba21617c20a846ef913df08f37d0438a64:tests/command_ui_contract_test.ts`
で参照）の全4テストを次の単位に分解する。
以下の移行先story/spec名は、既存と明記していないものは追加候補。

| 元の範囲           | 意味的契約                                                                             | 移行先・確認内容                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L5、L12、L28の各ID | 各入口が共通availability/dispatchを使う                                                | `tests/command_service_test.ts` と `vitest/command_execution_controller.test.ts` を再利用。quickCapture/hoist/addBookmark/saveRevision/createLinkごとにAppの入口と観測結果を台帳化し、unitだけでApp配線済みとはしない   |
| L13–18             | editable判定、chordの優先処理、重複shortcut検証、listener寿命。旧独自shortcutの排除    | serviceのshortcut unit、adapter unitを再利用・補完。capture登録/解除の同一handler確認、chordが処理した場合のdispatch停止、IME/repeat/modal抑止を検証。Appの旧コードがないというassertは実操作で重複実行しないことへ置換 |
| L37、L41           | Ctrl+Kで開き、入力に応じた一覧を表示                                                   | 新規 `tests/ui/command-palette.spec.ts`。実入力で絞り込み・ゼロ件・query消去・再open時リセット。純粋filter規則は既存 `tests/command_palette_test.ts` を維持                                                             |
| L42–43             | disabled理由を表示し、実行しない                                                       | Storybookのdisabled理由/title、click/Enterでcallbackゼロ。service/Controllerもdisabled時operationゼロ。Appでは対象RPCが発火しないことを確認                                                                             |
| L44                | close後に元の入力へfocusを戻す                                                         | Playwrightでeditorからopen→Escape/外側click/toggle close→元editorのfocus確認。既存focus adapter unitのreopen/dispose競合保証も維持                                                                                      |
| L45、L49           | Paletteではsnapshot未指定のsaveRevisionを実行できず、履歴からは明示payloadで実行できる | 既存palette/service unit + execution Controller unitにsnapshot有無の正負ケース。履歴ボタンのPlaywrightで指定snapshotが正しいRPC引数になることを確認                                                                     |
| L57–61             | Paletteはshortcut入口で表示し、overlayから閉じられる。専用常設ボタンは作らない         | Storybookで外側click→close callbackとDOM消失。PlaywrightでCtrl+K起動と常設Paletteボタン不存在をrole/nameで確認。コンポーネント名・overlayタグ名自体は固定しない                                                         |
| L82–89             | createBranchは確認dialogを経由し、空白のみの名前では確定しない                         | `stories/confirmation-dialog.stories.ts` のRewriteを拡充。初期focus、空白入力でbutton/Enter無効、有効名で確定。Playwrightでcommandからdialogへの接続、Cancel時RPCゼロ                                                   |
| L90–97             | 確認済みrewriteだけAPIを呼び、返ったbranch/placementへ正しいnavigationを行う           | `vitest/branch_rewrite_navigation.svelte.test.ts` を再利用・不足分追加。成功/取消/失敗/古いoriginを区別し、引数と移動先をassert。App配線はPlaywrightで確認                                                              |
| L98–99             | rewrite入力の初期focusとEnter確定                                                      | 同じConfirmation storyで実キー入力とcallback回数をassert。callbackは引数なしなので、名前の転送はAppのRPC引数で確認。focusはソース検査に戻さない                                                                         |
| L100–107           | payloadありcreateLinkは作成、なしなら関係editorを開き検索inputへfocus                  | execution Controller unitでpayload転送。新規 `tests/ui/command-palette.spec.ts` 等でPalette→Link editorとfocus、実フォーム確定→RPC引数を検証                                                                            |
| L108–111           | rewriteAsNewBranchのAPI/binding公開・desktop委譲                                       | 型チェックに加え、既存binding登録テストを探索して委譲先と引数を実呼出しで保証。なければ登録関数の最小port fakeによるunitを追加。mockブラウザのRPC interceptionだけではdesktop委譲の証明にしない                         |

主要な既存unit: [service](../tests/command_service_test.ts#L25)、
[palette](../tests/command_palette_test.ts#L24)、
[execution](../vitest/command_execution_controller.test.ts#L14)、
[keyboard/focus adapter](../vitest/global_keyboard_adapter.svelte.test.ts#L21)、
[branch navigation](../vitest/branch_rewrite_navigation.svelte.test.ts#L7)。
既存assertが契約を満たすなら追加せず、台帳へそのtest名を記す。

### 4.2 実装順序

1. 既存 `stories/command-palette.stories.ts` を拡充する。
   - Default/EnterExecutesは呼出し回数だけでなく**選ばれたcommand**もassert。
   - ArrowLoop/DisabledSkipはinputのfocusを明示し、選択と実行結果を確認。
   - disabled理由、disabled click、disabledのみの一覧でEnter無効を追加。
   - queryの入力bindingをharnessで確認する。実際のfilter接続はPlaywrightへ。
   - Escapeに加え外側clickのcloseを追加し、controlled openを更新したDOM消失も確認。 Portalは既存通り
     `within(canvasElement.ownerDocument.body)` で検索する。
     外側clickは[Confirmation storyの実座標pointer](../stories/confirmation-dialog.stories.ts#L19)
     を参考に、content外を確実にクリックする。
2. `tests/ui/command-palette.spec.ts` を新設し、§4.1のApp接続・focusを追加する。
   既存a11yの「Ctrl+Kで開ける」だけを再実装して終わらない。 global
   shortcutは実キー操作、RPCは既存suiteと同じ `page.route` で観測する。
   独立したspecを使い、巨大な既存screen-navigation specへ追加を集中させない。
3. editable inputで文字キーを奪わないこと、modal表示中の無関係shortcut抑止、
   commandを一回だけ実行することをadapter unitとbrowserで分担する。
   **Ctrl+K自体をeditable中に禁止する仕様へ変えない。**
   App全体の連携を証明するケースではDOM/状態/RPCの結果までassertする。
4. Confirmation story、Controller unit、binding unitの不足を埋める。 模擬portを使うunitとnative
   focus/DOMを使うbrowserを取り違えない。
   rewriteの確認dialog自体のCancelと、作成済みbranchへの移動を止める未保存入力guardの
   Cancelは別契約。後者で完了済みAPI書込を巻き戻す期待にしない。
5. 新しいテストが、対応する配線・guard・callbackを意図的に壊すと失敗するか局所確認する。
   一時変更は必ず戻す。元assertionとの対応が埋まり、関連suiteが通ってから
   `tests/command_ui_contract_test.ts` を削除する。

## 5. 優先2: themeを移行する

### 5.1 移行対応表

| 元theme契約（`git show 259bdb9d7a923862f8a7332a11f52aebc6cd9159:tests/theme_ui_contract_test.ts`で履歴参照）の範囲 | 意味的契約                                                    | 移行先                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L17–25                                                                                                             | accessibleなDark/Auto/Light選択、現在値の表示                 | 新規 `stories/theme-switcher.stories.ts`。各初期値で `aria-pressed`、click callbackの値、キーボード操作を検証。harnessでcontrolled propsを反映                                                     |
| L27–32                                                                                                             | TopBarからテーマを変えられ、選択表示が読める                  | 新規 `tests/ui/theme.spec.ts` でTopBarの各buttonを実操作。CSS変数名やコンポーネント配置文字列は固定しない。右上配置まで契約として維持するなら既存visual suiteを確認し、小さい幾何/visual検証を追加 |
| L34–39                                                                                                             | Option表示設定から変更でき、値を検証する                      | `stories/options-view.stories.ts` にtheme props/callbackとselect操作を追加。AppでTopBarとOptionの双方向の表示整合をPlaywrightで確認。不正値は既存schema/unitへ                                     |
| L41–48                                                                                                             | Light/Darkで意図した見た目のtokenが適用される                 | Playwrightで実要素のcomputed color/backgroundと実DOM属性を確認。正確な色値を維持する必要があるassertionだけ期待値を残し、CSS宣言位置や表記を固定しない                                             |
| L50–57                                                                                                             | 初期化・保存・再読込・system listenerとcleanup                | 既存theme preference/Controller unitを拡充 + App Playwright。listener callbackと解除spyを実際にassertする                                                                                          |
| L59–77                                                                                                             | Light確認dialogの本文/補助文が背景に対して4.5:1以上           | Lightで実dialogを開くa11yケースを追加。axeに加え、実表示の本文/補助文と背景のcomputed colorsによる比率assertで元の両組合せを保証。CSS sourceの正規表現抽出は削除                                   |
| L79–88                                                                                                             | DarkのTopBar、view switcher、検索結果/section、buttonが読める | 明示Darkで該当UIを表示しcomputed style/a11yを確認。旧selector内に同じCSSがあることは契約にしない。見た目の厳密保存が必要な箇所だけvisualで補完                                                     |

既存再利用:
[preference unit](../tests/theme_preference_test.ts#L17)はschema・保存失敗・fallback・theme適用を検証済み。
[Controller unit](../vitest/theme_controller.svelte.test.ts#L19)は初期値・保存・初期適用を検証済み。
fake documentへの適用unitを実ブラウザのDOM保証の代用にしない。

### 5.2 browserシナリオ

`tests/ui/theme.spec.ts` に次の独立ケースを追加する。

1. 保存なしで起動: Autoのみpressed、`html[data-theme="auto"]`。
2. Dark/Light/Autoを実click: pressedが一つだけ、document属性、
   `localStorage["radiora.themePreference"]` がそれぞれ一致する。
3. 各値を選んでreload: 同じ選択とDOM適用が復元される。 保存値を毎navigationで上書きする
   `addInitScript` はこのケースに使わない。
4. Autoで `page.emulateMedia({ colorScheme: "light" })` → `"dark"` → `"light"`:
   data-themeはautoのまま、実表示色が各テーマへ変わる。固定sleepではなくpoll/locatorで待つ。
5. 明示Dark/LightでOS設定を反転: 選択と見た目が変わらず、保存値も変わらない。
6. TopBar→Option、Option→TopBarの変更: 同じpreferenceが表示され、
   画面往復で別のownerやwriterができていない。
7. 不正保存値から起動: Autoへfallbackして操作可能。 storageアクセス拒否の網羅は既存unitで担保する。

実DOMにテーマを直接setして終えるテストは選択・永続化の保証に数えない。
story内でdocumentテーマを変更する場合だけは開始前のdataset/styleを保持し、
story終了時に元へ戻す。localStorageやmediaのtest間漏れも避ける。
Appの永続化・OS追従はisolatedなPlaywright pageで検証することを優先する。

### 5.3 色・可読性と削除順序

1. 既存Light Outline文字色テストを維持し、 `tests/a11y/app.a11y.spec.ts`
   へLight確認dialogのケースを追加する。
   初期画面のaxeだけでは、閉じたdialogや未表示の補助文は検査されない。
2. 本文/補助文の4.5:1検証では実際に見えている要素・背景を使う。
   透明背景は背面色まで合成する。必要な色計算helperはtest側に置き、
   純粋計算には既知色のunitを付ける。CSSをTSへ移すようなproduction再設計はしない。
3. 正確なhex値の固定と可読性保証は分ける。
   旧assertionごとに「computed値へ置換」または「色の完全一致を廃止し可読性へ置換」
   の理由を台帳に記録する。色を無断で変えてテストを通さない。
4. Controller unitでAuto時だけsystem callbackから再適用されること、
   explicit時に再適用しないこと、cleanupで解除されることを追加確認する。
5. §5.1の対応が全て埋まり、新規・既存browser/unitが通ってから `tests/theme_ui_contract_test.ts`
   とそのローカルcontrast関数を削除する。

## 6. 残る19ファイル: 棚卸しと段階移行

下表は現行test名・検査対象に基づく**一次分類**。
各着手時にassertion本体と既存coverageを照合し、§3の台帳へ落とす。
ファイル名だけで全assertionを同じ移行先へ振らない。
「静的候補」は残す決定ではなく、意図的制約かを再判断する対象。

| 対象 `tests/`                              | 壊れやすさ・重複の主因                               | 移行候補・単位                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `context_menu_ui_contract_test.ts`         | command配線・破壊操作・View抽出文字列がcommandと重複 | 既存context-menu storyを再利用。右click/Shift+F10、editable除外、Appから確認/実行はPlaywright。command unitへ統合              |
| `inspector_tabs_ui_contract_test.ts`       | Bits固有props・markup・親からの委譲表記              | Tabキー/矢印操作と自動activationをbrowser化。layout ownerとdeprecated modeはunit、履歴revision切替はApp spec                   |
| `outline_filter_bar_ui_contract_test.ts`   | bind表記、`$derived`名、CSS配置を固定                | filter入力/解除disabledはstory、Today/Unplacedの表示反映はPlaywright、filter計算はunit。共通View使用/CSS ownershipだけ静的候補 |
| `options_ui_contract_test.ts`              | navigationとTopBar非重複検査が複数fileに分散         | 既存options/primary-navigation story + screen-navigation spec。管理画面到達と重複入口なしを意味的に統合                        |
| `omniwindow_ui_contract_test.ts`           | private field名、Rune記法、CSS/レイアウトを大量固定  | 既存omni-lifetime/layout spec、Omni controller unit、navigation story。検索/作成、sidebars、editor見た目を別単位へ             |
| `browsing_navigation_ui_contract_test.ts`  | App関数切り出しとdelegation表記に依存                | 既存navigation/selection/outline unitとscreen-navigation/focus spec。非永続化/guard/receiptはunit、API直接依存禁止だけ静的候補 |
| `date_projection_ui_contract_test.ts`      | Today表示とservice非mutation、CSSが混在              | 既存date-projection-navigation specとdate projection unit。created/updatedの表示分離をbrowserへ                                |
| `unplaced_inbox_ui_contract_test.ts`       | View/Controllerの構造とmutation配線を固定            | 一覧操作をstory/App spec、mutationをcontroller unit、View直接I/O禁止は静的候補                                                 |
| `quick_capture_ui_contract_test.ts`        | 到達性・Options設定・inbox APIが他fileと重複         | quick capture設定と作成先をApp spec、work controller unitへ。unplaced移行と共通coverageを一つにする                            |
| `tag_browser_ui_contract_test.ts`          | view mode、navigation、CSSの固定                     | タグ一覧→対象表示をApp spec、projection/controllerをunit                                                                       |
| `stub_ui_contract_test.ts`                 | bindings公開と暗黙解決禁止が表示テストに混在         | 明示解決操作をbrowser、編集中に解決APIを呼ばないことをunit。直接I/O禁止は静的候補                                              |
| `duplicate_candidates_ui_contract_test.ts` | App/desktop/Controller配線、read-only制約が混在      | 既存duplicate-candidates story、controller unit、明示merge/link/dismissのApp接続。read-only依存は静的候補                      |
| `emergence_suggestion_ui_contract_test.ts` | vocabulary表記と明示操作保証が混在                   | 操作・表示はstory/App spec、accept/rejectと副作用は既存emergence controller unitへ                                             |
| `internal_reference_ui_contract_test.ts`   | completion/caret/navigationと非semantic制約が混在    | native入力・caret・backlinks navigationはPlaywright、補完/非semantic graph変更はunit                                           |
| `inline_link_ui_contract_test.ts`          | completion実装名と検索/種別/方向/未解決作成を固定    | 実入力→候補選択→方向/種別/作成をPlaywright、検索/解決はunit。internal-referenceと共通入力fixtureを必要範囲で再利用             |
| `link_editor_ui_contract_test.ts`          | GUI配線とstorage直接アクセス禁止が混在               | GUI操作・focusはbrowser、検索/保存/世代はcontroller unit。直接storage依存禁止だけ静的候補                                      |
| `markdown_export_ui_contract_test.ts`      | flush barrier、Options表示、download構造の固定       | 既存file-io specとfile_io_controllers unitを再利用、Options storyで設定。scope/参照形式等は既存純粋unitへ                      |
| `opml_ui_contract_test.ts`                 | binding/vocabularyとfile選択・UTF-8が混在            | file-io specで実file input/download、controller/binding unitで引数・失敗。取消と未選択も確認                                   |
| `json_backup_ui_contract_test.ts`          | flush順序、desktop委譲、成功後reloadを文字列で固定   | file-io spec + controller/binding unit。restore失敗時reloadしないことも観測                                                    |

推奨順序:

1. command/themeと保証が重複するcontext menu、options、Inspector、filter bar。
2. navigation/OmniとToday/Unplaced/quick capture/tagの画面連携。
3. Stub/duplicate/emergence、補完/link editor。
4. file I/O三種を既存実操作coverageと照合して統合。

一つの移行単位は「同じ契約の代替テスト追加→成功→対応assertion削除→再検証」。
同じファイルを複数PRで縮小してよい。19ファイル一括削除や汎用テストDSLの作成はしない。

### 静的検査として残す条件

- 制約の目的を「Viewはstorageを直接使わない」など観測可能な境界として説明できる。
- 対象パスと禁止依存/操作を限定し、変数名・空白・関数の配置を固定しない。
- 既存のlint/Opengrepで表現できるなら再利用する。AST基盤や新依存を先に増やさない。
- 新規ファイルなら例として `tests/ui_architecture_contract_test.ts` のように目的を明示する。
  名前を変えただけで元のUI文字列検査を移すことは認めない。
- unitで偽APIへの呼出し有無を確認できる制約は、まずその方法を優先する。

## 7. blank click / deselectの既存保証と不足

削除除外の2ファイルはそのままにし、次の既存coverageを再利用する。

- [Treeのnative mouseケース](../tests/ui/tree-interaction.spec.ts#L15):
  背景clickで選択解除し、SVGへfocusが移る。
- [Outline dragケース](../tests/ui/outline-drag.spec.ts#L54):
  drag中/右buttonでは解除せず、終了後の左mousedownで解除してeditor focusを外す。 ただしrowに
  `dispatchEvent` しており、通常の空白座標をnative clickする保証とは別。
- [選択Workspace unit](../vitest/occurrence_selection_workspace.test.ts#L212):
  guardを受理してからfocusを解放する契約。

不足分は[Outline native blank-click spec](../tests/ui/outline-blank-click.spec.ts)として追加した。
rowのblank部分、rows containerのblank部分、editorをそれぞれnative `page.mouse.click`し、
選択解除・editor blurまたは保持を確認する。座標は対象bounding boxから取得し、
`elementFromPoint`でrow/rowsが実際のhit targetであることをassertする。rows containerは現在
内容高にshrink-wrapするため、container blank coverageではtest内だけ `min-height` を設定し、
container自身がhit targetになる空白を作る。production
state/DOMへ直接書き込まず、dispatchEventも使わない。
既存unitが証明するguardの組合せをbrowserへ無制限に複製しない。

## 8. 検証コマンドとPR完了判定

### 開発中の絞った実行

追加ファイル名は本書の候補名で実装した場合。別名を採用したらコマンドと台帳も更新する。

```sh
deno test -A tests/command_service_test.ts tests/command_palette_test.ts tests/theme_preference_test.ts
npm run test:svelte -- vitest/command_execution_controller.test.ts vitest/global_keyboard_adapter.svelte.test.ts vitest/branch_rewrite_navigation.svelte.test.ts vitest/theme_controller.svelte.test.ts
npm run test:storybook -- stories/command-palette.stories.ts stories/confirmation-dialog.stories.ts stories/theme-switcher.stories.ts stories/options-view.stories.ts
npm run test:ui -- tests/ui/command-palette.spec.ts tests/ui/theme.spec.ts tests/ui/outline-drag.spec.ts tests/ui/tree-interaction.spec.ts
npm run test:a11y -- tests/a11y/app.a11y.spec.ts
```

追加したbinding test、contrast helper unit、native blank click specが別ファイルなら、
それらも該当コマンドへ追加する。表示されたtest数を確認し、対象ゼロの成功を認めない。

### 最終ゲート

[verifyの定義](../deno.json#L42)にはStorybook/Playwrightが含まれないため、別々に実行する。

```sh
deno task verify
npm run test:storybook
npm run test:ui
npm run test:a11y
git diff --check
```

visualを変更・追加した場合のみ `npm run test:visual` も実行し、
baseline更新は人が差分を確認してから行う。 Playwright設定がmock Vite serverを起動するため、Storybook
serverの手動起動は不要。 ポート4173に別serverがあると再利用される設定なので、検証対象を確認する。

### PRに残すチェックリスト

- [x] 削除した全assertionを台帳に記録し、移行先のtest/story名と契約を対応付けた。
- [x] UI操作はStorybook/Playwrightで、pure/Controllerはunitで保証した。
- [x] 新しい静的検査は追加せず、残る19 source suitesは棚卸し済みの後続範囲として記録した。
- [x] command/themeのUI文字列検査を解消した（優先2ファイル削除）。
- [x] 残る19ファイルの棚卸し、今回移行した範囲、後続範囲を記録した。
- [x] 除外2ファイルを削除・変更していない。blank clickの既存保証とnative追加分を記録した。
- [x] callback/RPCを壊す局所確認で新テストが失敗し、一時変更は戻した。
- [x] 最終ゲートの実行環境・コマンド・成功/失敗を記録した。
- [x] 未実行/環境依存の項目を「成功」と記載していない。

このゲートまででIssueの優先移行を完了とし、無関係なproduction整理へ広げない。
完了報告ではこのワークツリー/PR上の完了とmainへの反映を区別する。

## 9. 本書作成時の確認状況

- 実施: 現行ソース、優先2ファイル、既存story/unit/spec、実行設定、
  残る19ファイルのtest名・検査対象の照合。
- 当時未実施: 本書の移行作業、アプリテストの実行、全suiteの成功確認。現在の累積状況と
  最終ゲート結果はStage 1–6の記録を参照する。
- 作成環境には `node_modules` がなく、NodeはCI指定版とも異なる。
  実装開始時に§3の環境準備と変更前ベースラインを行う。

## 10. Stage 1 実施記録（2026-10-12、親承認済み・積み上げ内）

### 照合基点・範囲

- 元計画の歴史的照合基点 `a5478fba21617c20a846ef913df08f37d0438a64` は変更しない。
- Stage 1 開始時の再照合HEADは `259bdb9d7a923862f8a7332a11f52aebc6cd9159`。
- 対象は§4.2 step 1に限定。`stories/command-palette.stories.ts` と
  `stories/CommandPaletteDialogHarness.svelte` を変更し、query bind不具合を直す最小修正として
  `src/ui/CommandPaletteDialog.svelte` のcustom inputへ `bind:value={query}` を追加した。
  App、`tests/command_ui_contract_test.ts`、除外2ファイルは変更していない。
- `CommandPaletteDialog.svelte` は `shouldFilter={false}` であり、既存`Filtering`
  の絞り込み済みpropsは引き続き一覧表示だけを確認する。全体filter/App配線保証ではない。

### 追加・強化した操作契約

| story                             | 意味的契約・確認内容                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `Default`                         | 初期focusから矢印選択後Enterで、callbackが一度だけ `commands[0]` を受け取る         |
| `EnterExecutes`                   | 初期focusのEnterで選択command identityと一度だけのdispatchを確認                    |
| `ArrowLoop`                       | 明示focus、Up/Down wrap後に選択された `commands[0]` が実行される                    |
| `DisabledSkip`                    | 明示focus、disabled項目を飛ばした選択と実行command identityを確認                   |
| `DisabledReasonDoesNotExecute`    | disabled項目のnative click・Enterでdispatchせず、`title` に理由を表示               |
| `DisabledOnlyEnterDoesNotExecute` | disabled-only listでEnterしてもdispatchしない                                       |
| `EscapeCloses`                    | Escapeでclose callbackとcontrolled harness配下のdialog DOM除去を確認                |
| `OutsidePointerCloses`            | portal上でdialog外のoverlay座標へpointer操作し、同じclose契約を確認                 |
| `QueryBinding`                    | 初期query→input、clear/入力→harness queryを確認。取り除くnegative controlで回帰検出 |
| `Filtering`                       | prefiltered propsの表示だけ。filter実装やApp連携の証明とはしない                    |

`CommandPaletteDialogHarness` はopen/queryのstory-local owner。初期queryは `initialQuery` から作り、
close callbackでopenをfalseにし、 実DOM除去を観測する。Appのquery→projection→一覧更新はStage 2
Playwrightに残す。 旧source-contract
testsはまだ削除しておらず、assertion単位の全面移行台帳も未完了。

### ベースライン・実行結果

開始時環境: Node `v25.2.1`（CI指定22ではない）、Deno `2.9.7`（CI指定2.9.3）、 `npm ci`
成功。変更前focused Storybookは1 file / 7 tests passed、全Storybookは 11 files / 42 tests
passed。変更前の`npm run check`も0 errors / 0 warnings。

- 変更前 `deno task verify`: 失敗。Windows上で `deno task lint` がBiomeにrootの絶対パスを渡し、
  `No files were processed` となった。成功扱いにしない。
- その後、`127.0.0.1:4173` の既存serverが別checkout `Radiora-p5-merge` 由来と判明した。 よって変更前
  `npm run test:a11y`（6/1）と `npm run test:ui`（120秒停止）の結果は このcheckoutのApp
  baselineとして無効。前者のoverlay原因を本checkoutの不具合と断定しない。 `deno task verify` のBiome
  path失敗はserverを使わないため、この訂正の対象外。
- QueryBindingの修正前focused testは失敗し、初期query `"initial"` がinput valueへ反映されなかった。
  custom inputへの `bind:value={query}` 追加後、初期値、clear後の空値、入力 `"today"` のharness
  query反映がpass。 bindingを一時削除するnegative
  controlでは同じtestが初期値assertionで失敗し、直後に復元した。
- `OutsidePointerCloses`の初回失敗はstory単独実行でも再現。temporary event instrumentationで
  `userEvent.pointer` のpointerdown/upはwindow/documentのcapture/bubbleへ全て到達し、
  `clientX/Y=(1,1)`、`button=0`、`pointerType=mouse`、`defaultPrevented=false`、 composedPath先頭が
  `DIV.command-palette` と判明。イベント時の`bitsDismissableLayers`は空だったため、
  Dialogが描画・input
  focusした直後に合成pointerを投げると、DismissibleLayerの`afterSleep(1)`登録前に
  イベントが発生していた。callback待機だけでは後から回復しない。
- インストール済みVitest Browser Playwright providerのnative
  `page.elementLocator(...).click({position})` APIも対照確認に使用。native action時はactive
  layerが1件あり、behavior=`close`、refはdialog、 responsible
  layerも同dialogで、callbackとDOM除去が起きることを観測した。
- ただしnative APIは`vitest/browser`からのimportが通常Storybook実行時に評価エラーとなる。
  最終storyではそのimportを使わず、公開Storybook interaction APIでinputをclickしてからoutside座標へ
  `userEvent.pointer`を投げる実操作列にした。固定sleep/internal layer依存なし。通常Storybook devの
  preview iframeでも対象story playがdialogをadd/removeし、pageerrorなしをPlaywright smokeで確認。
  一時layer/event診断は全て撤去済み。production close挙動は変更していない。
- 修正後focused Storybook: 11 passed / 0 failed。
- 修正後全Storybook: 11 files / 46 passed / 0 failed。
- `npm run build-storybook`: 成功。Storybook dev runtime smoke:
  `/iframe.html?id=navigation-commandpalette--outside-pointer-closes&viewMode=story`
  を実browserで開き、`コマンドパレット` dialogのadd→remove、pageerror 0件を確認。
- `npm run check`: 0 errors / 0 warnings。Biome focused check、`git diff --check`はpass。
  `deno test -A tests/command_ui_contract_test.ts`: 4 passed / 0 failed。 変更したsource/story
  filesの`deno fmt --check`はpass。計画書も含む全体checkは元計画の既存書式差を
  報告したため、広範囲の自動整形はしていない。
- negative control: harnessのexecute callbackを一時的にclose callbackへ差し替え、 `Enter Executes`
  だけを実行して0-callで失敗することを確認。直後に元の`{onExecute}`へ復元。
- Spy隔離:
  `QueryBinding`で、先行storyの操作後にも`onExecute`/`onClose`が未呼出しであることをassertし、
  Storybookのstoryごとのspy状態リセットを実行結果で確認した。

### 次の境界

Stage 1は親承認済みの積み上げ変更だが、Issue完了でもmain landingでもない。Stage 2の
Playwrightと残るStage 3契約を別記録に残す。Stage 1 storyやunitをApp integration保証とは数えない。

## 11. Stage 2 実施記録（2026-10-12、親承認済み・積み上げ内）

### 範囲・照合基点

- Stage 2は§4.2 step 2と、同じApp shortcut/focus経路に限る。 Appのquery owner、command
  service/controllerの設計変更、source-contractファイル削除はしない。
- `playwright.a11y.config.ts` をserver endpointのsource of truthとして
  `RADIORA_UI_PORT`（unset時4173）を導入。明示port時は `reuseExistingServer:false`。 UI
  configは同configを継承する。baseURLとwebServer command/urlは同じvalidated integerから導出し、 raw
  environment stringをshell commandへ渡さない。empty/non-decimal/out-of-rangeはconfig load時に拒否。
  default/CI/explicit 4173+4174/reuse policyは`vitest/playwright_port_config.test.ts`で検証する。
- `tests/command_ui_contract_test.ts` は維持し、旧static assertion `await paletteFocus.restore()`
  だけを、新しいApp/View session+adapter APIに合わないため削除。 そのclose/focus保証はbrowser
  specとadapter unitに移し、残りのsource contractsはStage 3で整理。

### assertion対応

| browser spec / assertion                                                                                          | 旧契約・追加保証                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/ui/command-palette.spec.ts` / `Ctrl+K opens the real palette and its query filters the command projection` | `command_ui_contract_test.ts` L37–45のquery projection/disabled guardとL57–61のshortcut-only・常設button無しを、Appを開いてinput→絞込1 option→zero status→clear→再open resetで確認。App filterは`commandPaletteItems`のquery由来、Storyのprefiltered propsとは別保証 |
| 同spec / `closing the palette with ... restores the editor focus and caret`                                       | 旧L44のfocus restore assertionとL57–61のclose経路。Escape、overlay native click、Ctrl+K toggle各々でdialog除去、元editor textarea/host identity・selection rangeを確認                                                                                               |
| 同spec / `executed command focus takes precedence over the closed palette return target`                          | close→commandのfocus順序。`createLink` palette commandで関係tabと検索inputへfocusし、古いeditor復帰が上書きしない                                                                                                                                                    |
| 同spec / `palette command executes through App and disabled command exposes its reason without an RPC`            | L3–29、L41–45に対し、App Paletteから`createBookmark`のRPC引数と反映UIを確認。復元ポイント未指定の`saveRevision`はreasonを表示、disabled、promotion RPCなし                                                                                                           |
| 同spec / `unrelated global shortcut is suppressed while the palette is open`                                      | L13–18、L37–45に対し、Ctrl+Kをeditor focus中に許可し、通常文字入力を保持。Palette表示中のCtrl+Shift+H/Bで遷移やbookmark RPCを起こさない                                                                                                                              |

### focus根因・修正

- 4173の他checkoutではなく、4174で当checkoutを起動したbaseline
  specでEscape後に`document.activeElement` が`body`となる失敗を再現。元editor
  textareaがopen直前activeで、close後も同じnode/hostがconnectedだった。
- 計測順: Palette openでbits inputへfocus、textarea
  blurにより`MarkdownEditor.handleBlur`がpreviewへ切替、 元textareaのcomputed `display`
  が`none`になる。Dialog close時に直接`.focus()`してもhidden textareaはfocus不能。 FocusScope
  distはunmount時にcleanup後`onCloseAutoFocus`をdispatchし、preventDefaultしなければpreFocusMemoryへfocusする。
- Appはopenごとのimmutable `PaletteFocusSession` を作成する。keyed `Dialog.Content` はそのsessionに
  固定されたclose handlerを使い、old close Aが後から呼ばれてもmutable current session
  Bを参照しない。 close handlerは常に`preventDefault`し、current session
  identityが一致するときだけfocusを復元する。 無効・取消・dispose済みsessionはlibrary
  defaultにも復元させず、sessionのwait promiseはcancel/disposeでもresolveする。
- AppのPalette focus adapterを唯一のclose focus ownerにし、Dialog
  `onCloseAutoFocus`でBits標準復元を止める。 adapter sessionはopen前の実editor hostとtextarea
  identity、selectionStart/end/direction、textarea scrollを捕捉し、 同一connected
  hostへ既存`radiora:focus-editor` operationをdispatch、その後同一textareaのrange/scrollを
  値長にclampして戻す。一般input等は元targetを直接focus。切断・reopen・dispose済みrequestでは
  古いtargetを使わず、同じitem IDの別hostもqueryしない。
- 一時microtask案はtextareaがhiddenである根因を解消しないため撤去。timer/rAF回避なし。 非collapsed
  selectionと同一host/textareaをbrowserで検証。command実行後の別input focusも別caseで確認。
- `command_palette_controller` query bindingは壊れておらず、当初のlocator誤認を診断で分離した。
  Query setter/getter=`栞`、`commandPaletteItems` result=`[栞]`、DOM visible option 1件だった。 Bits
  `Command.Item`の実accessible roleは`option`であり、`button`
  locatorが失敗した。production変更なし。

### 実施結果・負債

- `RADIORA_UI_PORT=4174 npm run test:ui -- tests/ui/command-palette.spec.ts`: 7/7 pass。 env
  varはそのcommand processに限定。`4173`の別checkout
  serverは停止・変更せず、configファイルの一時編集もなし。
- `RADIORA_UI_PORT=4174 npm run test:ui -- tests/ui/screen-navigation.spec.ts tests/ui/outline-focus-adapter.spec.ts tests/ui/app-lifetime.spec.ts`:
  48/48
  pass。`RADIORA_UI_PORT=4174 npm run test:ui -- tests/ui/command-palette.spec.ts --grep "closing the palette"`:
  3/3 close paths pass（追加repeat）。
- `RADIORA_UI_PORT=4174 npm run test:ui`: 全126/126 pass（5.1 min）。
- `RADIORA_UI_PORT=4174 npm run test:a11y`: 7/7 pass。 `npm run test:storybook`: 11 files / 46
  pass。 `npm run build-storybook`: 成功。最初のStorybook試行は依存が親checkout配下から解決されVite
  allowlistで 失敗したため、worktree内で `npm ci`（448 packages）後に再実行し成功。`npm ci`表示は12
  advisories （8 moderate / 4 high、依存更新は未実施）。
- `npm run check`: 0 errors / 0
  warnings。`npm run test:svelte -- vitest/global_keyboard_adapter.svelte.test.ts vitest/playwright_port_config.test.ts`:
  2 files / 15 tests pass（editor session token、late A/B close、dispose/default suppression、editor
  identity/disconnect、 clamp/backward selection/scroll、port
  config）。`deno test -A tests/command_ui_contract_test.ts`: 4/4 pass。 Biomeの変更file checkは
  exit 0、既存`App.svelte:handleKeydown` complexity warning 1件（score 21）のみ。
- `deno task verify`: Windows上で `deno task lint` がBiomeにworktree絶対pathを渡し、
  `No files were processed`
  で失敗。`deno fmt --check`（変更source/spec/unit）と`git diff --check`はpass。
- Negative control: App query setterを一時的に `setQuery("")` へ壊し、filter specが期待1
  optionに対し 21
  optionsで失敗することを確認。setterを元の`setQuery(value)`へ戻し、直後の正規suite/full
  suiteはpass。
- Adapter unitはnormal close、old close後のreopen/dispose、切断targetを別assertionで保証。
  `CommandPaletteDialog`のsession-keyed Contentはopen sessionだけを境界とし、input
  typing/filter中は再mountしない。 Playwrightでもinput node
  identityとfocus保持、close後のDOM除去を検証。
- 4173は別checkout `Radiora-p5-merge` の既存serverだったため停止・変更していない。 標準port
  defaultは4173のまま。再現は `RADIORA_UI_PORT=4174` を一時設定する。
- Stage 3: service/Controller/binding/rewrite confirmation・navigation/link editorの包括契約を埋め、
  全assert対応後にのみ`tests/command_ui_contract_test.ts`削除を判断する。theme stagesは別途実施。
  Issue全体、main反映、残り契約は未完了。

## 12. Stage 3 実施記録（親承認済み・積み上げ内、main未反映）

- Stage 3のassertion単位台帳は [command assertion ledger](issue-328-command-assertion-ledger.md)。
  基点 `a5478fba21617c20a846ef913df08f37d0438a64` の4 test・41 effective assertionsを列挙し、 Stage
  2で削除したPalette focus source assertionも含めてdestinationを記録した。
- 補強した境界: `CommandExecutionController`のquickCapture/hoist/addBookmark/saveRevision/createLink
  dispatch、snapshot未指定/明示payload、global keyboard editable/chord/旧Shift+L/listener cleanup、
  Rewrite confirmationの空白/Enter/focus、rewrite branch/placement/navigation/confirmed API
  payload、 実際に登録されたdesktop rewrite bindingのforwarding。keyboard
  unitでは登録済みCtrl+Shift+Hを chordがtrue/falseで受け取る両方を送り、capture listenerのhandler
  identityとcapture=trueをassert。
- PlaywrightではApp PaletteからRewrite確認を開き、初期focus後Cancelしてrewrite
  RPCがないことを追加確認。
  Rewrite成功後navigationの既存specも再利用。履歴画面のsnapshot選択→preview→保存→確認承諾→ promote
  RPCのpositive App/browser pathを追加し、snapshot ID/work ID/branch ID/`confirmed`を検証。
- `tests/ui/command-palette.spec.ts` はquickCapture App dispatchとLinkEditor payloadをbehavior
  testで確認する。
  実際の操作は`createItem`。root設定fixtureで入力値とcreate候補enabled、Ctrl+Shift+Enter、
  `createItem` payload、返却itemの`listOutline`反映とeditor描画/focusを一続きに確認した。
  一時Event計測はINPUTで`preventDefault=true` / `stopImmediatePropagation=true`を観測。
  GlobalKeyboardAdapterのwindow capture handlerがshortcutを処理するため、AppTopBarのbubble
  `onkeydown` へは伝播しない。production
  bugではなく誤った期待RPCがテスト側の原因。計測コードは削除済み。
- LinkEditorはselected Work表示、`searchItems`の`contextItemId`、候補target、relation
  type/direction/reason、 enabled candidate click、createLink RPC
  payloadとreload後のlink表示を実browserで確認した。 最終testはLinkEditor
  scope内のcandidateを押し、source/target両IDとsearch requestをassertする。 production
  bugは見つからなかった。
- `tests/command_ui_contract_test.ts` は元の41 effective assertionsを台帳へ全件記録し、 Stage
  2で削除したfocus assertionを含め全件のsemantic destination確認後に削除した。 source string
  checkは残していない。
- `npm ci` はworktree内で実行。Node `v25.2.1`、Deno `2.9.7`（CIはNode 22 / Deno 2.9.3）。 npm
  auditは既存lockfileの12 advisories（8 moderate / 4 high）を表示、dependency変更なし。
- Stage 3 focused checks:
  `npm run test:svelte -- vitest/command_execution_controller.test.ts vitest/global_keyboard_adapter.svelte.test.ts vitest/branch_rewrite_navigation.svelte.test.ts vitest/confirmation_controller.svelte.test.ts vitest/history_controller.svelte.test.ts vitest/relation_link_controller.svelte.test.ts`
  は6 files / 29 passed、Deno対象suiteは20 passed。 `npm run check`は0 errors / 0
  warnings、`npm run test:storybook`は11 files / 46 passed、
  `deno test -A src/desktop/register_bindings_test.ts tests/command_service_test.ts tests/command_palette_test.ts`
  full `RADIORA_UI_PORT=4174 npm run test:ui`は130 passed、
  `RADIORA_UI_PORT=4174 npm run test:a11y`は7 passed。
- 初回Storybook focused runはnode_modulesが親checkoutのsymlinkを解決しVite allowlistで失敗した。
  worktree内 `npm ci` 後はpass。Node `v25.2.1` / Deno `2.9.7`（CI Node22 / Deno2.9.3）、 audit
  advisories 12件（8 moderate / 4 high）、依存更新なし。
- Negative control: `GlobalKeyboardAdapter.connect`のkeydown add/remove
  captureを一時`false`に変更すると、 focused
  testが期待`("keydown", adapter.handle, true)`と実引数`false`の不一致で失敗した。
  `true`へ復元後、6-file / 29-test Vitest suiteを再実行してpass。
- `npm exec -- biome check`、対象fileの`deno fmt --check`、`git diff --check`はpass。
  `deno task verify`は前回と同じく Windows
  worktree絶対pathをBiomeが無視し`No files were processed`で停止。別コマンドのpassで代替しない。
- 親レビューのchanges requested（C1.09/C4.12実操作診断、saveRevision positive integration、
  keyboard/capture assertion強化）と台帳のexact destination名を反映し、Stage 3は親承認済み。
  承認はこの積み上げ内のみで、main landingではない。Stage 4/themeは別段階。

## 13. Stage 4: theme選択・永続化・system追従（親承認済み、積み上げ内完了）

- 範囲はtheme preference選択・保存・復元・AutoのOS追従・TopBar/Options共有。 computed
  colorのコア動作は`tests/ui/theme.spec.ts`で確認するが、contrast・a11yの移行はStage 5。
- `stories/theme-switcher.stories.ts`はDark/Auto/Lightのcontrolled初期状態、accessible group、
  aria-pressed、Enterによる実activationとHarness
  state更新を検証する。document/localStorageは変更しない。
- Options storyはcontrolled `themePreference="auto"`と実select/callbackを持つ。
  callbackだけでApp同期を主張せず、実AppのTopBar↔Options同期はPlaywrightで確認する。
- Controller unitはAutoのsystem
  callback再適用、Dark/Lightでは再適用しないこと、cleanup時のunlistenを検証する。 fake
  documentをbrowser coverageとして数えない。
- 全元assertionと移行先のexact mappingは
  [theme assertion ledger](issue-328-theme-assertion-ledger.md)。source suiteはStage
  4では削除しない。
- Stage 4は親レビュー承認済み。独立検証はbrowser 9 / Controller unit 6 / Storybook 5。
  承認と積み上げ内完了であり、main反映ではない。Stage 5の色/contrast/a11y、
  全assertion確認、元suite削除はこの段階では未実施。commit/push/landingなし。

## 14. Stage 5: theme可読性・色・a11yとsource suite retirement（親承認済み・積み上げ内完了）

- 元`tests/theme_ui_contract_test.ts`は7 tests / 40 assertion source expressions / 44 effective
  executions。stable IDs、式単位のdestinationまたはretirement、 source-token
  extraction/preconditionの扱いは
  [theme assertion ledger](issue-328-theme-assertion-ledger.md)に記録する。
- Light confirmationはAppのLight controlから選択後、既存のsafe rewrite commandで実dialogを開く。
  可視main/supporting copyとeffective backgroundのcomputed style、双方4.5:1、dialogだけを
  対象にしたaxeを確認する。CSS source extractionはしない。
- Dark/lightのTopBar、view switcher、検索結果/section、search/action foregroundをApp上の computed
  stylesで確認する。検索結果は実入力で表示。コアの意図したLight bg/text/accentと active view
  switcher色をcomputed styleで固定する。
- test-only `theme_contrast.ts`はWCAG sRGB luminanceとalpha compositingを計算し、
  Chromiumで実際に観測した`color(srgb … / alpha)`を扱う。背景保証はsolid-color/alphaに限定し、
  background-image/backdrop-filterはnearest opaqueまで検査する。opacity/filter/mask/blendは
  描画全体に効くため、opaque後ろも含め評価対象の全ancestorで検出したら失敗。
  Vitestで既知比率、near-transparent順序、opaque後方のbackground効果とancestor
  subtree効果を検証する。
- Dark TopBar actionはcomputed foreground色を維持する。TopBar backdrop-filterとshell radial
  gradientが関わるため手計算contrastは主張せず、その色経路はhelperの保証外とする。
- Stage 5はa11y / UI theme / contrast unit / theme Storybook / check / targeted formatと
  rendered-color negative control後にsource suiteを削除。Production theme/stylesは変更しない。
- Stage 5は親レビュー承認済み、累積worktree内の完了のみ。Stage 6の記録は次節。
  main反映ではない。commit/push/landingなし。
- Stage 5の検証結果: `RADIORA_UI_PORT=4177 npm run test:a11y` 8 passed、
  `RADIORA_UI_PORT=4177 npm run test:ui` 141 passed（helper構造整理後にtheme 11 passedを再実行）、
  `npm run test:storybook` 49 passed、contrast/Controller Vitest 11 passed、 `npm run check` 0
  errors / 0 warnings。`deno task verify`も通過し、1,026 Deno tests、 57 Vitest files / 571
  tests、production buildを確認。buildの既存large-chunk warningは継続。
- rendered-color negative controlでは実confirmation titleへ一時CSS color overrideを加え、
  同じbrowser測定が1.165:1で4.5未満となり失敗することを確認。診断testを削除し、
  production変更は行っていない。verifyが追加した`@types/node` optional-peer関係の
  `deno.lock`差分は開始時のclean状態との差分を確認後に復元。manifest更新なし。

## 15. Stage 6: native Outline blank click、文書確認、integrated gates（親レビュー承認済み）

- 新規 [Outline native blank-click spec](../tests/ui/outline-blank-click.spec.ts) は3ケース:
  rowの空白面clickで選択解除とeditor blur、rows container空白面clickで同じ解除、 editor
  clickで選択/focus維持。全てnative `page.mouse.click`。row/rowsのbounding box由来座標を
  使い、`elementFromPoint`で狙ったsurface自身がhit targetであることを確認する。
- rows containerは現状内容高にshrink-wrapするため、rows空白ケースだけtest内で`min-height`を設定し、
  container自身への実pointer hitを作った。production state変更・event dispatchはない。
- Native negative control: rowの`handlers.deselectFromBlank(event)`を一時`preventDefault()`に
  置換すると、row testが`aria-selected=false`に対し`true`のまま失敗した。変更は復元し、
  `OutlineRowItem.svelte` / `OutlineView.svelte`のdiffがないこととnative 3ケースpassを再確認。
- focused regression: blank-click / drag / Tree / command Palette / theme specは34 passed。
  `occurrence_selection_workspace.test.ts`は24 passed。
- Final integrated gates（Node `v25.2.1`、Deno `2.9.7`、Windows x86_64）:

  | Command                                                         | Result                                                                     |
  | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
  | `deno task verify`                                              | pass: 1,026 Deno tests; Vitest 57 files / 571 tests; production build pass |
  | `npm run test:storybook`                                        | pass: 12 files / 49 tests                                                  |
  | `RADIORA_UI_PORT=4180 npm run test:ui`                          | pass: 144                                                                  |
  | `RADIORA_UI_PORT=4180 npm run test:a11y`                        | pass: 8                                                                    |
  | `git diff --check`                                              | pass                                                                       |
  | targeted `deno fmt --check` for edited test/docs                | pass                                                                       |
  | local Markdown link/file audit and deleted-source history check | pass                                                                       |

- Playwrightは明示port 4180でworker checkoutからmock Vite serverを起動し、既存serverを再利用しない。
  4173/4174の他checkout serverには触れていない。negative-controlを除き、統合ゲートの再試行・flaky
  failureなし。
- 最終親レビューで阻害指摘なし。親が`RADIORA_UI_PORT=4181 npm run test:ui -- tests/ui/outline-blank-click.spec.ts`
  を再実行し3 passed、command ledgerの41 IDsが全件unique、theme ledgerの44 executionsを確認した。
  `deno.lock` / package manifests / 除外2ファイル / Outline production
  filesに差分がないことも確認し、 Stage
  6は親レビュー承認済み。この承認はthread/worktree内の完了であり、main反映の許可や実施を意味しない。
- `deno task verify`は環境依存のoptional-peer
  resolutionで`deno.lock`を変更した。変更内容はゲート後の生成差分
  と特定し、反転patchで復元。開始時および復元後の`git hash-object deno.lock`はともに
  `a58b7dc7c6cca89c67c18780f84b59b3326ad70e`。`package.json` / `package-lock.json`差分なし。
- Node/DenoはCI指定のNode 22 / Deno 2.9.3とは異なり、そのversionでの実行は未確認。 automated
  a11y結果は人手のWCAG適合保証ではない。container `min-height` はnative event wiring testのための
  test-only
  fixtureであり、通常layoutにblank領域があることの証拠ではない。main未反映、commit/pushなし。
