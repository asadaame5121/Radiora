# v3 製品Rust依存

決定日: 2026-10-31。ユーザー指定により、テストだけでなく初回Radiora全体の必要依存を追加した。
[architecture](v3-architecture.md)の3 crateをroot Cargo workspaceとして作成し、直接版を固定する。
Cargo.lockは製品workspace用。独立PoCはworkspaceからexcludeし、既存lock/manifestを変更しない。
crateのlib.rsはCargo targetを成立させる最小の宣言のみで、domain/adapter/Tauriアプリはまだ未接続。

## 採用一覧

| 配置               | crate / 固定版                     | 用途・feature判断                                                                                                  |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| core               | petgraph 0.8.3                     | graph表現・探索。std/stable_graphのみ。graph indexを永続ID/DTOへ漏らさない                                         |
| core               | pulldown-cmark 0.13.6              | 名前抽出/本文リンク解析。default無効、HTML renderer/CLI不要。CommonMark拡張と既存Markdown表示の一致はV05/V07で検証 |
| core               | unicode-normalization 0.1.26       | 名前/検索のNFKC。小文字化/空白規則は名前契約に従う                                                                 |
| core/infra/desktop | serde 1.0.229 / serde_json 1.0.154 | 型と境界DTO/backup manifest/fixture。derive有効。coreのJSONはtestのみ。deserialize後の意味的validationは別途必須   |
| core/infra         | thiserror 2.0.21                   | 型付きdomain/storage error。原因を保持し、desktopからの外部公開内容を制御                                          |
| core/infra         | uuid 1.29.0                        | coreはstd/serde、infraのみv7発行feature。core関数は発行済みIDを入力する                                            |
| infra              | loro 1.16.2                        | 単一Doc/Undo/差分。logging有効、未使用counter/jsonpath無効                                                         |
| infra              | rusqlite 0.32.1                    | bundled SQLite＋backup API。同期writer/transactionとsnapshot設計は保存sliceで実装                                  |
| infra              | sha2 0.11.1                        | backup/asset完全性照合。default無効。暗号化・発行者認証の代替にしない                                              |
| infra              | tempfile 3.27.0                    | 保存/restoreのstagingと試験一時DB。単独でatomic置換や停電耐性が保証されるとは扱わない                              |
| infra/desktop      | tracing 0.1.44                     | 保存phase/要求/障害の診断。本文・秘密情報をlogへ出さない                                                           |
| desktop            | tracing-subscriber 0.3.23          | fmt/env-filterのみ。subscriberの所有はhost                                                                         |
| desktop            | tauri 2.12.5                       | Tauri 2安定版のhost。標準desktop runtime featuresを維持                                                            |
| desktop build      | tauri-build 2.7.4                  | 後続のTauri設定/asset/capability build。今回はbuild.rs/config/実行入口をまだ作らない                               |
| desktop            | tauri-plugin-dialog 2.8.4          | native入出力dialog。汎用filesystem RPCを自作しない。plugin登録・capabilityは後続                                   |
| core/infra dev     | proptest 1.12.0                    | V01〜V13の生成/縮小/固定反例。stdのみ。crashは別process harnessで扱い、fork/timeout featureを先行導入しない        |

storageのLoro/rusqliteは既存PoCで検証した直接API版を維持する。
最新Loro/rusqliteへの一括更新はせず、V01/V11/V12のfixtureを製品へ接続してから更新判断する。
同版でもfeature/transitive解決はPoCと異なり得るため、PoCの緑を製品lock全体へ転記しない。
初回のlock解決ではloro-internal 1.17.1が選ばれ、Loro 1.16.2のcompileが失敗した。 Cargo.lockは cargo
update -p loro-internal --precise 1.16.2 で互換版へ固定した。
lock再生成/更新ではこの制約と全workspace checkを再確認する。registry内のソースは変更しない。 Tauri 3
alphaは採用しない。crate名のmajorが異なるTauri familyを同一patch版へ揃える必要はない。

## 役割と先送り

petgraphを採用しても世代/Knot/Topic投影の意味はcoreが所有する。
再帰tarjan_sccをそのまま選ばず、既存の反復Tarjan契約と深いgraphのV09試験を引き継ぐ。
Graphのserde化、rayon、DOT、別のgraph/layout crateは追加しない。 Svelte
Flow/ELKはFrontendの依存でありCargoへ追加しない。既存pnpm関連ファイルは今回の編集対象外。

SQLx/ORM/connection pool、独立async runtime、汎用DI/event busは追加しない。
writer実行方式はstdのthread/channelとTauri runtimeで足りるかを先に評価する。
索引はまず契約どおりの走査/SQLite再生成可能情報で検証し、Tantivy等を先行追加しない。 Markdown HTML
rendering/sanitizationは既存Viewとの接続時に責任を確認する。parser採用だけでXSS対策済みとしない。
圧縮archiveの形式/移行は未確定なのでzip等を今は選ばない。F13の完全backup自体は必須のまま。
iroh/atproto/HTTP client/暗号化、Slint/GPUI、syncularは将来案のまま追加しない。 OS
dialogのtransitive filesystem
pluginが存在しても、Frontendへ任意のファイル操作を許可する決定ではない。

## Cargoの運用と確認

root workspaceの通常対象はcore/infra。desktopを含む確認は必ず --workspace を指定する。 edition 2024
/ resolver 3、宣言rust-versionは1.90。最低版の実機合格は別途必要で、 手元のRust
1.98.1でのcheckを1.90対応の証明にしない。配布対象OSも各CIで確認する。 build成果物はroot
target/へ出しgitignoreする。PoCのmanifest/lockは引き続き独立実行する。

2026-10-31にCargo search/infoで版・featureを確認し、generate-lockfileとmetadataを実行した。 Windows
MSVC / Rust 1.98.1で cargo check --workspace --all-targets --locked が成功した。 cargo fmt --all --
--check、metadataで3 memberとcore/infraの直接依存境界も確認した。
依存のcompile合格であり、まだ製品testは存在せず、UI起動・機能受入・最低Rust版・他OSの合格ではない。

一次資料: [petgraph](https://docs.rs/petgraph/0.8.3/petgraph/),
[Markdown](https://docs.rs/pulldown-cmark/0.13.6/pulldown_cmark/),
[UUID](https://docs.rs/uuid/1.29.0/uuid/), [proptest](https://docs.rs/proptest/1.12.0/proptest/),
[Loro](https://docs.rs/loro/1.16.2/loro/), [SQLite](https://docs.rs/rusqlite/0.32.1/rusqlite/),
[Tauri](https://docs.rs/tauri/2.12.5/tauri/),
[dialog](https://docs.rs/tauri-plugin-dialog/2.8.4/tauri_plugin_dialog/)。 license
metadataは追加した直接依存がMIT/Apache-2.0系。配布artifactのtransitive
LICENSE/NOTICEと脆弱性検査はD3の残件。
