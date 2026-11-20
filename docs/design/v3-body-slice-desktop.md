# v3 本文spike：desktop・画面・実機確認

作成日: 2026-11-20。状態: **spikeの記録**（`spike/v3-body-desktop`ブランチのみ。v3へmergeしない）。
「動くものを見る」ための試作で、#385の進捗・受入・決定ではない。本文中の「段階B/C」は
このspike内の作業区分にすぎず、Issueや移行計画で合意したものではない。command名・DTO・
版の表現・retry方式・最小画面の採用は、#381/#385で決めるための材料として残す。
保存の中核は[本文保存の中核](v3-workspace-store.md)、Tauri hostの起動経路は
[mock shell](v3-desktop-mock-shell.md)を参照する。

## 1. できること

v3のdesktop appで文書を作り、本文を書いて保存し、アプリを閉じて開き直すと本文が戻る。
画面は文書一覧と本文欄だけの最小構成で、v2の`RadioraBindings`やApp画面は使わない（spikeでの選択。#385の目的は「既存Svelte
UI」であり、未合意）。

```powershell
mise run desktop:v3          # 開発：Vite（v3.html）＋cargo run
mise run desktop:v3:release  # dist-v3を埋め込んだreleaseを起動（Vite不要）
mise run desktop:mock        # 段階A：既存UIをmock serverで表示。workspaceは開かない
```

データは`%LOCALAPPDATA%\dev.radiora.v3\workspace.db`。v2の`%LOCALAPPDATA%\RadioraV2`には触れない。
開発補助として`RADIORA_V3_DATA_DIR`で保存先を差し替えられる（試験・実機確認用）。

## 2. 責務と境界

[C4](v3-c4-architecture.md) C3と[UI所有契約](ui-state-ownership.md)に合わせる。

| 層               | 置き場所                                  | 責務                                                                                                         |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Composition root | `crates/radiora-desktop/src/lib.rs`       | tracing、workspace host、command登録、main windowの作成だけ                                                  |
| Workspace host   | `src/host.rs`                             | 保存先の解決、単一processの排他（`workspace.lock`）、coordinatorの共有（`Arc<Mutex>`）、開けない理由の保持   |
| Tauri binding    | `src/commands.rs`、`src/dto.rs`           | 信頼境界のvalidation（未知field拒否、ID解析、本文1 MiB上限）、blocking threadでcoordinator実行、errorのDTO化 |
| invoke adapter   | `src/v3/tauri_workspace_adapter.ts`       | IPCを扱う唯一のmodule。応答をvalibotで検証し、拒否を`WorkspaceCommandError`へ変換                            |
| Controller       | `src/v3/body_editor_controller.svelte.ts` | 本文sliceのstate owner。committed read model、draft、保存状態、失敗した要求、読込世代                        |
| View             | `src/v3/V3App.svelte`                     | 表示と操作の転送だけ。I/O・`$effect`なし                                                                     |

### Command（`radiora-desktop`）

| command           | 入力（`request`）                             | 応答               | 備考                                                            |
| ----------------- | --------------------------------------------- | ------------------ | --------------------------------------------------------------- |
| `workspace_view`  | なし                                          | `WorkspaceViewDto` | 保存済みの版だけ。未保存の変更がある間は`persist_pending`       |
| `new_block_id`    | なし                                          | UUIDv7文字列       | 新しい文書のID。再送しても同じBlockを指すよう、作成要求と分ける |
| `create_document` | `requestId`、`baseVersion`、`blockId`         | `SavedDto`         |                                                                 |
| `update_body`     | `requestId`、`baseVersion`、`blockId`、`body` | `SavedDto`         |                                                                 |
| `retry_save`      | なし                                          | `SavedDto`         | backendに残った未保存の変更を保存（要求IDが分からない場合用）   |

errorは`{ kind, message, currentVersion }`。`kind`は`invalid_request`、`workspace_unavailable`、
`stale_version`、`request_reused`、`persist_pending`、`persist_failed`、`recovery_required`、
`nothing_to_retry`、`unknown_block`、`duplicate_block`、`no_body`、`storage`。保存・読込の原因は
hostのlogに残し、IPCへは汎用の文言だけを返す（path・SQLを出さない）。

capabilityは`capabilities/main.json`で、main windowに上の5
commandだけを許可する。plugin・filesystemの権限はない。
command名は`src/command_names.rs`を正本にし、`build.rs`のapp manifestとinvoke
handlerの一致を試験で確認する。

### Controllerの契約

- 本文の正本はbackend。Controllerはcommitted read modelを`workspace_view`で読み直して表示する。
- draftは文書ごとに保持し、保存失敗・競合では捨てない。保存した本文とdraftが一致したときだけ消す。
  保存中に入力が続いた場合は新しいdraftを残す。
- 変更要求は同時に一つ。busy中の保存要求は現在の保存の後に一度だけ実行する。
- 失敗した要求は保持し、`retry`で**同じ要求ID・同じ内容のまま**再送する。backendはreceiptで再送を認識し、
  二重に適用しない（保存後の応答喪失を含む）。最終的な失敗（ID不正・未知Block等）は再送しない。
- `stale_version`では最新の保存済み状態を読み直し、draftを残して再保存を促す。
- 読込は世代を持ち、古い応答が新しい状態を上書きしない。`dispose`後は何も公開しない。
- 保存はblurと`Ctrl+S`・保存ボタン。入力ごとの自動保存・IME区切り・Undoは段階C以降。

## 3. Release build

`vite.v3.config.ts`が`v3.html`だけを`dist-v3`へ出力し、`--features custom-protocol`でTauriに埋め込む。
release時のCSPは`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`。
開発時（`devCsp: null`）はVite serverを表示するためCSPを付けない。releaseではWindowsのconsole
windowを出さない。

## 4. 検証

- **Rust** `radiora-desktop`：DTOの検証（未知field・負の版・不正ID・UUIDv4のBlock
  ID・本文上限）とerror kindの直列化、同じ保存先での二重起動の拒否と解放後の再取得、manifestとinvoke
  handlerの一致。
- **U** `vitest/v3_body_editor_controller.svelte.test.ts`（12件）：受領記録を持つ小さなbackend
  modelで、
  保存・失敗時のdraft保持とretry・**保存後応答喪失の再送で二重適用しない**こと・保存中の入力・busy中の保存・
  競合・作成・古い読込応答・dispose後の非公開・要求ID不明の未保存変更を検査する。
- **U**
  `vitest/v3_tauri_workspace_adapter.test.ts`（7件）：引数の形、応答の検証（負の版・未知field・
  非UUID）、error DTOの写像、通信失敗の原因保持。
- **N（実機・2026-11-20）**：`RADIORA_V3_DATA_DIR`を一時領域に向け、WebView2のCDPで操作した。
  1. 開発版で「新しい文書」→本文入力（日本語・絵文字・改行）→blurで保存（版2）。
  2. アプリを終了し再起動すると、文書一覧と本文が版2で復元された。
  3. 同じ保存先で2つ目を起動すると「別のRadiora
     v3がこのワークスペースを開いています」を表示し、1つ目は動作を続けた。
  4. release build（dist-v3埋込み・CSP）でVite無しに起動し、同じデータを表示・保存できた（版3）。
     CSP下でstylesheetが適用され、外部URLへの`fetch`は拒否された。
- 実機の保存失敗（disk full等）はI試験の注入で代替しており、実機では未確認。

## 5. 未対応（後続）

- 参照項目の表示・`[[`補完・内部リンク・Undo・構造操作（段階C、#385・T-07）。
- 入力ごとの自動保存、IME変換中の扱い、ウィンドウを閉じる前の未保存draftの確認。
- 実Tauri E2Eの自動化driver（今回はCDPで手動実行）。CIへの接続はD2/D4の決定後。
- 版はworkspace全体の粒度（複数paneで不要な競合が出る）。
- 署名・installer・更新（T-09）。`bundle.active`は無効のまま。
