# Spike: Loro (`loro-crdt`) の組み込み UndoManager でアウトライン Undo/Redo を作る

```
ワークツリー: output/loro-undo-poc     ブランチ: poc/loro-undo (base: main = 259bdb9)
変更範囲:     spikes/loro-undo/** のみ (アプリコード・既存テストには触れていない)
```

## 1. 目的

Radiora には今のところ「エディタ操作を元に戻す」実装がない (`src` に undo/redo の実装は存在しない)。
本 Spike は、**CRDT ライブラリ Loro を導入し、その同梱 `UndoManager` だけでアウトライン編集の
Undo/Redo を成立させられるか**を、製品コード非侵入の Throwaway PoC (`spikes/loro-undo/**`) として
検証する。

検証したい問いは 4 つ:

1. ツリー構造の操作 (追加・移動・削除) とテキスト編集の両方を、1 操作 = 1 ステップで戻せるか。
2. 独自のコマンドスタックを書かずに、複数操作のグループ化・粒度制御・undo ラベルが得られるか。
3. 他ピア (同期・共同編集) の変更を undo が巻き戻さないか。巻き戻した結果が収束するか。
4. 永続化 (スナップショット) と履歴プレビュー (revision 表示) と UndoManager の寿命が両立するか。

成果物は「動く最小の store + 実測した挙動 + 本実装への含意」であり、UI 統合や DB スキーマ変更は
含まない (Section 7 に未検証項目として列挙する)。

## 2. Upstream 情報・ライセンス・リスク評価

- **Upstream**: [github.com/loro-dev/loro](https://github.com/loro-dev/loro) / 公式: https://loro.dev
- **npm**: [`loro-crdt`](https://www.npmjs.com/package/loro-crdt) — **`1.16.4` に厳密固定**
  (`spikes/loro-undo/package.json` の dependencies)
- **ライセンス**: MIT (`npm view loro-crdt license` = MIT、パッケージ同梱の `LICENSE` も確認済み)
- **配布形態**: Rust core を WASM 化した JS バインディング。`browser` / `bundler` / `nodejs` / `web`
  の 4 エントリを持つ。
- **ペイロード実測** (本 PoC のワークツリーで計測):

  | ファイル | raw | gzip | brotli |
  | --- | --- | --- | --- |
  | `browser/loro_wasm_bg.wasm` | 3.24 MiB | 1.08 MiB | 0.75 MiB |
  | `browser/loro_wasm_bg.js` (glue) | 0.29 MiB | 0.04 MiB | 0.03 MiB |

- **リスク評価** (法的断定ではなく客観的な留意点):
  - **ペイロード**: WASM 3.24 MiB を同梱する。デスクトップ配布 (Tauri/CEF) では許容範囲だが、
    Web 配信では初回ロード 1 MiB 超 (gzip) が追加される。
  - **API の更新速度**: 1.16.4 の型定義には `UndoManager.pause/resume`、`groupStart/groupEnd`、
    `clearUndo/clearRedo`、`topUndoValue/topRedoValue`、`onPush/onPop` メタデータなど、
    比較的新しい API が同居している。undo 周りは活発に拡張されている領域なので、
    minor 更新時の差分確認を前提にバージョンを固定する。
  - **単一ベンダー依存**: CRDT の実装詳細 (undo の再作成挙動など) がこのライブラリの意味論に
    従う。Section 5 の F6/F7 はその代表例で、乗り換えコストは小さいとは言えない。

## 3. PoC の構成

| ファイル | 役割 |
| --- | --- |
| [`loro_outline_store.ts`](./loro_outline_store.ts) | Loro doc + `LoroTree` + `UndoManager` をまとめた store。これが「統合点」 |
| [`loro_undo_test.ts`](./loro_undo_test.ts) | 挙動テスト 17 件 (node:test)。F1〜F12 の根拠 |
| [`loro_undo_demo.ts`](./loro_undo_demo.ts) | 実行可能なトランスクリプト (`npm run demo`) |
| [`index.html`](./index.html) / [`main.ts`](./main.ts) | ブラウザ確認用の最小デモ |
| [`vite.config.ts`](./vite.config.ts) | **Vite dev で loro-crdt を動かすために必要な 2 設定** (理由はコメントと §7.1) |
| [`browser_check.mjs`](./browser_check.mjs) | 実ブラウザ検証 (Playwright)。dev / preview 両方で 11 項目 |
| [`package.json`](./package.json) | `loro-crdt` を exact pin。devDependency は `vite` のみ |
| `package-lock.json` / `deno.lock` | npm と Deno それぞれの依存固定 (どちらも同じ 1.16.4) |

```bash
cd spikes/loro-undo
npm install                 # loro-crdt + vite (アプリの node_modules とは独立)
npm test                    # 17 tests
npm run demo                # 挙動トランスクリプト

# ブラウザ確認 (2 経路)
npm run build:web && npm run preview:web     # 別シェルで
npm run check:browser -- http://127.0.0.1:5200/
npm run demo:web -- --port 5199              # 別シェルで
npm run check:browser -- http://127.0.0.1:5199/
```

型検査 (リポジトリの typescript を借りる):

```bash
node ../../../node_modules/typescript/bin/tsc --noEmit --strict --target es2022 \
  --lib es2022,dom,dom.iterable --module nodenext --moduleResolution nodenext \
  --allowImportingTsExtensions --skipLibCheck \
  loro_outline_store.ts loro_undo_test.ts loro_undo_demo.ts main.ts
# => exit 0
```

## 4. Radiora への対応付け

| Radiora の概念 | PoC の実装 | 備考 |
| --- | --- | --- |
| 作品 1 つのアウトライン | `LoroDoc` の `LoroTree("outline")` | ルートは `parentId: null` |
| 項目 ID (DB / RPC の同一性) | ノード metadata `itemId` | **TreeID は永続化しない** (F6) |
| 項目タイトル (エディタ本文) | ノード metadata の `LoroText` | `update()` が最小差分を適用する |
| ユーザー操作 1 回 | `commit({ origin, message })` 1 回 | origin = `ui:outline`、message = undo ラベル |
| 「分割」「貼り付け」等の複合操作 | `store.transaction(label, fn)` | `groupStart/groupEnd` に対応 |
| 正規化・移行などの内部変更 | origin `system:*` | `excludeOriginPrefixes` で undo 対象外 (F4) |
| Ctrl+Z / Ctrl+Shift+Z | `store.undo()` / `store.redo()` | `canUndo/canRedo` + ラベルを UI に渡す |
| 変更通知 → 再描画 | `store.subscribe((change) => …)` | `by: local/import/checkout` と origin を渡す |
| 履歴パネルのプレビュー | `store.previewAt(frontiers, read)` | `pause()` + `checkout()` (F9) |
| 端末間の同期 | `exportSnapshot/exportUpdate` + `applyUpdate` | RPC への載せ方は未検証 |

読み取りは PoC では毎回 `tree.toJSON()` を使っている (undo の意味論を隠さないため)。実装では
`LoroEventBatch` の diff を購読して差分描画に置き換える。

## 5. 実測した挙動 (この PoC の主張)

すべて `loro-crdt@1.16.4` 上で本ワークツリーのテスト/デモにより実測した。

- **F1. 構造もテキストも同じ UndoManager で戻る。** 挿入の undo で項目が消え、redo で同じアプリ
  項目 ID のまま復活する。タイトル編集の undo は本文を戻す (`mergeInterval: 0` で 1 操作 = 1 ステップ)。
- **F2. `mergeInterval` の既定は 1000 ms で、その窓内の連続コミットは 1 ステップに統合される。**
  実測: 挿入 + 連続 4 回のタイトル編集が `mergeInterval: 1000` で 1 ステップ、`0` で 4 ステップ。
  キー入力のたびに commit する設計なら打鍵単位でまとまる。Radiora の「1 操作 = 1 回の
  Ctrl+Z」を守るには `0` を既定にする (PoC の store は `0` が既定)。
- **F3. 複合操作は `groupStart/groupEnd` で 1 ステップにできる。** 3 操作を `transaction("項目を分割")`
  で包むと、undo 1 回で 3 操作が戻り、ラベルは transaction 名になる (`undoLabel()` = `項目を分割`)。
- **F4. `excludeOriginPrefixes` でローカルだが undo 対象外のコミットを作れる。** `system:normalize`
  で commit した正規化は適用されるが undo スタックに入らず、undo は 1 つ前のユーザー操作
  (項目追加) に対して働く。origin の命名規約を先に決める必要がある。
- **F5. undo はローカル。** ピア A が追加 → 同期 → ピア B が追加 → 同期 → A が undo すると、
  A の追加だけが消え B の追加は残る。更新を交換すると両者は同一状態に収束する (テストで確認)。
- **F6. 削除の undo は「復元」ではなく「再作成」。** `tree.delete()` を undo すると、サブツリーは
  内容ごと戻るが **TreeID は新しいノードになる** (実測: `5@30` → `12@30`)。元ノードは削除済みの
  tombstone として `tree.nodes()` に残り、ハンドルも生きたままなので、**古いハンドルに書くと
  削除済みノードに書くことになる**。→ アプリ側の同一性は metadata の `itemId` で持つ (PoC の
  `#findNode` は `isDeleted()` を除外して解決している)。TreeID を DB に保存してはいけない。
- **F7. 削除の undo は並行する他ピアの編集を併合しない。** A が削除・B が同じ項目のタイトルを
  `abc` → `xyz` に変更した場合、A が削除を undo すると復活するタイトルは **`abc` (削除前の内容)**
  で、B の `xyz` は破棄され、両ピアは `abc` で収束する。協調編集下での「削除の取り消し」は
  ローカルな復旧操作であると UI で扱う (undo 後に「他端末の編集は復元されない」旨の告知が必要)。
- **F8. undo/redo 自身が変更イベントを出す。** `undo()` は `by: "local"`, `origin: "undo"` の
  バッチを発行するので、購読側は通常のローカル変更と同じ経路で再描画できる。import の origin は
  空文字 `""` なので、PoC の store では `undefined` に正規化して公開している。
- **F9. 履歴プレビューは `pause()` で保護する必要がある。** 素の `checkout()` は undo/redo スタックを
  両方破棄する (実測: `canUndo` が true → checkout 後 false)。`previewAt` は
  **「最新 frontiers を控える → `pause()` → `checkout(old)` → 読む → `checkout(latest)` → `resume()`」**
  の順で行い、履歴を保持したままタイトルを読める (テストで確認)。なおプレビュー中は
  `by: "checkout"` のイベントが飛ぶため、UI 側は「プレビュー用の再描画」として分岐させる。
  また最新版に戻すには checkout 前の frontiers を自前で控える必要がある (Loro に
  「最新へ戻す」ヘルパーはない)。
- **F10. undo 履歴はスナップショットに含まれない。** スナップショットを新しい store に import すると
  アウトラインは完全に復元されるが `canUndo() === false`。履歴はセッション内のみで、
  アプリ再起動・復元後の undo は空になる。要件次第では既存の revision/occurrence と併用する。
- **F11. undo ラベルは `onPush`/`onPop` のメタデータで付けられる。** `onPush(isUndoStack, range, event)`
  の第 1 引数は「push 先が undo 側か」を表し、**ローカル編集の push は `true`、undo による redo 積みは
  `false`** になる (直感と逆なので注意)。`onPop` でラベルを引き継ぐと `redoLabel()` も復元できる。
  PoC は `commit({ message })` のラベル文字列をそのまま添付し、UI 用に `undoLabel()/redoLabel()`
  を公開している。`onPush` の戻り値には `cursors` も載せられるため、将来の caret/選択復元に使える
  (PoC では空配列)。
- **F12. 履歴はメモリ上、段数は `maxUndoSteps` (既定 100)。** ドキュメントには入らないため、
  undo 段数は保存されず、タブごとに独立する。
- **F13. Node と Deno の両方で同じコードが動く。** 実測:
  `node loro_undo_demo.ts` と
  `deno run -A --node-modules-dir=auto loro_undo_demo.ts` (Deno 2.9.7) が同じ出力を出す。
  リポジトリの `deno test` 系に載せることも技術的には可能。
- **F14. Vite は dev と build で別 entry を解決し、素の dev は動かない。** `vite build` は
  `browser` entry (同期 XHR + `new URL(..., import.meta.url)`) でそのまま成功するが、`vite` (dev)
  は `bundler` entry (裸の `.wasm` ESM import) に入り HTTP 500 になる。`resolve.conditions` の
  `development` 除去 + `optimizeDeps.exclude` の 2 設定で dev も同じ entry になり動作する
  (詳細と代替案は §7.1)。
- **F15. 実ブラウザで undo/redo が動作する。** headless chromium で、初期描画 (wasm ロード)、
  ローカル挿入 → undo → redo、undo ラベル表示、他ピア変更を取り込んだ後の undo が
  ローカル操作だけを戻すこと、コンソールエラーなし、の 11 項目が dev / preview の両経路でパス。
  ビルド出力は wasm 3,398.78 kB (gzip 1,130.46 kB) + JS 95.68 kB (gzip 15.96 kB)。

## 6. 判定

- **Loro の `UndoManager` は Radiora のアウトライン Undo/Redo 要件を満たす。** 構造 + テキストの
  1 操作単位の undo、複合操作のグループ化、粒度制御 (`mergeInterval`)、システム変更の除外、
  undo ラベル、他ピア変更の非巻き戻しと収束まで、独自コマンドスタックを書かずに成立する。
- **先に決めるべき設計制約は 2 つ。**
  1. **同一性**: アプリ側 ID を metadata に置き、TreeID を保存しない。undo 後のハンドルを
     キャッシュしない (F6)。
  2. **削除 undo の意味論**: 「削除前のローカル内容に戻す」= 並行編集は失われる、と UI・仕様で
     明示する (F7)。revision 履歴 (既存の DB 側) との役割分担もここで決まる。
- **採用判断は未了。** 本 PoC は「undo が成立する」ことの証明であり、Loro をドキュメントの
  正本にするかどうか (SQLite/RPC の正本とどう折り合うか) は別の意思決定。ADR を書くなら
  その論点を主軸にすべきで、undo は従属的な論点である。
- **導入コストとして確定したもの**: Vite では dev 用に 2 設定が必要 (F14)。また production の
  `browser` entry は同期 XHR で wasm を読むため、Worker での利用とデスクトップ (CEF/Tauri) の
  カスタムプロトコル配信は別途確認が要る。

## 7. 統合時の確認事項

### 7.1 Vite でのバンドル (実測済み。ただし設定が 2 つ必要)

`loro-crdt` は exports 条件で entry を切り替えるため、**dev と build で別のコードパスに入る**。
実測した結果 (vite 7.3.7 / chromium headless):

| 経路 | entry | 素の状態 | 必要な設定 |
| --- | --- | --- | --- |
| `vite build` (production) | `browser` (`browser.default`) | **そのまま動く** | なし |
| `vite` (dev server) | `bundler` (`browser.development`) | **HTTP 500 で失敗** | 下記 2 設定 |

- dev の失敗 (実測): `"ESM integration proposal for Wasm" is not supported currently.
  Use vite-plugin-wasm or other community plugins` — `bundler/index.js` が裸の
  `import "./loro_wasm_bg.wasm"` を行うため。
- `resolve.conditions` から `development` を外すと dev も `browser` entry を使うようになり、
  dev と production で **wasm の読み込み経路が一致する** (検証済み)。
- ただしそれだけでは `WebAssembly.Module(): expected magic word 00 61 73 6d, found 3c 21 64 6f`
  で落ちる (実測)。dev の依存事前バンドル (`node_modules/.vite/deps/`) に取り込まれると
  `new URL("./loro_wasm_bg.wasm", import.meta.url)` がバンドル隣を指し、SPA フォールバックの
  HTML を同期 XHR が受け取るため。`optimizeDeps.exclude: ["loro-crdt"]` で解消する (検証済み)。
- 検証済みの設定は [`vite.config.ts`](./vite.config.ts)。この組み合わせで dev / preview の両方に
  おいてブラウザ検証 11 項目が全て通る。
- **注意点**: `resolve.conditions` は client グラフ全体に効くため、`development` 条件に依存する
  他依存 (React 系など) は production ビルドを受け取るようになる。Svelte 中心の現構成では影響は
  見込まれないが、採用時は `vite-plugin-wasm` を使って条件を既定のままにし、
  dev は非同期ロード (`bundler` entry)、production は同期 XHR (`browser` entry) という
  **dev/prod 差を許容する**選択肢も比較したい (この代替案は本 PoC では未検証)。
- **ビルド出力 (実測)**: `dist/assets/loro_wasm_bg-*.wasm` 3,398.78 kB (gzip 1,130.46 kB)、
  `dist/assets/index-*.js` 95.68 kB (gzip 15.96 kB)、build 時間 1.2〜1.5 秒。
  wasm は別アセットとして出力されるため、配信側で `application/wasm` を返す必要がある
  (同期 XHR は `WebAssembly.Module(bytes)` に渡すので MIME 依存は弱いが、
  デスクトップのカスタムプロトコルでは要確認)。
- **ブラウザ検証 (実測)**: `browser_check.mjs` が preview / dev の両方で 11 項目パス。
  内容は「初期描画 (wasm ロード成功)」「ローカル挿入 → undo → redo」「undo ラベルが UI に出る」
  「他ピアの変更を取り込んだ後の undo がローカル操作だけを戻す」「コンソール/ページエラーなし」。

### 7.2 その他の確認事項

1. **永続化**: スナップショット (`Uint8Array`) を既存の SQLite / RPC 境界のどこに置くか。
   revision・occurrence・branch の既存モデルとの整合、マイグレーション手順、圧縮方針。
2. **同期の運用**: peer id の発行と寿命 (ウィンドウ/セッションごと)、UndoManager の寿命と
   peer 固定制約 (peer は UndoManager の生存中に変更できない)、切断中の更新のバッファリング。
3. **選択・caret の復元**: `onPush` の `cursors` を使う余地。PoC では未実装。
4. **タイトル以外の状態**: tag・relation・kind・branch を CRDT に載せるか、従来どおり DB 側に
   置くか。本 PoC はアウトライン (ツリー + タイトル) のみ。
5. **性能**: `items()` は毎回 `toJSON()`。実装では diff 購読へ置き換える。大規模アウトラインでの
   undo ステップのメモリ量、tombstone の蓄積 (F6 の再作成が繰り返されると削除済みノードが増える)。
6. **所有契約**: 採用するなら [UI所有契約](../../docs/design/ui-state-ownership.md) に従い、
   「Loro doc を正本とする state はどれか」「どの Controller が undo を所有するか」を先に決め、
   新 feature として分離するかどうかを判定する。スパイクはアプリコードに一切触れていない。
7. **CI への組み込み**: `spikes/**` は biome / deno fmt / deno test / knip の対象外なので、
   この PoC は既存の検証ゲートに影響しない。採用時はテストを `vitest/**` か `src/**/*_test.ts`
   へ移し、依存をルートの `package.json` に移す必要がある。

## 8. 検証ログ (実行した結果)

```
$ node loro_undo_test.ts
ℹ tests 17 / pass 17 / fail 0

$ node ../../../node_modules/typescript/bin/tsc --noEmit --strict --target es2022 \
    --lib es2022,dom,dom.iterable --module nodenext --moduleResolution nodenext \
    --allowImportingTsExtensions --skipLibCheck \
    loro_outline_store.ts loro_undo_test.ts loro_undo_demo.ts main.ts
(exit 0)

$ deno run -A --node-modules-dir=auto loro_undo_demo.ts    # Deno 2.9.7
(Node と同じ出力)

$ npm run build:web                                        # vite 7.3.7
dist/assets/loro_wasm_bg-*.wasm  3,398.78 kB │ gzip: 1,130.46 kB
dist/assets/index-*.js              95.68 kB │ gzip:    15.96 kB
✓ built in 1.22s

$ npm run check:browser -- http://127.0.0.1:5200/          # vite preview (browser entry)
PASS x11 → all browser checks passed

$ npm run check:browser -- http://127.0.0.1:5199/          # vite dev (要 vite.config.ts)
PASS x11 → all browser checks passed
```

補足: 検証時のサンドボックスでは `node --test <file>` (子プロセスの pipe 生成) と Vite/esbuild
(Windows の `net use` プローブ) が EPERM で拒否されたため、テストは `node <file>` の直接実行、
Vite は権限を広げた 1 回限りの実行で確認した。通常環境ではいずれも制約なく動く。
