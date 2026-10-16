# Loro（`loro-crdt`）の UndoManager でアウトライン Undo/Redo を作る実験（2026-10-16）

決定: [ADR 0003](adr/0003-loro-edit-session-undo.md) / 契約: [編集セッションの Loro 導入契約](design/loro-edit-session.md)

## 状態

実験は完了し、次を実測した。Node 25（17 tests pass）、Deno 2.9.7（同一出力）、`tsc --strict`
（exit 0）、Vite 7.3.7 の build と dev、headless chromium によるブラウザ検証 11 項目
（`vite preview` と `vite` dev の両経路で pass）。数値と失敗モードは本書に記録する。

- **実行コードはこの main には含めない。** PoC は `poc/loro-undo` ブランチ
  （commit `7cd6826` と `44118b8`、base は main `259bdb9`）にある。main へは本書・ADR・設計メモだけを
  残す。以後の変更はこの 3 文書に対して行う。
- 本書と文書群の base は `origin/main` `8dc2eb8`（ブランチ `docs/loro-edit-session`）。
- 未検証: 実アプリへの統合、デスクトップ（CEF/Tauri）と Worker での wasm 読み込み、複数ペインでの
  同時編集、大規模アウトラインでの性能、undo → Recovery Snapshot → Revision の連続性。
  確認項目は [ADR 0003](adr/0003-loro-edit-session-undo.md) の統合時の確認事項に列挙した。

## 成果物の所在と再現

| 種別 | 場所 |
| --- | --- |
| 実験結果レポート（本書） | `docs/loro-undo-experiment-2026-10-16.md`（main） |
| 決定 | `docs/adr/0003-loro-edit-session-undo.md`（main） |
| 導入契約 | `docs/design/loro-edit-session.md`（main） |
| 実行コード（store / tests / demo / ブラウザデモ / Vite 設定 / 検証スクリプト） | `spikes/loro-undo/**` on `poc/loro-undo` |
| リポジトリの既存スパイク（参考形式） | `spikes/syncular-rust-ffi/**`（main。この PoC はコードを main に置かない点が異なる） |

```bash
# poc/loro-undo ブランチがローカルにある場合
git worktree add ../radiora-loro-poc poc/loro-undo
# リモートにある場合
git fetch origin poc/loro-undo && git worktree add ../radiora-loro-poc FETCH_HEAD
# ブランチが無い場合は commit を直接指定する
git worktree add ../radiora-loro-poc 44118b8

cd ../radiora-loro-poc/spikes/loro-undo
npm install                                          # loro-crdt 1.16.4 + vite
npm test                                             # 17 tests
npm run demo                                         # 挙動トランスクリプト
npm run build:web && npm run preview:web             # 別シェルで
npm run check:browser -- http://127.0.0.1:5200/      # 11 checks
npm run demo:web -- --port 5199                      # 別シェルで
npm run check:browser -- http://127.0.0.1:5199/      # 11 checks
```

型検査はリポジトリの typescript を借りて実行した:

```bash
node ../../../node_modules/typescript/bin/tsc --noEmit --strict --target es2022 \
  --lib es2022,dom,dom.iterable --module nodenext --moduleResolution nodenext \
  --allowImportingTsExtensions --skipLibCheck \
  loro_outline_store.ts loro_undo_test.ts loro_undo_demo.ts main.ts    # exit 0
```

## 目的

エディタの「元に戻す／やり直す」を、独自のコマンドスタックを書かずに CRDT ライブラリ Loro の
組み込み `UndoManager` で成立させられるかを、製品コード非侵入の PoC で確かめる。検証した問いは
4 つ。 (1) 構造操作とテキスト編集の両方を 1 操作 = 1 ステップで戻せるか。 (2) 複合操作のグループ化、
粒度制御、undo ラベルが得られるか。 (3) 他ピアの変更を巻き戻さず、結果が収束するか。
(4) 永続化（スナップショット）と履歴プレビュー、UndoManager の寿命が両立するか。

## Upstream・ライセンス・リスク評価

- **Upstream**: [loro-dev/loro](https://github.com/loro-dev/loro) / 公式: https://loro.dev
- **npm**: [`loro-crdt`](https://www.npmjs.com/package/loro-crdt) — **`1.16.4` に厳密固定**
- **ライセンス**: MIT（`npm view loro-crdt license`、パッケージ同梱の `LICENSE` を確認）
- **配布形態**: Rust core を WASM 化したバインディング。`browser` / `bundler` / `nodejs` / `web` /
  `base64` の entry を持つ。
- **ペイロード実測**:

  | ファイル | raw | gzip | brotli |
  | --- | --- | --- | --- |
  | `browser/loro_wasm_bg.wasm` | 3.24 MiB | 1.08 MiB | 0.75 MiB |
  | `browser/loro_wasm_bg.js`（glue） | 0.29 MiB | 0.04 MiB | 0.03 MiB |

- **リスク評価**（法的断定ではなく留意点）: WASM 3.24 MiB を同梱する。1.16.4 の型定義には
  `UndoManager.pause/resume`、`groupStart/groupEnd`、`clearUndo/clearRedo`、
  `topUndoValue/topRedoValue`、`onPush/onPop` メタデータが同居しており、undo 周辺は活発に拡張されて
  いる領域なのでバージョンを固定する。undo の意味論（削除の再作成など）はライブラリ固有で、
  乗り換えコストは小さくない。

## 実験の構成（`poc/loro-undo` ブランチ上のパス）

| ファイル | 役割 |
| --- | --- |
| `spikes/loro-undo/loro_outline_store.ts` | Loro doc + `LoroTree` + `UndoManager` をまとめた store。統合点 |
| `spikes/loro-undo/loro_undo_test.ts` | 挙動テスト 17 件（node:test） |
| `spikes/loro-undo/loro_undo_demo.ts` | 実行可能なトランスクリプト |
| `spikes/loro-undo/index.html` / `main.ts` | ブラウザ確認用の最小デモ |
| `spikes/loro-undo/vite.config.ts` | dev で loro-crdt を動かすための 2 設定（理由は後述） |
| `spikes/loro-undo/browser_check.mjs` | headless chromium による検証 11 項目 |
| `spikes/loro-undo/package.json` | `loro-crdt` を exact pin。devDependency は `vite` のみ |

読み取りは PoC では毎回 `tree.toJSON()` を使い、undo の意味論を隠さないようにした。実装では
`LoroEventBatch` の diff を購読して差分描画に置き換える。

## 実測した挙動

すべて `loro-crdt@1.16.4` 上で、この PoC のテストとデモにより実測した。

- **F1. 構造もテキストも同じ UndoManager で戻る。** 挿入の undo で項目が消え、redo で同じアプリ項目
  ID のまま復活する。タイトル編集の undo は本文を戻す（`mergeInterval: 0` で 1 操作 = 1 ステップ）。
- **F2. `mergeInterval` の既定は 1000 ms で、その窓内の連続コミットは 1 ステップに統合される。**
  実測: 挿入 + 連続 3 回のタイトル編集が `mergeInterval: 1000` で 1 ステップ、`0` で 4 ステップ。
- **F3. 複合操作は `groupStart/groupEnd` で 1 ステップにできる。** 3 操作を
  `transaction("項目を分割")` で包むと undo 1 回で 3 操作が戻り、ラベルは transaction 名になる。
- **F4. `excludeOriginPrefixes` でローカルだが undo 対象外のコミットを作れる。** `system:normalize`
  で commit した正規化は適用されるが undo スタックに入らず、undo は 1 つ前のユーザー操作に働く。
- **F5. undo はローカル。** ピア A の追加 → 同期 → ピア B の追加 → 同期 → A の undo で、A の追加だけが
  消え B の追加は残る。更新を交換すると両者は同一状態に収束する。
- **F6. 削除の undo は「復元」ではなく「再作成」。** サブツリーは内容ごと戻るが **TreeID は新しい値に
  なる**（実測 `5@30` → `12@30`）。元ノードは削除済み tombstone として `tree.nodes()` に残り、
  ハンドルも生きたままなので、古いハンドルへの書込は削除済みノードへの書込になる。
  → アプリ側の同一性は metadata のアプリ ID で持ち、TreeID を永続化しない。
- **F7. 削除の undo は並行する他ピアの編集を併合しない。** A が削除、B が同じ項目のタイトルを
  `abc` → `xyz` に変更した場合、A が削除を undo すると復活するのは **`abc`（削除前の内容）**で、
  B の `xyz` は破棄され両者は `abc` で収束する。
- **F8. undo/redo 自身が変更イベントを出す。** `undo()` は `by: "local"`, `origin: "undo"` のバッチを
  発行するので、購読側は通常のローカル変更と同じ経路で再描画できる。import の origin は空文字 `""`。
- **F9. 履歴プレビューは `pause()` で保護する必要がある。** 素の `checkout()` は undo/redo スタックを
  両方破棄する（実測: `canUndo` が true → checkout 後 false）。`pause()` →
  `checkout(過去)` → 読む → `checkout(最新)` → `resume()` の順で履歴を保持したまま読める。
  最新版へ戻すには checkout 前の frontiers を自前で控える必要がある。プレビュー中は
  `by: "checkout"` のイベントが飛ぶため、UI 側で分岐させる。
- **F10. undo 履歴はスナップショットに含まれない。** スナップショットを新しい store に import すると
  アウトラインは復元されるが `canUndo() === false`。履歴はセッション内のみ。
- **F11. undo ラベルは `onPush`/`onPop` のメタデータで付けられる。** `onPush` の第 1 引数は
  「push 先が undo 側か」を表し、**ローカル編集の push は `true`、undo による redo 積みは `false`**
  になる（直感と逆）。`onPop` でラベルを引き継ぐと `redoLabel()` も復元できる。戻り値には `cursors`
  も載せられるため、caret / 選択の復元に使える（PoC では空配列）。
- **F12. 履歴はメモリ上、段数は `maxUndoSteps`（既定 100）。** ドキュメントに入らないため保存されず、
  タブごとに独立する。
- **F13. Node と Deno の両方で同じコードが動く。** `node loro_undo_demo.ts` と
  `deno run -A --node-modules-dir=auto loro_undo_demo.ts`（Deno 2.9.7）が同じ出力を出す。
- **F14. Vite は dev と build で別 entry を解決し、素の dev は動かない**（次節）。
- **F15. 実ブラウザで undo/redo が動作する。** headless chromium の 11 項目が dev / preview の
  両経路で pass。

## Vite 統合の実測

`loro-crdt` は exports 条件で entry を切り替えるため、dev と build で別のコードパスに入る。

| 経路 | 解決される entry | 素の状態 | 必要な設定 |
| --- | --- | --- | --- |
| `vite build`（production） | `browser`（`browser.default`） | そのまま動く | なし |
| `vite`（dev server） | `bundler`（`browser.development`） | **HTTP 500 で失敗** | 下記 2 設定 |

- dev の失敗（実測）: `"ESM integration proposal for Wasm" is not supported currently. Use
  vite-plugin-wasm or other community plugins` — `bundler/index.js` が裸の
  `import "./loro_wasm_bg.wasm"` を行うため。
- `resolve.conditions` から `development` を外すと dev も `browser` entry を使い、dev と production で
  wasm の読み込み経路が一致する。
- ただしそれだけでは `WebAssembly.Module(): expected magic word 00 61 73 6d, found 3c 21 64 6f`
  で落ちる（実測）。dev の依存事前バンドルに取り込まれると
  `new URL("./loro_wasm_bg.wasm", import.meta.url)` がバンドル隣を指し、SPA フォールバックの HTML を
  同期 XHR が受け取るため。`optimizeDeps.exclude: ["loro-crdt"]` で解消する。
- **注意点**: `resolve.conditions` は client グラフ全体に効くため、`development` 条件に依存する他の
  依存は production ビルドを受け取るようになる。条件を既定のままにして `vite-plugin-wasm` を使い、
  dev は非同期ロード（`bundler` entry）、production は同期 XHR（`browser` entry）という dev / prod 差を
  許容する選択肢も比較したい（この代替案は未検証）。
- **production entry は同期 XHR で wasm を読む**（`browser/loro_wasm.js` の
  `loadWasmBytesSync`）。Worker では動かず、初回ロードがブロッキングになる。デスクトップ
  （CEF/Tauri）のカスタムプロトコル配信と併せて実測確認が要る。
- **ビルド出力（実測）**: `dist/assets/loro_wasm_bg-*.wasm` 3,398.78 kB（gzip 1,130.46 kB）、
  `dist/assets/index-*.js` 95.68 kB（gzip 15.96 kB）、build 時間 1.2〜1.5 秒。CI に bundle size の
  gate は無い。wasm は別アセットとして出力されるため、配信側で `application/wasm` を返す前提を
  確認する。
- **ブラウザ検証の内容**: 初期描画（wasm ロード成功）、ローカル挿入 → undo → redo、undo ラベルが
  UI に出る、他ピアの変更を取り込んだ後の undo がローカル操作だけを戻す、コンソール / ページ
  エラーなし、の 11 項目。

## 検証ログ

```
$ node loro_undo_test.ts
ℹ tests 17 / pass 17 / fail 0

$ tsc --noEmit --strict …（上記のコマンド）
exit 0

$ deno run -A --node-modules-dir=auto loro_undo_demo.ts     # Deno 2.9.7
Node と同じ出力

$ npm run build:web                                         # vite 7.3.7
dist/assets/loro_wasm_bg-*.wasm  3,398.78 kB │ gzip: 1,130.46 kB
dist/assets/index-*.js              95.68 kB │ gzip:    15.96 kB
✓ built in 1.22s

$ npm run check:browser -- http://127.0.0.1:5200/           # vite preview
PASS x11 → all browser checks passed

$ npm run check:browser -- http://127.0.0.1:5199/           # vite dev
PASS x11 → all browser checks passed
```

計測環境: Windows x86_64、Node 25.2.1、npm 11.14.1、Deno 2.9.7、Vite 7.3.7、chromium（Playwright
1.58.2 の headless）。検証時のサンドボックスでは `node --test <file>`（子プロセスの pipe 生成）と
Vite / esbuild（Windows の `net use` プローブ）が EPERM で拒否されたため、テストは `node <file>` の
直接実行、Vite は権限を広げた 1 回限りの実行で確認した。通常環境ではいずれも制約なく動く。

## 未検証・確認事項

- 永続化: スナップショット（`Uint8Array`）を既存の SQLite / RPC 境界のどこに置くか。revision /
  occurrence / branch の既存モデルとの整合とマイグレーション。
- 同期の運用: peer id の発行と寿命、UndoManager の寿命（peer は生存中に変更できない）、
  切断中の更新のバッファリング。
- 選択・caret の復元（`onPush` の `cursors`）。
- タイトル以外の状態（tag・relation・kind・branch）を CRDT に載せるか。PoC はアウトライン
  （ツリー + テキスト）のみで、本文の持ち方も実モデル（Branch ごとに 1 本文）とは異なる簡略化を含む。
- 性能: `items()` は毎回 `toJSON()`。tombstone の蓄積（F6 の再作成が繰り返されると削除済み
  ノードが増える）。
- 所有契約: 採用時は [UI state ownership](design/ui-state-ownership.md) に従い、Loro doc を正本と
  する state と undo の owner を決め、新 feature として分離するかを判定する。
- CI への組み込み: 実験コードは PoC ブランチの `spikes/loro-undo/**` にあり、main には無い。
  biome / deno fmt / deno test / knip の対象外なので、この文書群は既存の検証ゲートに影響しない。
  採用時はテストを `vitest/**` か `src/**/*_test.ts` へ移し、依存をルートの `package.json` へ移す。

## 参考

- [ADR 0003: 編集セッションの Undo/Redo に Loro を限定導入する](adr/0003-loro-edit-session-undo.md)
- [編集セッションの Loro 導入契約](design/loro-edit-session.md)
- 製品仕様: [product-direction](design/product-direction.md) §4.2 / §4.3 / §4.5 / §9.6
- PoC ブランチ: `poc/loro-undo`（commit `7cd6826` = PoC 本体、`44118b8` = Vite / ブラウザ検証）
- [Loro docs](https://loro.dev) / [loro-crdt (npm)](https://www.npmjs.com/package/loro-crdt) /
  [loro-dev/loro](https://github.com/loro-dev/loro)
- [Vite: WebAssembly](https://vite.dev/guide/features.html#webassembly)
