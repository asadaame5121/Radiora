# v3 品質ゲートとmise/CI移行

決定日: 2026-10-31。状態:
品質方針を採用。mise入口・版固定、Rust基本lint/CI、workflow検査をローカル実装。 追補:
ユーザーは本計画の推奨方針を採用し、普段用の --staged テストを追加する判断を行った。
Q1の実装と検証範囲は§7、Q2〜Q5は§8に記録。GitHub実行・Q5完了とは区別する。
検証内容は[検証対応計画](v3-verification-plan.md)、依存は[製品Rust依存](v3-rust-dependencies.md)。

## 1. 入口と責務

総合チェックは mise run verify とする。CIも個別toolの長いcommandをYAMLへ複製せず、同じmise
taskを呼ぶ。 miseはtask graphと実行を担い、Cargo/npmの依存解決や各lintの設定を置き換えない。
checkは非破壊。formatter --write、unsafe fix、baseline更新、snapshot更新は別の明示操作とする。

今回のmise.tomlは移行用で、verify:legacy（既存deno task verify）とverify:rustを集約する。

普段の選択実行は mise run test --staged。引数なしはstaged/unstaged/untrackedを含むchanged選択。
既存のtest:staged/test:changedとの互換を維持し、frontendの選択/fallbackを再利用する。
Rust/Cargo/.cargo設定の変更は依存先を取りこぼさないよう全製品workspaceのtest/doctestを実行する。
選択が不明な非文書変更は全runnerへfallbackする。選択テストは総合verify/CIの代替にしない。
--stagedはindexの変更パスから選び、現在の作業ツリーで実行する。indexのsnapshotを試験する保証はしない。
自動stashやindex書換えは行わない。stagedなし/文書のみは対象なしと表示する。
verify:rustはfmt→Clippy→test/doctestを順に実行し、Cargo同士の無用な並列競合を避ける。
verifyの二系統は並列実行可能。どちらか失敗なら全体失敗とする。 現時点ではbrowser/static
security/native受入をverifyへ含めていない。

完成時のtask契約:

| task                    | 用途                    | 合格条件                                                                                   |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| verify                  | 日常開発の総合gate      | Rust＋Frontendのfmt/lint/型/基本PBT・test/ビルド＋品質ratchet＋境界検査                    |
| verify:rust             | Rust全製品crate         | rustfmt、Clippy、cargo test（doctest含む）。--workspace/--locked必須                       |
| verify:frontend（後続） | Frontend/共通TS         | Biome check、svelte-check/型検査、Vitest/fast-check、Vite build、残るDeno testと品質script |
| verify:security（後続） | 追加static/supply-chain | Opengrep、Gitleaks、cargo-deny、Frontend依存監査、actionlint/zizmor                        |
| verify:ui（後続）       | browser相互作用         | 既存UI/a11y/Storybook。U層の証拠                                                           |
| verify:ci（後続）       | PR検査の手元再現        | verify＋security＋ui。対応OS/必要tool/browserを明示。全OS実行を一台で再現する意味ではない  |
| verify:extended（後続） | 定期・配布準備          | 長いPBT、crash、coverage、mutation、Alloy、visual/MSRV。実native/実機受入は専用環境        |

未接続taskは空実装で成功させない。現task一覧を実装済みの正本とする。
sources/outputs/skip_ifによる検査結果の省略はgateに使わず、toolのbuild cacheだけを再利用する。
CIではlock固定installとbuild cacheを用い、依存/権限が不足した検査をskipして緑にしない。
miseのdependsとrun配列の公式仕様は[task reference](https://mise.jdx.dev/tasks/task-configuration)を参照。

## 2. Formatter / Linter

| 対象                   | 決定                              | 適用                                                                                                           |
| ---------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Rust                   | rustfmt / Clippy                  | cargo fmt --all -- --check、cargo clippy --workspace --all-targets --locked -- -D warnings                     |
| TS/JS/JSON/CSS/Svelte  | Biome継続、formatterもBiomeへ集約 | 現在formatter.enabled=false。独立した整形移行で有効化し、対象file globとSvelte対応を確認                       |
| Svelte型・template     | svelte-check継続                  | Biomeの代替ではない。Rune/Controllerと実UIの試験も維持                                                         |
| YAML/TOML/Markdownなど | 対応tool/validatorへ分担          | Rust TOMLはcargo metadata、miseはtasks validate、workflowはactionlint。未対応形式をBiomeで処理したことにしない |

既存のdeno fmtとBiomeのcheckを同じfileへ二重にかけ続けない。 整形移行は1
PRで機能変更と分け、style設定/line endingとlint pluginの診断を確認する。
Biomeの[Svelte/HTML formatterは実験的](https://biomejs.dev/introduction/language-support/)なので、
script/style/markup、Svelte
5構文、日本語文字列、空白が意味を持つ箇所で再parse/build/固定例を確認する。
問題が出るfile種別だけ例外とし、Svelte全体のlintを外さない。

Rustのworkspace lintとしてunsafe_code/unused_must_useをdenyし、全3 crateで継承する。
これは依存crate内のunsafeを禁止・監査したことを意味しない。
Clippyのpedantic/restriction全体は有効化せず、意味のある規則だけを追加する。
productionのunwrap/expect/panicは原則回避し、外部入力/I/O経路ではerrorを返す。
testのassert/expectまで一律禁止せず、強制する追加lintはproduction/test区分のfixtureと一緒に導入する。
外部I/O、時刻、乱数がpure coreへ紛れないことはClippyだけで保証できない。

## 3. 静的解析と依存・権限

| 検査                     | 方針とCIでの扱い                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Biome＋既存GritQL plugin | blocking。危険cast、未処理Promise、握り潰し、原因喪失を維持。意図的な不正/正常fixtureで規則の有効性も検査          |
| Opengrep                 | 既存TS/Svelteルールを維持。Rust/新pathへ境界ルールとpositive/negative fixtureを追加してblocking化                  |
| Cargo依存境界            | metadataからcore→infra/desktop、infra→desktopの直接/内部crate経由逆依存を拒否。coreの外部I/O依存と例外の方針も記録 |
| Gitleaks                 | PR/push/定期にblocking。履歴を取得しredactする。SARIF uploadの成功と検出結果を分ける                               |
| cargo-deny               | RustSec advisory、license、source、禁止依存の担当として採用。cargo-auditを同じ目的で重複導入しない                 |
| npm側の依存監査          | 現行lockの全依存を監査し、runtime/devを分類。重大な悪用可能性と対応を確認し、黙ってdev全部を対象外にしない         |
| actionlint＋zizmor       | workflowの構文/式/接続と、権限・不信入力等の検査。CI改修の最初に導入する                                           |
| Knip / cargo-machete     | 未使用依存候補の報告用。未接続のv3依存を保持する期間はblockingにせず、機能接続後にscopeを評価                      |
| CodeQL/追加SAST          | 当面追加しない。既存Opengrep/Clippyに対する具体的な不足が分かったら再検討                                          |

[cargo-deny](https://embarkstudios.github.io/cargo-deny/)のlicense
allowは実lockのSPDX式と配布形態を見て設定する。
MIT/Apacheだけでtransitiveを一括拒否したり、結果を見ず全許可したりしない。 duplicate
versionは初期warn。禁止crate/sourceは明示deny。unknown registry/gitは原則拒否する。 advisory
DBの更新失敗/古いcacheを検査合格にしない。unmaintainedと脆弱性を同じ理由で扱わない。
抑制はcrate/advisory/ruleを限定し、根拠・Issue・owner・失効日を持たせる。 Tauri
capabilityは必要なcommand/dialogだけに絞り、fs pluginがtransitiveにあるだけで広い権限を付与しない。

Opengrepの現状対象はsrc/scriptsで、Rust
crateは未対象。単にRustをCLI引数へ足すだけでは境界検査完了にならない。 pure
domain配下のfs/net/時計等とadapter依存、Viewの直接invoke/DB操作を具体的な責務/pathに従い検査する。
公開API全体やpurityをregexだけで証明したとは扱わず、port契約testとレビューを併用する。
[actionlint](https://github.com/rhysd/actionlint)と[zizmor](https://docs.zizmor.sh/)は役割を分けて使う。

## 4. 品質の基線と失敗の扱い

- 既存の行数/complexity/magic number/重複/coverage/mutation ratchetを、TS移行の都合で削除しない。
  Rustは別の行数ratchetとし、新規production .rsの初期上限を**空行を除いて600行**にする。
  rustfmtの折返し、型定義、match、error処理で物理行が増えるため、TSの400実装行と同じ基準を使わない。
  600はプロジェクトの初期運用値であり、Rust一般の統計的な適正値ではない。
  最初の製品sliceで実際のmodule分布/変更理由を見て、根拠付きで再調整できるようにする。
  Rustの計測はコメント/doc commentと同居testも含む非空行数とし、複雑なRust lexerを新設しない。
  独立tests/fixture、生成物/vendorはproduction fileの上限対象から除外し、対象を明記する。
  行数超過時も、state owner/transaction/不変条件/変更理由を確認して分割を判断する。
  行数だけを減らすwrapper化や、コメント削除で制限を回避しない。
  既存の300〜400行での責務レビューは注意喚起で、RustをCIで落とす600行上限とは区別する。
  基線を超えた既存fileは明示baselineで現状を記録し、悪化を拒否する。自動的な基線切上げは行わない。
  現行implementation_lines.tsはTS/Svelte/CSSのみが対象で、Rustの600行gateはまだ未実装。
  TS/Svelte/CSSの400実装行＋既存baselineは維持し、Rust導入のために一括緩和しない。
- coverageはRust/TS別に出す。Rustはcargo-llvm-covを定期実行へ採用し、最初は報告とV項目の不足確認を行う。
  まだ空のcrateで得た数値を基線にせず、最初の製品sliceから基線を作る。
- Rustのmutationはcargo-mutantsでpure coreの小scopeから導入し、定期実行に置く。
  TSはStrykerを継続し、Rustへ移した規則の旧TS mutation結果で代替しない。
- mutation dry runは配線確認のみ。coverageやmutationの百分率だけを仕様網羅率と呼ばない。
- ratchet増加・閾値緩和・snapshot更新は理由/差分/Issueを伴う明示変更とし、CI自動修正で基線を上げない。
- 最低限のV受入fixture、過去の反例、保存/削除の障害試験を必須化する。 testが0件でもcargo
  testは成功し得るため、製品sliceごとにtest名/実行件数を検証対応表へ記録する。
- flaky/ignoredは合格に数えない。隔離は理由・owner・期限を持ち、耐久化/情報保全/purgeは隔離で通さない。
  toolやruleの故障を候補コードの合格と扱わない。

## 5. CIの目標job構成

GitHub Actionsは配置・OS依存install・cache・artifact・集約を担当し、検査内容はmise taskへ委譲する。

| job               | 実行環境・範囲                                                                        | 頻度・必須性                                         |
| ----------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| rust-product      | Windows MSVC、全workspaceのfmt/Clippy/test。実Loro/SQLite fixtureが接続され次第含める | PR/push blocking                                     |
| rust-portable     | Linux、core/infraのtestと境界検査。desktop GTK要件と分ける                            | PR/push blocking                                     |
| frontend          | Node＋移行中Deno、Biome/型/test/build/品質ratchet                                     | PR/push blocking                                     |
| ui-a11y           | Linux Chromium、U層UI/a11y/Storybook                                                  | PR/push blocking。実Tauriとは区別                    |
| static-security   | Linux、Opengrep/Gitleaks/cargo-deny/依存監査/actionlint/zizmor                        | PR/push/定期 blocking                                |
| quality-extended  | coverage/mutation/長いPBT/Alloy/crash                                                 | 定期＋関連変更/配布前。artifactと失敗Issueを残す     |
| native-acceptance | Windows実Tauri/IME/終了復元/配布asset/性能                                            | driver確立後に自動化。配布前必須、手動Rも記録        |
| verify（集約）    | 全required jobの結果を確認                                                            | always実行、失敗/cancel/理由のないskipを成功にしない |

現在CIのverifyというjobは実作業を行う。移行後の集約jobへ変更する際は、 branch
protection/rulesetのrequired check表示名を照合してから切り替える。 workflow全体のpath
filterでrequired checkを未生成にしない。選択実行を入れる場合も、対象外の理由を集約側で確認する。
macOSは正式サポート対象/配布条件が確定したら追加し、未検査のplatform対応を宣言しない。 MSRV
1.90は定期/配布前に別toolchainで実測する。通常CIのRust 1.98.1合格をMSRV合格へ読み替えない。

Actionは検証したcommit SHAへ固定、第三者binaryもversion/checksum固定とする。
permissionsは基本contents:read。SARIF uploadだけ必要な権限を分離し、fork
PRでuploadできない場合もscan結果とartifactは残す。
不信PRをpull_request_targetでcheckout/実行しない。secretのあるreleaseとPR検査を分ける。
cargo-deny等CLIは製品Cargo依存へ入れず、toolとしてpin/installする。
miseの[CI運用](https://mise.jdx.dev/continuous-integration.html)に沿い、runnerと各toolの版・対象OSを固定する。
Node/npmのpackage-lock、Cargo.lock、Playwright browser版はそれぞれ対応を保持する。
pnpmへの変更は別判断とし、同じpackage treeをnpm/pnpmで交互にinstallしない。

## 6. 実装する順序と完了条件

| 工程     | 変更                                                                | 完了条件                                                                              |
| -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Q0：今回 | miseの互換入口、Rust lint継承、上記方針                             | tasks validate、Rustのfmt/Clippy/testの入口を確認。既存CIは維持                       |
| Q1       | actionlint/zizmor・既存検査の棚卸し、miseのtool版/lockとRust CI接続 | 新旧検査の対応・SARIF/権限・Windows/Linuxで実行確認。Rustの未検査を埋める             |
| Q2       | Biome formatterを独立移行、Frontend taskへ既存verifyを分解          | 意味差分なし、対象fileのformat owner一意、全既存gateが新taskへ対応                    |
| Q3       | cargo-deny、Rust/Frontend境界規則とfixture、required集約            | 実lock監査・例外の根拠、意図的違反でCIが落ちる、required checkが欠けない              |
| Q4       | coverage/mutation/PBT/Alloy/native/配布jobを検証計画へ接続          | V/E/Aの実行証拠と不足が追跡できる。未実装機能を0 testの緑で完了扱いしない             |
| Q5       | Deno互換taskと旧CIの退出                                            | 残るDeno script/testを移行または開発用runtimeとして明示維持し、対応のない削除をしない |

mise run verifyがdeno task verifyへ委譲する間は、deno側をmiseへ逆委譲して循環させない。 Deno
runtimeの製品撤去と、品質scriptの開発用Deno継続は別判断とする。
既存releaseの起動・署名・配布条件は変更しない。Q1では全workflow検査に必要なSHA/権限/cache整理だけを行う。

以下は今回の実行記録。CI切替と追加検査の合格とは区別する。 実行記録: mise 2026.10.17 / Windows MSVC
/ Rust 1.98.1でtasks validate（8 task）、 tasks deps verify、mise run
verify:rustが成功した。fmt/Clippy/test/doctestの配線を確認したが、 現3
crateのtest/doctestはすべて0件。製品の振る舞いの検証合格ではない。
総合verifyは未実行で、legacy/UI/securityの合格はこの結果に含めない。
既存Frontendの総合verify、browser suite、新規security
tool、GitHub上のjob/rulesetの合格は別途必要である。

--staged追補の検証: mise run test --stagedの引数転送と対象なし表示を確認した。
scripts/test_changed_test.tsとscripts/test_changed_rust_test.tsは20 passed / 0 failed。
実Gitのstaged/unstaged・rename/delete、実Cargoの失敗伝播/成功、既存Vitest relatedを含む。 変更3
fileのDeno format/Biome lintとgit diff --checkも成功。総合verify/CI全体の合格とは区別する。

## 7. Q1の実装記録（2026-10-31）

状態: ローカル実装済み。GitHub runnerでの実行とrequired設定変更は未実施。 製品機能・Tauri起動・V/E/A
fixtureの接続完了とは区別する。

### 判断・理由・変更費用

| 判断                                                                   | 理由・代替                                                                                          | 変更費用・後続                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| mise 2026.10.17、Node 22.23.4、Deno 2.9.3、Rust 1.98.1を固定           | 既存CIのNode 22系列と確認済みDeno/Rustを保持。globalのlatestへ依存しない                            | 更新はmise.toml＋mise.lock＋両OSの再検証。mise本体はCI入力の版/checksumも更新  |
| actionlint 1.7.12、zizmor 1.31.1をaqua backendで固定                   | ソースbuildや別package managerを不要にし、両OSで同じ検査を使う                                      | バイナリURL/checksumとattestationをmise lockで解決。製品Cargo.lockは更新しない |
| Windowsは全workspace、Linuxはcore/infra                                | MSVCと可搬性を分担し、Linuxへdesktop GTK依存を持ち込まない                                          | crate追加時はportable taskの明示対象を確認。依存境界検査はQ3                   |
| 既存verify job/check表示名を保持して新jobを追加                        | required checkの消失を避ける。集約への一括改名はしない                                              | Q3で実check runと保護設定を照合。追加jobがrequiredになった保証はない           |
| 全4 workflowのActionをSHA固定、checkout資格情報を残さない              | 新CIだけを検査して旧workflowの不備を隠さない                                                        | Action更新は明示差分。weekly/releaseは既存runtime入口を保持                    |
| mise installを--locked、mise本体をSHA256検証、tool install cacheは無効 | 初回installをchecksum検査し、復元済み実行ファイルを無検証で信頼しない                               | Rustのregistry/git/target build cacheはOS別に再利用。CI install時間は増える    |
| zizmorはoffline、regular persona、low以上をblocking                    | token/ネットワーク有無で検査内容を変えない。informationalの置換提案で既存release Actionを交換しない | オンラインのAction履歴監査は未検査。high/medium診断は維持                      |
| actionlintのshellcheck/pyflakes連携は明示無効                          | workflow構文・式・接続を担当し、偶然導入済みの補助toolへ依存しない                                  | shell/Python検査を追加するときは別途版固定とfixtureを用意                      |
| releaseのcontents:writeをpublishへ限定、依存cacheを無効化              | 全workflow検査で見つかった過大権限/cache-poisoning診断を修正                                        | 起動・署名・配布形式は保持。release実行自体は未確認                            |

Rust backendはrustup経由で、lockは版とprofile/componentsを保持しartifact URLを持たない。
Rust配布物の検証はrustupが担当する。Node/Deno/actionlint/zizmorは両OSのURL/checksumを保持する。
mise本体も最新版へ追従させず、CIは確認したAction SHAと実行binaryのchecksumを指定する。
weekly/releaseのNode 22系列指定をmiseへ寄せる作業は旧runtimeの退出工程と照合して行う。

### 既存検査との対応

| 既存検査                                                                                           | Q1後の入口・job                                                             | 状態                                                               |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Biome/GritQL、400実装行＋baseline、magic-number/重複ratchet、Deno fmt、型、Deno/Vitest、Vite build | Format, check, test, and build → mise run verify:legacy → deno task verify  | 全内容を保持。formatter.enabled=falseも維持                        |
| 重複SARIF                                                                                          | Duplicate-code SARIF                                                        | 生成を保持。fork PRでもartifact保存、SARIF送信だけを権限条件で分離 |
| Opengrep/Gitleaks                                                                                  | Opengrep and secret scanning                                                | 固定版/checksum、src/scripts対象、全履歴取得、redactを保持         |
| UI/a11y/Storybook                                                                                  | Application interactions and WCAG A/AA                                      | UI/a11yを既存mise taskへ委譲。Storybookと失敗時の継続条件を保持    |
| mutation 5 batch dry run                                                                           | Mutation preflight各batch                                                   | matrix/commandを保持。mutation scoreの証拠にしない                 |
| weekly mutation/coverage/visual                                                                    | Weekly quality audit                                                        | 検査・baseline・OSを保持。Action SHA/資格情報だけを整理            |
| 全製品Rust crate                                                                                   | Rust product (Windows MSVC) → mise run verify:rust                          | fmt/Clippy/test/doctest、30分上限                                  |
| core/infra                                                                                         | Rust core and infra (Linux) → mise run verify:rust:portable                 | Clippy全targetとtest/doctest、30分上限                             |
| 全workflow                                                                                         | Workflow syntax and security → mise tasks validate＋mise run lint:workflows | PR/push/手動。path filterや空成功なし                              |

Opengrepの失敗後もGitleaksを実行し、生成済みSARIFをartifactへ残す。 fork
PRではsecurity-events書込みを要求する送信stepだけを実行しない。scanner失敗はjob失敗のまま。 SARIF
upload成功はscanner合格の代わりにならない。新jobとfork上のuploadのGitHub実測は未確認。

main ruleset（id 24418620）はread-only APIで確認し、activeなdeletion/non_fast_forwardのみだった。
従来branch protection APIは401で読めず、required status checkの全設定は確定できなかった。 既存job
ID/表示名を保持し、ruleset/branch protectionへ書込みを行っていない。

### 限定例外 Q1-WF-01

追跡先: 本節Q1-WF-01（Q3でGitHub Issueへ対応付ける）。owner: Radiora repository maintainer。
見直し期限: 2026-11-30。対象はopencode.ymlのissue_commentのdangerous-triggers一箇所のみ。
コメント起動の既存運用を保つため、jobをOWNER/MEMBER/COLLABORATORのコメントに限定し、 default
branchのcheckout、persist-credentials:false、Action SHA固定と併せて例外とした。
外部contributorのコメントではAPI
keyを使うjobを起動しない。コメント/PR全体を信頼済みとする意味ではない。 権限判定やcheckout
ref変更時には再評価する。抑制を全workflowへ拡張しない。

### 再現と残件

mise 2026.10.17を導入し、初回は内容確認後にmise trust、次にmise install --lockedを実行する。
WindowsにはMSVC build tools、Linuxのportable gateにはC compiler/linkerが必要。portable
gateにGTKは不要。 mise run verifyのRust側は全workspaceなので、GTKなしのLinuxではmise run
verify:rust:portableを使う。 普段のmise run test --stagedとchanged選択の契約は変えない。

製品Cargo manifest/lock、pnpm関連、vertical-tree-mockはQ1で変更していない。
cargo-deny、Rustの600非空行gate、Rust/Frontend境界規則、required集約はQ3の残件。 Biome
formatter移行はQ2、PBT/Alloy/native/実機・MSRV受入はQ4以降のまま。

### Q1の実行証拠

対象は未コミットのv3作業ツリー。既存設計/Cargo/test選択の変更を引き継いだ状態での記録であり、main反映ではない。

| 実行                                                                | 結果・限界                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| mise lock --platform windows-x64,linux-x64 と mise install --locked | 両OSの同じ固定版を導入。lock dry-run --jsonは空配列。Rust以外はURL/checksumを保持                      |
| Windows MSVC: mise run verifyのRust側                               | fmt/Clippy/test/doctest成功。3 crateとも製品test/doctestは0件                                          |
| WSL Ubuntu 22.04 / Rust 1.98.1: mise run verify:rust:portable       | Clippy/test/doctest成功。core/infraとも0件。Windows成果物と分けてtarget/q1-linuxを使用                 |
| mise run lint:workflows、mise tasks validate、tasks deps verify     | workflow検査はWindows/Linuxとも成功。validateはWindowsで11 task。verifyはlegacy/Rustへ委譲し逆委譲なし |
| workflow negative control                                           | stdinの未定義contextをactionlint、未固定checkoutをzizmorが非0で拒否                                    |
| test_changed_test.ts＋test_changed_rust_test.ts                     | 20 passed。実Git/Cargo失敗伝播と実Vitest relatedを含む                                                 |
| deno task test                                                      | 1,039 passed（4 steps）、0 failed。既存Deno回帰でありv3のV項目合格ではない                             |
| deno task test:svelte                                               | 55 file / 549 test passed。既存Frontend回帰                                                            |
| 既存Deno format/型検査                                              | format 597 file、svelte-checkは0 errors / 0 warnings、終了0                                            |
| mise run verify全体                                                 | 初回はAccess deniedで停止。後記の低整合性ラベル修正後、262.34秒で全体成功（exit 0）                    |
| npm run build（後続を個別実行）                                     | 初回はesbuildのTEMP削除がAccess denied。修正後は個別build/総合verify内buildとも成功                    |
| GitHub CI、fork SARIF、UI/a11y/Storybook、weekly/release実行        | この工程では未実行。runner上の合格やrelease可否は宣言しない                                            |

WindowsのAccess
deniedは通常の権限昇格経由でも発生した。cache/TEMPの場所や検査条件を変えて回避していない。 jscpd
reporterの出力失敗を成功扱いせず、後記の環境修正でratchet/buildを含む総合verifyの成功を確認した。
legacyのcheck/testは既存の--node-modules-dir=auto経由でdeno.lockを再解決したため、
この実行が生成したlock差分だけを戻した。Q1として依存更新は含めない。strictなlegacy
lock運用は移行時に確認する。 docsは既存の折返し/表記を維持し、全体へのdeno fmtは適用していない。

一次資料: [mise lock](https://mise.jdx.dev/dev-tools/mise-lock.html)、
[固定mise-actionのinstall/checksum実装](https://github.com/jdx/mise-action/blob/5228313ee0372e111a38da051671ca30fc5a96db/src/index.ts)、
[Rust backend 2026.10.17](https://github.com/jdx/mise/blob/v2026.10.17/src/plugins/core/rust.rs)、
[actionlint](https://github.com/rhysd/actionlint/tree/v1.7.12/docs)、
[zizmor動作モード/閾値](https://docs.zizmor.sh/usage/)。

### Windows低整合性ラベルの診断と修正（2026-10-31追補）

上表のAccess deniedは、出力先フォルダの通常DACLではなく、依存実行ファイルの Low Mandatory
Levelラベルに起因した。jscpdの単一入力でも再現し、同じ出力先で Rust
std::fsのmkdir/write/removeは成功した。SHA256が同一のjscpd.exeを通常の
整合性を継承する診断用コピーとして実行するとJSON生成に成功した。
元のjscpd.exeとesbuild.exeは両方ともLow Mandatory Levelで、jscpdはDeno npm cacheと
複数worktreeでハードリンク共有されていた。ラベルを付けた操作/時点は未特定。

ユーザー承認のもと、次の既存2実行ファイルだけへicacls /setintegritylevel Mを実行した。
フォルダ全体の再帰的なACL変更、製品コードやpackage版の変更は行っていない。
ハードリンク共有先にも同じファイル属性変更が及ぶことを説明して承認を得た。

- node_modules/.deno/jscpd-windows-x64-msvc@5.0.12/node_modules/jscpd-windows-x64-msvc/bin/jscpd.exe
- node_modules/.deno/esbuild@0.28.2/node_modules/@esbuild/win32-x64/esbuild.exe

修正後、deno task duplicates:ratchetは23 current / 27 baselineで成功し、 npm run buildも1,457
moduleを変換して成功した。診断用source/executableと最小入力のreportは削除済み。
CLIのoutputはディレクトリであり、ファイル名指定への変更は不要だった。 jscpdはreporter失敗時にもexit
0となることを確認したため、exit code単独を出力成功の証拠にはしない。
依存の再配置/再取得でラベルが戻る可能性と、ラベル付与元の特定は別の環境調査として残る。

Windowsのprocess生成時の整合性レベル:
[Microsoft Mandatory Integrity Control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)。

修正後のmise run verifyは262.34秒、exit 0で完了。Deno 1,039件（4 steps）、Vitest 55 file / 549件、
Rust fmt/Clippy/test/doctestとFrontend
buildが成功した。Rust製品testは依然0件で、機能受入の証拠にはしない。
検証で再解決されたdeno.lockだけを実行前へ戻し、依存版/既存baselineは変更していない。

## 8. Q2〜Q5の実装記録（2026-10-31）

状態: ローカル実装・検証済みの範囲と未実施の範囲を分けて記録する。GitHub runnerでの実行、required
check設定の変更、Opengrep/Gitleaksの手元実行、Linux実機でのQ2/Q3 task実行は未実施。 Alloy model
checkとRust proptestのCI接続は別作業が進行中のため未接続（本節では配線しない）。
Q5は棚卸しのみで、削除・移行は行っていない。

### 判断・理由・変更費用

| 判断                                                                                                                                  | 理由・代替                                                                                                                                        | 変更費用・後続                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Biome formatterを有効化（tab、幅100、LF、二重引用符、セミコロン）。Biome 2.5.2はpackage.json固定                                      | 旧deno fmt設定（useTabs/lineWidth 100）に合わせて差分を最小化。別formatterを増やさずlinterと設定・版を共有する                                    | 設定変更は全file再整形を伴う。style変更は独立PRで行い、意味差分検査を再実施する         |
| 整形対象をdeno fmt対象に加えて拡張: stryker*.mjs、vitest/playwright config、svelte.config.js、knip.json、tsconfig.json                | これらは従来formatter不在でownerが無かった。files.includesを広げ、linter.includesは従来の対象に固定してlint範囲を広げない                         | lint対象にする場合はlinter.includesだけ変更する                                         |
| Svelteも整形対象（Biome experimental HTML対応）                                                                                       | 従来deno fmtはSvelteを整形していない（--unstable-component無し）。59 fileの意味差分なしをcompile結果で確認した上で採用                            | 問題が出たfileだけformatter例外にする。Svelte全体のlintは外していない                   |
| Markdownはdeno fmtがownerのまま、gateにしない                                                                                         | BiomeはMarkdownを整形できない。docsは既に11 fileが未整形で、整形移行を混ぜると差分が不明瞭になる。deno.jsonのfmt.includeをMarkdownのみに制限した  | Markdown整形をgate化する場合はdocs整形を別PRで行う                                      |
| format owner: TS/JS/Svelte/CSS/JSON config=Biome、Markdown=deno fmt、Rust=rustfmt、workflow=actionlint(構文のみ)、TOML=cargo/mise検証 | 各file種別にformatterは最大1つ。lint-stagedも拡張子で分担。YAML/TOMLのformatterは未導入（未対応形式をBiomeで処理したことにしない）                | YAML/TOML整形を求める場合は対応toolを別途導入する                                       |
| Frontend taskはdeno taskへ委譲せずmise側に直接commandを持つ。verify:legacyだけがdeno task verifyへ委譲                                | 委譲はmise→denoの一方向でdeno.jsonはmiseを呼ばないため循環しない。旧verify chainのfmt段だけdeno fmt→`deno task fmt:check`（Biome）へ置換した      | verify:legacyは2026-10-31に削除済み                                                     |
| Rust依存境界を二重化: cargo-deny `bans.deny`(wrappers)と`cargo metadata`の推移的検査                                                  | cargo-denyのwrappersは直接依存者のみ判定する。metadata検査は推移経路・規則未定義member・desktopへの逆依存を検出でき、固定fixtureでunit testできる | 新crate追加時はRULES表(rust_crate_boundaries.ts)とdeny.tomlの更新が必要（意図した失敗） |
| Rust 600非空行gateはDeno scriptで実装。baselineは空の明示file                                                                         | 設計§4の定義（コメント/同居test含む、tests・生成物除外）をそのまま実装。超過fileは明示baselineで悪化のみ拒否する                                  | 上限調整は根拠付きで定数とbaselineを変更する                                            |
| required集約: 既存jobの表示名は変えず新job `Required checks` を追加                                                                   | branch protection/rulesetを読めないため既存check名を保持。集約jobは`always()`で全jobのresultがsuccessか検査し、skip/cancelも失敗にする            | 保護設定でrequiredにするのは手動（未実施）。以後は個別jobのrequiredを集約へ置換できる   |
| 週次coverage/mutation/visualをmise task経由に変更（mise-actionで版固定）                                                              | PR用CIと同じtool版・入口にする。実行内容は従来のnpm/deno commandと同一                                                                            | 週次の初回GitHub実行は未確認。release.ymlは変更していない                               |

### Q2: Biome formatter移行とFrontend task分解

整形は意味を変えない作業として独立に実施した。整形前後を次の方法で比較した（scratchpadの一時script）。
各fileをesbuild(minify)、Svelteはsvelte/compiler(client)、JSON/CSSは構文木で正規化して変換結果を比較。
対象596 file（src/scripts/tests/vitest/.storybook/stories＋従来のdeno fmt対象config）のうち、
差異は設定変更を入れたbiome.jsonのみ。TS 521、Svelte 59を含め他は全て一致した。
ただしSvelteのcompile比較は空白の畳み込みを含むため、`<pre>`等の空白依存はUI/a11y試験で別途確認が必要
（本作業ではUI/a11y browser suiteは未実行）。

整形の副作用で失敗した既存gateと対応（挙動変更ではない）:

- 関数50行上限(Biome lint)を2関数が超過（desktop_cdp_audit.runAudit
  52行、turso_benchmark_dryrun.generateLargeSnapshot 51行）。
  tracing開始とaliases生成を同一ファイル内の関数へ抽出した（振る舞い不変）。
- 実装行ratchet: mock_ui_plugin.ts 595→607、graph_state_validation.ts 433→434、
  editor_completion_controller.svelte.ts は392→420で上限400を超えたためbaselineへ新規登録(420)。
  折返し由来のみで、自動切上げではなく手編集。**ユーザーの承認が必要**（末尾の決定事項）。
- magic-number ratchetは行テキストをkeyにするため整形で再keyが必要。`--update`で再生成し、
  HEADのbaseline
  428件→299件。fileごとの件数は全て減少または同数（増加なし）。stale項目の削除を含む。
- 重複ratchet: 同一クローン(inline_link/internal_reference、73
  token)の行数が9→13。baselineの1項目のみ更新。
- source文字列をregexで検査する4つのDeno契約testが整形（改行位置・括弧）で失敗した。
  tests/opml_ui_contract_test.ts、tests/json_backup_ui_contract_test.ts、tests/inline_link_ui_contract_test.ts
  の regexを空白許容に修正した（検査対象は同じ）。これらは整形に脆く、Q5でVitest化/廃止を提案する。

mise task対応（旧 `deno task verify` の各段 → 新task）:

| 旧verifyの段                                 | 新task                                                         |
| -------------------------------------------- | -------------------------------------------------------------- |
| deno task lint (Biome lint)                  | lint:frontend                                                  |
| deno task quality (実装行)                   | quality:frontend の1段目                                       |
| deno task quality:magic-numbers              | quality:frontend の2段目                                       |
| deno task duplicates:ratchet                 | quality:frontend の3段目                                       |
| deno fmt --check（対象一覧）                 | fmt:frontend（Biome format。対象はbiome.jsonのfiles.includes） |
| deno task check (deno check ＋ svelte-check) | check:frontend                                                 |
| deno task test                               | test:frontend:deno                                             |
| deno task test:svelte                        | test:frontend:unit                                             |
| npm run build                                | build:frontend                                                 |
| （CIのUI/a11y/Storybook）                    | verify:ui = test:ui ＋ test:a11y ＋ test:storybook             |

verify:frontendは上表を旧verifyと同順（lint→quality→fmt→check→test→unit→build）で実行する。
`verify`はverify:frontendとverify:rustに依存する。`verify:legacy`は`deno task verify`のままで、
deno.jsonからmiseは呼ばないため循環しない（`mise tasks deps verify`で確認）。 CIの既存job
`Format, check, test, and build` はverify:legacyからverify:frontendへ切替えた（job名は不変）。

lint-stagedはBiome(TS/JS/Svelte/JSON/CSS)とdeno fmt(md)に分担した。Windowsでは依存実行ファイルの
低整合性ラベル（§7）により、Biomeの書込み(`--write`)が元のbiome.exeではAccess deniedになる。
本作業の一括整形は同一SHAのbiome.exeを通常整合性の場所へコピーして実行した（node_modules内の元ファイルのACLは未変更）。
check専用task（fmt:frontendなど）は元のbiome.exeで読取りできる。

### Q3: cargo-deny・Rust境界・行数gate・required集約

cargo-deny 0.20.2をaqua
backendで固定（mise.toml/mise.lock、両OSのchecksum）。deny.tomlは実Cargo.lock (531 crate)の
`cargo deny list` に基づく。

- 対象platform: x86_64-pc-windows-msvc と x86_64-unknown-linux-gnu。macOS専用crateは監査対象外
  （macOSが正式対象になった時に追加する）。
- license allow: MIT、Apache-2.0(＋LLVM-exception)、BSD-2/3、BSL-1.0、CC0-1.0、MIT-0、Unicode-3.0、
  Unlicense、Zlib、0BSD、MPL-2.0。実lockの全licenseを確認して設定した。
  MPL-2.0はcssparser/selectors等（Tauri経由）と`im`系（Loro経由）に存在し、ファイル単位の弱いcopyleftで、
  変更せずCargo依存として使う限り配布条件が軽い。LGPL-2.1-or-laterはr-efiのOR選択肢にだけ存在しMITで満たされるため許可していない。
  自社3 crateはpublish=falseでlicenses.private.ignoreとした。
- sources: crates.io以外のregistry/gitを拒否。yankedはdeny。advisory
  DBの取得失敗は不合格（cacheへ黙って退避しない）。
- unmaintained: `workspace`（直接依存のみ判定）。`all`で実測すると推移依存の4件が指摘される:
  RUSTSEC-2026-0247 bitmaps、RUSTSEC-2026-0248 im、RUSTSEC-2026-0251 sized-chunks（いずれもLoro
  1.16.2経由）、 RUSTSEC-2024-0370
  proc-macro-error（Tauri経由）。脆弱性advisoryではなく保守終了の通知で直接依存でもないため、
  ignoreは追加せずgateの範囲外とした。Loro/Tauri更新時に再確認する（owner: maintainer、次回確認:
  2026-11-30）。
- duplicate versionはwarn（hashbrown 5版など。Tauri/GTK系の推移依存）。例外・ignoreなし。
- 実行結果: advisories ok, bans ok, licenses ok, sources ok（`cargo deny check`、exit 0、advisory
  DBは実行時に取得）。

Rust境界（設計§1から導出）:

- radiora-core: radiora-infra / radiora-desktop / loro / rusqlite /
  tauri(とtauri-*)へ推移的にも到達しない。
- radiora-infra: radiora-desktop / tauri(とtauri-*)へ推移的にも到達しない（coreへは依存可）。
- radiora-desktop:
  組立のみ。loro/rusqliteへ直接依存しない（infra経由）。desktopへ依存するcrateは無い。
- 上記以外のworkspace memberは規則未定義として失敗し、必須3
  memberが欠けても失敗する（新crateは層を宣言する）。
- 実装:
  scripts/quality/rust_crate_boundaries.ts（`cargo metadata --locked`の形をruntime検証してから評価）と、
  deny.tomlのbans.deny(wrappers)による直接依存の二重検査。Opengrepへ正規表現ベースのRust境界ruleは追加しなかった。
  metadata検査のほうが推移依存を正確に扱えるため。Frontend側の境界は既存Opengrep
  rule(src/ui→storage等)とfixture(.opengrep/tests)を維持した。

意図的違反でgateが落ちることの実証（scratchpadの複製workspaceで実施。リポジトリのcrates/は変更していない。複製は削除済み）:

| 違反                                 | rust_crate_boundaries.ts                                    | cargo deny check bans                                        |
| ------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------ |
| radiora-core が loro に依存          | exit 1: `radiora-core must not depend on loro`              | exit 2: `crate 'loro' is explicitly banned`（親がwrapper外） |
| radiora-infra が tauri に依存        | exit 1: `radiora-infra -> tauri`、tauri-buildにも到達       | exit 2: `crate 'tauri' is explicitly banned`                 |
| radiora-core が radiora-infra に依存 | cargo自身が循環依存として拒否。scriptはmetadata失敗でexit 1 | 検査前にcargoが失敗                                          |

固定fixtureのunit test（rust_crate_boundaries_test.ts 7件）が、通過経路と各違反を常時検査する。

Rust 600非空行gate: scripts/quality/rust_file_size.ts（unit test
5件）。対象は`crates/*`のtests/benches/examples/ generated/vendor以外の*.rs。現状3
file・超過なし。baseline(scripts/quality/rust_file_size_baseline.json)は空で、
記載された超過fileは悪化のみ拒否する。
`check:rust-structure`（境界＋行数）をverify:rustとverify:rust:portableの最後に追加した。

required集約: ci.ymlに `Cargo dependency audit`（cargo-deny、Linux）と `Required checks`（全9
jobのneedsを
`always()`で集約）を追加した。scripts/quality/ci_required_jobs.tsが「ci.ymlの全jobが集約のneedsにある」ことを検査し
（unit test
6件、lint:workflows内で実行）、新jobの追加漏れを検出する。Opengrep/Gitleaksは従来どおりCI内で
curl＋checksumによりinstallする（mise管理は未導入）。Required checksをbranch
protectionのrequiredへ追加する操作は未実施。

### Q4: coverage・mutation（Alloy/Rust PBTを除く）

- coverage:frontend = Vitest coverage → Deno coverage → coverage ratchet（旧週次の3
  commandと同一）。
- mutation:preflight <batch> / mutation:run
  <batch>（parsers|projections|domain|storage|controllers）。 PRのMutation
  preflight各batchをmutation:preflightへ、週次mutationをmutation:runへ接続した。
- test:visual、test:storybook、verify:uiを追加。verify:securityはcargo-denyとworkflow lintをまとめる
  （Opengrep/Gitleaksは含まない旨をtask説明に明記）。
- quality-weekly.ymlのjobをmise-actionで版固定（Node 22.23.4、Deno
  2.9.3）に変更し、setup-node/setup-denoを廃止した。 incremental cache、artifact、Windowsのvisual
  baselineは保持。release.ymlの署名・配布条件は変更していない。
- **未接続（保留）**: Alloy model-checkのjobとRust proptest
  PBTのjob。別作業で作成中のため、そのCI接続は
  本節では行わない。完成後にverify:extendedと週次workflowへ接続し、V/E/A項目との対応を検証対応計画に記録する。
  Rust coverage(cargo-llvm-cov)、cargo-mutants、MSRV、native
  acceptanceも未着手（設計どおり製品slice後）。 verify:ci /
  verify:extendedは「未接続taskを空実装で成功させない」ため定義していない。

### Q5: Deno・旧CIの棚卸し（提案のみ、削除なし）

分類: migrate=Rustまたは別runtimeへ移す、keep=開発用Denoとして明示維持、remove=退出（要承認）。

| 対象                                                                                                    | 現状の用途                                                     | 提案                                                                                 |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| scripts/quality/*.ts（実装行・magic-number・重複・coverage・Rust境界/行数・ci_required_jobs）とそのtest | mise task/CIから呼ぶ品質gate                                   | keep（開発用Deno）。TS対象gateはFrontendが残る限り維持                               |
| scripts/quality/mutation_ratchet.ts                                                                     | deno.json・CI・miseのどこからも参照なし                        | remove候補（参照なしを確認済み。削除するか週次へ接続するかの判断）                   |
| scripts/test_changed.ts ＋ 2 test、codex_quality_hook.ts ＋ test                                        | mise run test、Codex hook                                      | keep                                                                                 |
| scripts/mock_ui_plugin.ts、docs_shortcuts.ts                                                            | Vite mock UI(UI/a11y試験)、docs生成                            | keep（Frontend開発用）                                                               |
| scripts/desktop_build/run/hmr/hmr_proxy_plugin/preflight/cdp_audit(+dir)/msix.ts                        | v2のDeno CEF desktop host。release.ymlが使用                   | remove（v3 Tauri release workflow確立後。それまでkeep）                              |
| scripts/licenses.ts                                                                                     | MSIX/buildのlicense一覧生成                                    | migrate（Rust/npm両依存を扱う生成へ。cargo-deny listの利用を検討）                   |
| scripts/migrate_legacy_surreal.ts、turso_probe.ts、turso_benchmark_dryrun.ts                            | 旧storage移行、Turso調査                                       | migrate_legacy_surrealはv2→v3 Importer確立までkeepしRustへ。他2つは削除済み          |
| scripts/performance_fixture*、performance_measurement*、generate_family_tree_backup*                    | v2性能fixture/計測、家系図fixture                              | migrate（v3の性能/fixture受入へ）。v2基線として当面keep                              |
| scripts/analyze_operation_log.py                                                                        | 参照なしのPython解析                                           | 要確認（用途不明。remove候補）                                                       |
| Deno test src/services(51 file)、src/storage(14)、src/desktop(3)、src/ui(7)                             | v2のTS domain/storage試験                                      | migrate: Rust coreへ移した機能ごとにPBT/固定fixtureへ置換し、TS domain撤去時にremove |
| Deno test tests/(97 file)                                                                               | UI契約。source文字列regex検査が多く整形に脆い（今回4件が破損） | migrate: Vitest/実コンポーネント試験へ。移せない文書検査は廃止を検討                 |
| scripts/内のDeno test 13 file                                                                           | 上記scriptsの試験                                              | 対象scriptと同じ分類                                                                 |
| vitest/(58 file)、Storybook、Playwright                                                                 | Frontend試験                                                   | keep（Node。Deno非依存）                                                             |

旧CI jobの対応:

| 旧job                                        | Q2〜Q5後                                                | 提案                             |
| -------------------------------------------- | ------------------------------------------------------- | -------------------------------- |
| verify (Format, check, test, and build)      | mise run verify:frontend                                | keep。verify:legacyは削除済み    |
| duplicates (SARIF)                           | deno task duplicates:sarif                              | keep（miseの入口化は任意）       |
| static-analysis (Opengrep/Gitleaks)          | curl＋checksum                                          | keep。mise管理へ寄せるかは別判断 |
| a11y                                         | mise run test:ui / test:a11y / test:storybook           | keep                             |
| mutation-preflight                           | mise run mutation:preflight                             | keep                             |
| rust-product / rust-portable / workflow-lint | mise run                                                | keep                             |
| quality-weekly (mutation/coverage/visual)    | mise run mutation:run / coverage:frontend / test:visual | keep                             |
| release.yml (Windows/Linux bundle)           | setup-node/setup-deno＋deno task（未変更）              | v3 release確立後にremove/置換    |
| opencode.yml                                 | Q1の限定例外Q1-WF-01                                    | keep（2026-11-30に見直し）       |

### 実行証拠

| 実行                                                      | 結果・限界                                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 整形前後の意味差分比較（esbuild minify / svelte compile） | 596 file中、差異はbiome.jsonのみ（設定変更）                                                                                                                                           |
| mise run verify:frontend                                  | exit 0、3分57秒。Biome lint/quality 3種/fmt/svelte-check(792 file 0 error)/Deno 1,057 passed(4 steps)/Vitest 55 file 549 test/build成功                                                |
| mise run verify:rust                                      | exit 0。fmt/Clippy/test（core oracle 14件を含む）/doctest/check:rust-structure成功                                                                                                     |
| mise run verify:rust:portable（Windows上で実行）          | exit 0。Linux実機・WSLでは未実行                                                                                                                                                       |
| mise run deny:rust (`cargo deny check`)                   | exit 0。advisories/bans/licenses/sources ok                                                                                                                                            |
| mise run lint:workflows ＋ mise tasks validate            | actionlint/zizmor no findings、ci_required_jobs ok。validate 28 task                                                                                                                   |
| mise run mutation:preflight 5 batch                       | 全てdry-run成功（mutation scoreの証拠ではない）                                                                                                                                        |
| mise run coverage:frontend / mise run verify:legacy       | coverage:frontend exit 0（ratchet: unit lines 82.2 / branches 64.26、deno lines 84.34 / branches 87.05）。verify:legacy exit 0（Deno 1,057件、Vitest 549件、build成功、Biome fmt経由） |
| 意図的な境界違反                                          | 上記のとおりscriptとcargo-denyの両方が非0                                                                                                                                              |
| Deno unit test（新規）                                    | rust_crate_boundaries 7 / rust_file_size 5 / ci_required_jobs 6、全て成功                                                                                                              |

### 未実行・未確認

- GitHub runner上のCI実行（新job `Cargo dependency audit` /
  `Required checks`、週次workflowのmise化、Windows/Linux）。
- required checkのbranch protection/ruleset設定。ここでは読み書きしていない。
- Opengrep/Gitleaksの手元実行（未インストール）。UI/a11y/Storybook/visualのbrowser suite。
- Linux（WSL含む）でのQ2/Q3 task実行。cargo-denyのmacOS専用crate監査。
- mutation:runの本実行（長時間）。
- Windowsの低整合性ラベル問題（§7）は未解決。Biomeの`--write`は元のbiome.exeでは失敗する。

### 承認を要する決定

1. **2026-10-31 ユーザー承認済み**: 実装行baselineの手編集3件（mock_ui_plugin
   607、graph_state_validation 434、 editor_completion_controller 420新規）、magic-number
   baselineの再生成、重複baseline 1項目の更新を整形移行の一部とする。
   差分は整形による折返しのみと確認した。editor_completion_controllerの400行超過は責務分割の候補として残す。
2. Q5のremove候補: **2026-10-31 ユーザー決定**でTurso調査script（`scripts/turso_probe.ts`、
   `scripts/turso_benchmark_dryrun.ts`、deno task `probe:turso`）とmise task
   `verify:legacy`を削除した。
   v2の現行storage（`src/storage/turso_*`、データ配置`turso/`）は製品runtimeのため対象外。deno task
   `verify`は残す。 mutation_ratchet.ts、analyze_operation_log.py、将来のDesktop/CEF scriptは未決。
3. **2026-10-31 ユーザー承認済み**:
   「desktopがloro/rusqliteへ直接依存しない」を境界規則として採用する。
   Loro適用・共通Undo・SQLite耐久化・purge
   barrierはinfraの一つの協調契約で扱い、desktopはinfraの公開入口だけを使う。
   推移依存は許可する。desktopに必要な機能（workspace開閉・診断・backup・保存済み版の変更通知）はinfraがport/APIとして提供する。
