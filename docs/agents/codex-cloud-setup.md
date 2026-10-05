# Codex Cloudのagent toolsセットアップ

Cloud環境のSetup script欄に、既存の依存関係セットアップに加えて以下を設定する。
このスクリプトを含むcommitがCloud側で取得できることが前提。

```bash
bash scripts/codex_cloud_setup.sh
```

Linux環境に`curl`と`mise`が必要。スクリプトは提示された公式installerでhashlineとffsを導入し、
`mise use -g ast-grep`でast-grepを導入する。最後に3つのversionを確認し、失敗時はセットアップを終了する。
アプリ本体の依存関係のインストールは既存のセットアップで行う。

インターネット接続はセットアップ中のインストールにだけ使う。Agent internet accessは無効のままとし、
agent実行中は導入済みの3つのCLIを利用する。axは導入しない。
更新・再インストールはセットアップ時に行う。インストール時点の最新版を取得するため、version出力を
セットアップログで確認する。

Setup scriptはagentと別のBash sessionで実行され、`export`だけではPATHを引き継げない。
そのため`~/.local/bin`を`~/.bashrc`の先頭でPATHへ追加する。ast-grepはmiseが導入した実体へ
同じディレクトリからsymlinkを張り、agent実行時のmise activationを不要にする。
ffsのMCP自動登録は無効にし、CloudではCLIで利用する。hashlineのinstallerにはMCP自動設定が
含まれるが、Cloudでの利用はCLIを前提とする。

環境設定へのスクリプト登録後、セットアップのテストと新しいCloud taskで以下を確認する。

```bash
command -v hashline ffs ast-grep
hashline --version
ffs read AGENTS.md --budget 5000
ast-grep --version
```

シェルが`~/.bashrc`を読まない場合は、そのシェルで`export PATH="$HOME/.local/bin:$PATH"`を実行する。
既存の環境キャッシュを使っていてツールが見つからない場合は、環境のcacheをresetしてセットアップを再実行する。

仕様の参照: [OpenAI公式のCloud環境・セットアップ説明](https://learn.chatgpt.com/docs/environments/cloud-environment)。
