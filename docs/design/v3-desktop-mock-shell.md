# v3 デスクトップ mock shell（段階A）

作成日: 2026-11-19。更新: 2026-11-20（段階B3〜B5の接続に合わせて起動方法・権限・CSPを更新）。 状態:
実装済みの開発用起動経路。製品機能・保存・#385の受入ではない。
本文sliceのv3画面は[段階B3〜B5](v3-body-slice-desktop.md)を参照する。
[移行計画](tauri-migration-plan.md)のV1「mock
shell」に当たり、保存PoC（#383）やImporter（#384）と並行できる。

## 1. 何ができるか

`radiora-desktop` crateをTauri 2のhostとして起動し、既存Svelte UIを`vite --mode mock`の dev
serverから表示する。UIの`/api/*`呼出しはVite middleware（`scripts/mock_ui_plugin.ts`）が
固定fixtureで応答する。Rust側はwindowの作成と終了だけを担当する。

```powershell
mise run desktop:mock
```

`scripts/v3_desktop_dev.ts --mock-shell`が`127.0.0.1:5173`でViteを起動し、応答を確認してから
`RADIORA_V3_PAGE=mock-shell`を付けて`cargo run -p radiora-desktop`を実行する。hostはmain windowに
`index.html`を表示し、workspaceを開かない。windowを閉じるとViteも停止する。
ポートは`crates/radiora-desktop/tauri.conf.json`の`devUrl`と一致させる。
起動前に入口`src/ui/main.ts`を一度要求して変換を温めるが、Viteのcacheがない初回は
未bundleのmodule群を読み込むため、windowが空のまま1分程度かかることがある（2026-11-19の実測）。

Windowsのworktreeでcargoが権限エラーになる場合は、`CARGO_TARGET_DIR`と`TMP`/`TEMP`を
worktree外へ向けてから実行する。

## 2. 構成

| ファイル                                 | 役割                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `crates/radiora-desktop/src/main.rs`     | 実行入口。起動失敗を終了コードへ変換する。releaseではWindowsのconsole windowを出さない    |
| `crates/radiora-desktop/src/lib.rs`      | composition root。表示するpage（`v3.html`／mock shellの`index.html`）を選んでwindowを作る |
| `crates/radiora-desktop/build.rs`        | app manifest付きの`tauri_build::try_build`。生成物`gen/`はgit管理しない                   |
| `crates/radiora-desktop/tauri.conf.json` | `devUrl`、`frontendDist`（`dist-v3`）、CSP、iconの設定。bundleは無効                      |
| `scripts/v3_desktop_dev.ts`              | Viteとhostの起動・停止の調停（`--mock-shell`で段階A）                                     |

`custom-protocol` featureを付けないbuildはTauriのdev modeになり、`devUrl`を表示して
`frontendDist`を埋め込まない。そのため`dist/`がなくてもbuild・clippy・testは通る。

## 3. 段階B以降の変化と残る制約

- **invoke/権限:** 本文sliceの5 commandと、main windowだけに許可するcapabilityを追加した（段階B3）。
  mock shellのpageはIPCを使わず、workspaceも開かないため、commandは`workspace_unavailable`を返す。
- **CSP:** releaseで埋め込む`dist-v3`に厳格なCSPを付けた。開発時は`devCsp: null`でVite
  serverを表示する。
- **release build:** mock APIはVite middlewareにしか存在しないため、mock shellのreleaseはない。
  releaseは`dist-v3`（v3画面）だけを埋め込む。
- **データ:** mock shellは何も保存しない。v2の`%LOCALAPPDATA%RadioraV2`にも触れない。
- **plugin:** `tauri-plugin-dialog`は依存のみで未登録。
