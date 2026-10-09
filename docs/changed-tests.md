# 日常の差分テスト

```sh
npm run test:changed
deno task test:staged
```

`deno task test:changed` / `npm run test:staged` も利用できます。初期導入は手動実行のみで、
pre-commitには接続していません。

## 対象範囲とフォールバック

- `changed` はステージ済み・未ステージ・Gitのignore対象でない未追跡ファイルの和集合、 `staged`
  はステージ済みのパスだけを対象にします。
  **どちらも現在の作業ツリーの内容をテストします**。indexだけの内容をcheckoutしたり、
  未ステージ変更をstashしたりはしません。
- `src/ui/**/*.svelte`、`*.svelte.ts`、`vitest/` はVitest unitの
  `related --run`で関連テストを選択します。削除時、または関連テストが0件ならunit全体へ
  フォールバックします。unit専用設定は通常のVitest構成と共通のVite/Svelte設定を使い、
  Storybook/browserの起動処理は読み込みません。
- その他の `src/`・`tests/`・`scripts/` の `*.ts` は同じ場所の `*_test.ts` と、 `tests/`配下の同名
  `*_test.ts` を選択します。テスト自体の変更はそのテストを実行します。
  削除・対応不明の共有モジュールは `deno test -A src tests scripts` にフォールバックします。
  `src/ui/` の通常の `*.ts` はDenoとVitestの両方で選択します。
- renameは旧パスの削除と新パスの追加として扱います。設定・lockfile・fixture・assetなど、
  上記に分類できない変更はDenoとVitest unitの全体を実行します。
  空の差分・Markdownだけの変更は理由を表示して終了します。
- 関連テスト0件を黙って成功にはしません。コンパイルエラー・テスト失敗・不正なVitest
  レポートは失敗として返します。

## 全体検証を使う場面

Deno側は同名対応の規約であり、推移的な依存解析は行いません。差分テストはTDDの反復用です。
共有モジュールの影響確認、PR前、依存関係や設定の変更後、lint・format・型検査・buildを含む
最終確認には **`deno task verify`** を使ってください。Storybook・Playwrightの操作/a11y/
画像差分は差分タスクの対象外です。必要な場合は `npm run test:storybook`、`npm run test:ui`、
`npm run test:a11y`、`npm run test:visual` を実行します。

## 速度の測り方

依存関係導入済み（`npm ci`）、Deno/Viteキャッシュがある状態で同じ差分を一度実行してから、
同じコマンドを3回測定し、中央値を使います。新しいプロセスの起動、Git検出、テスト選択、
テスト実行、終了までを含めます。依存取得・初回変換を含むcold実行や、全体フォールバックは
「代表的な小変更のwarm実行」と分けて記録してください。

Windowsでは、例えば変更が `src/ui/theme_controller.svelte.ts` だけの状態で：

```powershell
deno task test:changed # warm-up
1..3 | ForEach-Object { (Measure-Command { deno task test:changed }).TotalSeconds }
```

Linuxでは同じ条件で `time deno task test:changed` を3回実行します。
UIの代表ケースは上記Controller、Denoの代表ケースは
`src/services/markdown_source_scanner.ts`です。3秒は目安であり、必須の完了条件ではありません。
Windows（Deno 2.9.7 / Node 25.2.1 / Vitest 4.1.10）の導入時確認では、unit専用設定のVitest
関連実行だけでもwarmのwall timeが6.9〜7.2秒でした（3回、初回を除く後続2回）。
これはGit検出を含まない内部Vitestコマンドの計測で、Vitestが表示するテスト区間の
1.4〜1.5秒とも異なります。単一差分での日常タスク全体とLinuxでの速度は未計測です。
