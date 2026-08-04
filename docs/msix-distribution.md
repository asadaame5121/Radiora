# Radiora MSIX配布手順

RadioraをMSIXパッケージとして配布するための手順と、SurrealDB CLIバンドル、
ライセンス同梱の設計をまとめる。

## 配布物の構成

MSIXパッケージには次のものが含まれる。

| 項目                           | 説明                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| Radiora launcher (CEF backend) | `deno desktop` が生成するWindows bundle                          |
| Deno runtime / CEF             | `denort.dll` と `libcef.dll` 群                                  |
| `surreal.exe`                  | SurrealDB CLI 3.x（`desktop:build` がbundleへコピー）            |
| `Licenses/`                    | サードパーティライセンス（`licenses`タスクが生成）               |
| アイコン                       | `Assets/*.png`（`desktop_msix`が`src/Radiora_icon.png`から生成） |

データは実行時に `%LOCALAPPDATA%\RadioraV2\surreal\main.db` へ保存する。
MSIXパッケージ本体は読み取り専用だが、`surreal.exe`はパッケージ内から実行でき、 RocksDBデータは
`%LOCALAPPDATA%` 側へ書かれるため問題ない。

## ビルド手順（Windows PowerShell）

```powershell
deno task desktop:build     # Windows bundle生成 + surreal.exeコピー
deno task desktop:msix      # ライセンス生成 + MSIX作成 + 署名
```

`desktop:msix` は次の順で実行される。

1. `scripts/licenses.ts` — npm実行時依存とランタイム（SurrealDB/Deno/CEF）の ライセンスを
   `dist-desktop/licenses/` と `dist/licenses/` へ出力
2. `scripts/desktop_msix.ts` — `dist-desktop/radiora-v2-windows/` を
   stagingへコピーし、`AppxManifest.xml` と `Assets/` を追加して `makeappx.exe`
   でパッケージ化、`signtool.exe` で署名

出力は `dist-desktop/Radiora_<version>_x64.msix`。

### 前提ツール

- Windows SDK（`makeappx.exe` / `signtool.exe` を含む）
- `WINDOWS_KIT_BIN` でbinディレクトリを指定すると検索を省略できる
- SurrealDB CLI 3.x が `%USERPROFILE%\.surrealdb\surreal.exe` か `RADIORA_SURREAL_BUNDLE_SOURCE`
  で指定した場所にあること

### 署名オプション

- `--cert <pfx> --cert-password <password>`: 実証明書で署名
- `--publisher "CN=..."`: Publisher表示名（署名証明書のSubjectと一致させる）
- `--version x.y.z.w`: パッケージバージョン（既定は `deno.json` の `version`）
- 省略時は開発用自己署名証明書を生成し、 `dist-desktop/radiora-dev-signing.pfx` を再利用する

### テストインストール

自己署名の場合は、テスト機で証明書を信頼してからインストールする。

```powershell
certutil -addstore Root dist-desktop\radiora-dev-signing.cer
Add-AppxPackage -Path dist-desktop\Radiora_0.1.0.0_x64.msix
```

起動確認後、`Remove-AppxPackage` でアンインストールできる。バージョンを上げた パッケージはそのまま
`Add-AppxPackage` で更新される。

## SurrealDB CLIの探索順序

`src/desktop/surreal_process.ts` の `findCommand()` は次の順で探索する。

1. bundle内（`Deno.execPath()` の隣の `surreal.exe`）— 配布物はここを使う
2. `surreal`（PATH）
3. `%USERPROFILE%\.surrealdb\surreal.exe` — 開発環境の従来インストール先

## ライセンス

- **SurrealDB CLI は Business Source License 1.1**。このアプリの利用形態
  （ローカル埋め込み・利用者自身のデータ保存）はAdditional Use Grantの 「Database
  Service」に該当しないため、バンドル配布・商用利用が可能。
  ライセンス全文の同梱は必須（`docs/licenses/surrealdb-cli-BSL-1.1.txt`）。 Change
  Date（3.0は2030-01-01）以降はApache 2.0へ自動移行する。
- Deno / Deno Desktop runtime は MIT、CEFはBSD-3-Clause系。
  CEFにはChromiumのライセンス条件も適用される（`chromium-LICENSE.txt`）。
- npm依存は `package-lock.json` の実行時依存から `scripts/licenses.ts` が
  自動収集する。devDependencies（ビルドツール）は含まれない。
- ライセンス表示はMSIX内の `Licenses/` と、アプリ内の 「Option →
  ライセンス」ダイアログ（`/licenses/` 配信）の両方で提供する。

### 更新時の注意

- SurrealDB CLIのバージョンを上げた場合は、そのバージョンのLICENSEが BSL
  1.1のままか確認し、`docs/licenses/surrealdb-cli-BSL-1.1.txt` を更新する
- npm依存の追加・更新後は `deno task licenses` で収集結果を確認する

## Microsoft Store提出時の変更点

Store署名が自動付与されるため、独自のコード署名は不要になる。次の点を Partner
Centerの予約値に合わせて変更する。

- `AppxManifest.xml` の `Identity/Name`（Store予約名）
- `Identity/Publisher`（Store発行のPublisher CN）
- `desktop:msix` タスク実行時に `--publisher` を渡す

`radiora://` プロトコルは `uap:Extension Category="windows.protocol"` として
宣言済み。bundle内のdeep-link登録スクリプトと重複しないよう、MSIXでは プロトコル宣言を優先する。
