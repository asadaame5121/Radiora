# Spike: Loro (`loro-crdt`) の組み込み UndoManager でアウトライン Undo/Redo を作る（実行コード）

このブランチは**実行コードだけ**を持つ。実験結果レポート・ADR・設計メモは main 側の `docs/` に置く。

| 文書（main） | 内容 |
| --- | --- |
| `docs/loro-undo-experiment-2026-10-16.md` | 実験結果レポート（実測 F1〜F15、Vite 統合の失敗モードと 2 設定、検証ログ、再現手順） |
| `docs/adr/0003-loro-edit-session-undo.md` | 決定（Loro を編集セッションの live state に限定導入する） |
| `docs/design/loro-edit-session.md` | 採用時の契約（所有表、データ対応、ライフサイクル、undo の意味論、検証計画） |

要約: Loro の `UndoManager` だけで、アウトラインの構造操作（追加・移動・削除）と本文編集の
undo/redo が 1 操作 = 1 ステップで成立する。削除の undo は再作成であり TreeID は変わること、
並行編集は併合されないこと、undo 履歴はスナップショットに含まれないことを実測した。
詳細と数値は上記レポートにある（同じ内容の README は commit `44118b8` にも残っている）。

```
ブランチ: poc/loro-undo（commit 7cd6826 = PoC 本体、44118b8 = Vite / ブラウザ検証）
base:     main 259bdb9
```

## 実行

```bash
cd spikes/loro-undo
npm install                                          # loro-crdt 1.16.4（exact pin）+ vite
npm test                                             # 17 tests (node:test)
npm run demo                                         # 挙動トランスクリプト

# ブラウザ確認（2 経路）
npm run build:web && npm run preview:web             # 別シェルで
npm run check:browser -- http://127.0.0.1:5200/
npm run demo:web -- --port 5199                      # 別シェルで
npm run check:browser -- http://127.0.0.1:5199/
```

`browser_check.mjs` は Playwright を解決できる必要がある（このリポジトリの root にあれば動く。
無ければ `npm i -D playwright && npx playwright install chromium`）。

型検査:

```bash
node ../../../node_modules/typescript/bin/tsc --noEmit --strict --target es2022 \
  --lib es2022,dom,dom.iterable --module nodenext --moduleResolution nodenext \
  --allowImportingTsExtensions --skipLibCheck \
  loro_outline_store.ts loro_undo_test.ts loro_undo_demo.ts main.ts
```

## ファイル

| ファイル | 役割 |
| --- | --- |
| `loro_outline_store.ts` | Loro doc + `LoroTree` + `UndoManager` をまとめた store。統合点 |
| `loro_undo_test.ts` | 挙動テスト 17 件（node:test） |
| `loro_undo_demo.ts` | 実行可能なトランスクリプト |
| `index.html` / `main.ts` | ブラウザ確認用の最小デモ（undo/redo ボタンと他ピア相当の pane） |
| `vite.config.ts` | dev で loro-crdt を動かすための 2 設定（理由はレポート参照） |
| `browser_check.mjs` | headless chromium による検証 11 項目 |
| `package.json` / `package-lock.json` / `deno.lock` | `loro-crdt` 1.16.4 の固定（npm と Deno） |
