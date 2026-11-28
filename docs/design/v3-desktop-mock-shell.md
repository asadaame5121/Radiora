# v3 デスクトップ mock shell（段階A）

作成日: 2026-11-19。状態: 実装済みの開発用起動経路。製品機能・保存・#385の受入ではない。
[移行計画](tauri-migration-plan.md)のV1「mock
shell」に当たり、保存PoC（#383）やImporter（#384）と並行できる。

## 1. 何ができるか

`radiora-desktop` crateをTauri 2のhostとして起動し、既存Svelte UIを`vite --mode mock`の dev
serverから表示する。UIの`/api/*`呼出しはVite middleware（`scripts/mock_ui_plugin.ts`）が
固定fixtureで応答する。Rust側はwindowの作成と終了だけを担当する。

```powershell
mise run desktop:mock
```

`scripts/v3_desktop_mock.ts`が`127.0.0.1:5173`でViteを起動し、応答を確認してから
`cargo run -p radiora-desktop`を実行する。windowを閉じるとViteも停止する。
ポートは`crates/radiora-desktop/tauri.conf.json`の`devUrl`と一致させる。
起動前に入口`src/ui/main.ts`を一度要求して変換を温めるが、Viteのcacheがない初回は
未bundleのmodule群を読み込むため、windowが空のまま1分程度かかることがある（2026-11-19の実測）。

Windowsのworktreeでcargoが権限エラーになる場合は、`CARGO_TARGET_DIR`と`TMP`/`TEMP`を
worktree外へ向けてから実行する。

## 2. 構成

| ファイル                                 | 役割                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `crates/radiora-desktop/src/main.rs`     | 実行入口。起動失敗を終了コードへ変換する。releaseではWindowsのconsole windowを出さない |
| `crates/radiora-desktop/src/lib.rs`      | composition root。tracing初期化と`tauri::Builder`の実行のみ                            |
| `crates/radiora-desktop/build.rs`        | `tauri_build::build()`。生成物`gen/`はgit管理しない                                    |
| `crates/radiora-desktop/tauri.conf.json` | `devUrl`、window、iconの設定。bundleは無効                                             |
| `scripts/v3_desktop_mock.ts`             | Viteとhostの起動・停止の調停                                                           |

`custom-protocol` featureを付けないbuildはTauriのdev modeになり、`devUrl`を表示して
`frontendDist`を埋め込まない。そのため`dist/`がなくてもbuild・clippy・testは通る。

## 3. 意図的に未対応の範囲

- **invoke/DTO:** #403で読取りcommand `read_saved_workspace`
  と、それだけを許可するcapabilityを追加した （[v3 IPC read model](v3-ipc-read-model.md)）。mock
  shellのUIはまだ呼ばない。書込みcommandはfeat Bで追加する。
- **CSP:** dev serverを表示するため`csp: null`。製品assetを埋め込むrelease経路（T-09）で CSPとWorker
  assetを決める。
- **release build:** mock APIはVite middlewareにしか存在しないため、`--release`は拒否する。
  `frontendDist`は将来の埋込み先として`../../dist`を指すだけで、現状のreleaseでは動作しない。
- **データ:** 起動時に`RADIORA_V3_DATA_DIR`（未設定ならapp-local data
  `dev.radiora.v3`）のworkspaceを開く（無ければ空で作る）。 mock
  shellのUIはそれを読み書きしない。v2の`%LOCALAPPDATA%\RadioraV2`には触れない。
- **plugin:** `tauri-plugin-dialog`は依存のみで未登録。

## 4. 次の作業（未合意の見込み）

#385の「invoke adapterと独立DTOを経由する」に従い、IPCはv2の`RadioraBindings`を写さず
本文slice用の独立DTOで追加する見込み。既存Svelte UIを使うか最小画面を新設するか、
command名・DTO・版の表現は#403で[v3 IPC read model](v3-ipc-read-model.md)に決めた。
見出しの「段階A」は作業上の区切りで、合意した計画ではない。
