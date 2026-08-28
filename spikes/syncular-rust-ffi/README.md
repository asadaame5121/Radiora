# Spike: Syncular Rust Core / C-ABI via Deno FFI

## 1. 目的

本 Spike は、オフラインファースト SQL 同期フレームワーク **Syncular (v2)** の現行 Rust Core / C-ABI
(`syncular-ffi`) を、製品コード非侵入の独立 Spike (`spikes/syncular-rust-ffi/**`) として検証する
Throwaway PoC です。

Windows x64 環境において、`Deno.dlopen` 経由で生成 DLL
をロードし、以下の全ライフサイクル実経路が正常動作することを実証します：

1. `new` (`syncular_client_new`)
2. `create` (ファイル SQLite データベース作成 & スキーマ初期化)
3. `mutate` (1件の楽観的 Upsert & `clientCommitId` 発行)
4. `query` / `readRows` (SQL クエリ & Syncular レコード読み取り)
5. `pendingCommitIds` (Outbox 未同期コミットの追跡)
6. `poll` / `free` (イベントバッチ `change` & `sync-intent` の取得と C 文字列メモリ解放)
7. `close` (クライアントハンドルの破棄 & DB ロック解放)

---

## 2. Upstream 情報・ライセンス・リスク評価

- **Upstream Repository**: [github.com/syncular/syncular](https://github.com/syncular/syncular)
- **採用 Crates & Version（厳密固定）**:
  - `syncular-ffi = "=0.15.48"` (C-ABI バインディング & JSON コマンドサーフェス)
  - `serde_json = "=1.0.151"`
  - `tempfile = "=3.10.1"` (dev-dependency)
  - (内部推移的依存: `syncular-client = 0.15.48`, `syncular-command = 0.15.48`,
    `syncular-ssp2 = 0.15.48`, `rusqlite = 0.32 bundled`)
- **Apache-2.0 根拠直リンク**:
  - Upstream LICENSE ファイル:
    [https://github.com/syncular/syncular/blob/main/LICENSE](https://github.com/syncular/syncular/blob/main/LICENSE)
  - Crates.io パッケージメタデータ:
    [https://crates.io/crates/syncular-ffi/0.15.48](https://crates.io/crates/syncular-ffi/0.15.48)
- **リスク評価（法的断定を避けた客観的評価）**:
  - **Pre-1.0 リスク**: 現在バージョン `0.15.x` のプレリリース段階であり、1.0
    正式リリース前にコマンド仕様、スキーマ型マッピング、ワイヤプロトコル（SSP2）に破壊的変更（Breaking
    Changes）が入るリスクが存在する。
  - **単独メンテナリスク**:
    コントリビュータ層が単独/少人数メンテナに集中しており、将来的な商用サポート保証、LTS
    保証、迅速なセキュリティ/脆弱性修正の持続性に外部依存リスクがある。

---

## 3. C-ABI 仕様 & メモリ・Panic 安全性

`syncular-ffi` が公開する 5 つの C 関数：

```c
void*  syncular_client_new(const char* config_json);
char*  syncular_client_command(void* handle, const char* command_json);
char*  syncular_client_poll_event(void* handle, int64_t timeout_ms);
void   syncular_client_close(void* handle);
void   syncular_free_string(char* ptr);
```

- **メモリ管理**:
  - Rust 側で `CString::into_raw` で確保されたポインタを Deno 側が受け取り、UTF-8 取得後に必ず
    `syncular_free_string` を呼び出して Rust 側ヒープへ返却・解放。
  - `syncular_client_close` により `Handle` (`Box::from_raw`) を破棄し、SQLite
    ファイルのファイルロックと内部スレッド/キューを完全解放。
- **Panic 越境防止**:
  - `syncular-ffi` / `syncular-command` 内部および C-ABI
    エントリーポイントにおいて、入力検証エラー・SQL エラー等はすべて
    `{"error": {"code": "...", "message": "..."}}` 形式の JSON にマーシャリングされ、FFI
    境界を越える panic は遮断される。

---

## 4. ビルド & 実行手順

### 前提条件

- Rust toolchain (`cargo`, `rustc`)
- Deno runtime (`deno >= 2.0`)

### 手順

```bash
# 1. 作業ディレクトリに移動
cd spikes/syncular-rust-ffi

# 2. Rust 単体テストの実行（SQLite ライフサイクルの検証、バージョンロック）
cargo test --locked

# 3. Windows x64 release cdylib のビルド（バージョンロック）
cargo build --release --locked

# 4. Deno FFI ハーネス / テストの実行
deno test -A --unstable-ffi deno_ffi_harness.ts
```

---

## 5. バイナリ特性 & 外部 DLL 依存

- **生成 DLL**: `spikes/syncular-rust-ffi/target/release/syncular_rust_ffi_spike.dll`
- **DLL サイズ**: **3,714,560 bytes (~3.54 MB)**
- **外部 DLL 依存 (PE Import Table 検証結果)**:
  - `kernel32.dll`, `ntdll.dll`, `bcryptprimitives.dll`, `dbghelp.dll` (Windows 標準 OS ライブラリ)
  - `vcruntime140.dll`, Universal CRT (`api-ms-win-crt-*`) (標準 MSVC C ランタイム)
  - **サードパーティ外部 DLL 依存なし**（SQLite 3 は `rusqlite bundled`
    により静的リンクされており、外部の `sqlite3.dll` は不要）。

---

## 6. 検証結果サマリ

1. **Rust Unit Test (`cargo test --locked`)**:
   - `test spike_tests::test_syncular_local_sqlite_lifecycle ... ok` (**1 passed; 0 failed**, 0.09s)
2. **Deno FFI Harness (`deno test -A --unstable-ffi deno_ffi_harness.ts`)**:
   - **PASS (79ms)**
   - 全実経路（`new` -> `create (file SQLite / schema)` -> `subscribe` -> `mutate` -> `readRows` ->
     `query` -> `pendingCommitIds` -> `poll_event / free` -> `close`）を完走。
   - 実ファイル `radiora_syncular.db`（約 76 KB）が生成され、データが永続化されていることを確認。
   - 信頼境界（JSON/FFI）における TypeScript runtime type guard による厳格な型検証をパス。

---

## 7. 実証できた機能 vs 未実証（ブロッカー・スコープ外）

### 実証できた機能

- [x] **Deno.dlopen による DLL symbol export と C-ABI バインディング**
- [x] **実ファイル SQLite データベースの作成とスキーマ初期化 (`create`)**
- [x] **楽観的ローカル更新 (`mutate`) と `clientCommitId` の発行**
- [x] **Syncular 抽象層経由のデータ読み込み (`readRows` および SQL `query`)**
- [x] **Outbox / Pending Commit の追跡 (`pendingCommitIds` に 1 件保持)**
- [x] **イベントキューからの変更通知 (`change`) と同期意図 (`sync-intent`) の取得・メモリ解放**
- [x] **不正クエリに対するエラー安全性（panic 越境なし）**
- [x] **クライアント終了時のリソース・DB ロック完全解放 (`close`)**

### 未実証 / ブロッカー・スコープ外

- [ ] **同期サーバー通信 (SSP2 Wire Protocol / HTTP / WebSocket)**
  - 今回は client-local モードで実証。同期サーバー接続には `native-transport` 機能またはホスト側の
    WebSocket 転送レイヤーの実装が必要。
- [ ] **認証ハンドシェイク (`activateSecurity` / Token rotation)**
- [ ] **複数端末間でのコンフリクト自動解決**
- [ ] **E2EE 暗号化 / Yjs CRDT 連携**

---

## 8. 統合アーキテクチャの最小接点候補と統合作業量評価

将来的に Radiora へ Syncular を導入する場合、ストレージ層の最小接点候補として以下が考えられます：

```
[ Radiora Domain / Services ]
           │
           ▼
[ Storage Port / GraphStore Interface ] (src/storage/graph_store.ts)
           │
           ▼
[ SyncularGraphStore Adapter (候補) ] (Svelte/Deno 側)
           │  (JSON Commands / Deno FFI)
           ▼
[ syncular-ffi (cdylib) ]
           │
           ▼
[ Local SQLite (radiora.db) ]
```

### 統合作業量の評価（未評価・留意点）

- **GraphStore メソッド網羅性**: Radiora の現行 `GraphStore` / `GraphMutations` は多数の domain 固有
  method（数十件）を持っており、単純な汎用 CRUD ではなく、これら多数の domain 固有 method を mapping
  する設計と実装が必要です。
- **ネイティブバイナリ配布・パッケージング**: OS ごと（Windows x64, Linux x64 等）の `cdylib`
  コンパイルと Deno Desktop / CEF アプリへの同梱・ロードパス解決の仕組みが必要となります。
- **結論**: 本 Spike では「Deno FFI から Syncular C-ABI を介してローカル SQLite
  を制御できること」を実証しましたが、**Radiora 本体系への統合作業量・移行コストは未評価**です。
