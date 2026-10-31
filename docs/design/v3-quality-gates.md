# v3 品質ゲートとmise/CI移行

決定日: 2026-10-31。状態:
品質方針を採用。mise入口・版固定、Rust基本lint/CI、workflow検査をローカル実装。 追補:
ユーザーは本計画の推奨方針を採用し、普段用の --staged テストを追加する判断を行った。
Q1の実装と検証範囲は末尾に記録。GitHub実行・Q2以降の移行完了とは区別する。
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

| 実行                                                                | 結果・限界                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| mise lock --platform windows-x64,linux-x64 と mise install --locked | 両OSの同じ固定版を導入。lock dry-run --jsonは空配列。Rust以外はURL/checksumを保持                                         |
| Windows MSVC: mise run verifyのRust側                               | fmt/Clippy/test/doctest成功。3 crateとも製品test/doctestは0件                                                             |
| WSL Ubuntu 22.04 / Rust 1.98.1: mise run verify:rust:portable       | Clippy/test/doctest成功。core/infraとも0件。Windows成果物と分けてtarget/q1-linuxを使用                                    |
| mise run lint:workflows、mise tasks validate、tasks deps verify     | workflow検査はWindows/Linuxとも成功。validateはWindowsで11 task。verifyはlegacy/Rustへ委譲し逆委譲なし                    |
| workflow negative control                                           | stdinの未定義contextをactionlint、未固定checkoutをzizmorが非0で拒否                                                       |
| test_changed_test.ts＋test_changed_rust_test.ts                     | 20 passed。実Git/Cargo失敗伝播と実Vitest relatedを含む                                                                    |
| deno task test                                                      | 1,039 passed（4 steps）、0 failed。既存Deno回帰でありv3のV項目合格ではない                                                |
| deno task test:svelte                                               | 55 file / 549 test passed。既存Frontend回帰                                                                               |
| 既存Deno format/型検査                                              | format 597 file、svelte-checkは0 errors / 0 warnings、終了0                                                               |
| mise run verify全体                                                 | 不合格。duplicates:ratchetのjscpd JSON reporterがAccess denied、その後report不在で停止。出力directoryを事前作成しても再現 |
| npm run build（後続を個別実行）                                     | 不合格。1,457 module変換後、esbuildのWindows TEMP file削除がAccess denied                                                 |
| GitHub CI、fork SARIF、UI/a11y/Storybook、weekly/release実行        | この工程では未実行。runner上の合格やrelease可否は宣言しない                                                               |

WindowsのAccess
deniedは通常の権限昇格経由でも発生した。cache/TEMPの場所や検査条件を変えて回避していない。 jscpd
reporterの出力失敗を成功扱いせず、既存ratchetとbuildの失敗を未解決として残す。
legacyのcheck/testは既存の--node-modules-dir=auto経由でdeno.lockを再解決したため、
この実行が生成したlock差分だけを戻した。Q1として依存更新は含めない。strictなlegacy
lock運用は移行時に確認する。 docsは既存の折返し/表記を維持し、全体へのdeno fmtは適用していない。

一次資料: [mise lock](https://mise.jdx.dev/dev-tools/mise-lock.html)、
[固定mise-actionのinstall/checksum実装](https://github.com/jdx/mise-action/blob/5228313ee0372e111a38da051671ca30fc5a96db/src/index.ts)、
[Rust backend 2026.10.17](https://github.com/jdx/mise/blob/v2026.10.17/src/plugins/core/rust.rs)、
[actionlint](https://github.com/rhysd/actionlint/tree/v1.7.12/docs)、
[zizmor動作モード/閾値](https://docs.zizmor.sh/usage/)。
