# v3 IPC：保存済みread modelのcommandとDTO（#403 feat A）

状態: #385で唯一残っていた「command名・DTO field」を#403の2本目のPRで決めた記録。
読取り経路だけを定め、編集・保存のcommand（feat B）はこの命名規則に沿って後で追加する。
前提は[v3決定事項](v3-model-decisions.md) §1「競合判定の単位・本文版の採用契約」と
§5「最初のsliceの実装前判断」、 Loro文書の形は[Legacy Importer対応設計](v3-legacy-import-mapping.md)
§3（schema v1案）。

## command

| command名              | 引数                    | 成功時              | 失敗時     |
| ---------------------- | ----------------------- | ------------------- | ---------- |
| `read_saved_workspace` | `request`: `{}`（必須） | `SavedWorkspaceDto` | `ErrorDto` |

- 命名は `動詞_対象` の snake_case。Tauriの許可名は `allow-read-saved-workspace`。
  capability（`crates/radiora-desktop/capabilities/main.json`）は main window
  にこのcommandだけを許可する。
- 名前の正本は `crates/radiora-desktop/src/command_names.rs`。build scriptのapp manifest、invoke
  handler、 capabilityの一致をRustのテストで固定する。
- `request` は未知fieldを拒否する空object。引数の欠落・object以外・未知fieldはどれも
  `invalid_request` で返し、 Tauriの文字列errorにしない。入力値はerror messageへ反映しない。
- 返すのは保存済み（耐久化済み）のread modelだけ。保存中は待たずに `busy`、未耐久の変更が残る間は
  `persist_pending` を返す。無期限に待つqueueは作らない。

## SavedWorkspaceDto（成功時）

JSONのfield名は camelCase。

```json
{
	"generation": 7,
	"topics": [
		{
			"blocks": [
				{
					"id": "<UUIDv7>",
					"parentId": null,
					"depth": 0,
					"kind": "block",
					"body": "…",
					"bodyVersion": "<token>"
				},
				{
					"id": "<UUIDv7>",
					"parentId": "<UUIDv7>",
					"depth": 1,
					"kind": "reference",
					"heading": null,
					"target": { "id": "<UUIDv7>", "state": "live", "body": "…", "bodyVersion": "<token>" }
				}
			]
		}
	]
}
```

| field                         | 意味                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `generation`                  | read model公開の世代。単調に増え、古い応答が新しい状態を上書きしないための順序。書込みの前提条件にしない       |
| `topics[]`                    | ゴミ箱外のTopicを文書順に並べる                                                                                |
| `topics[].blocks[]`           | 先頭がroot Block。続いてゴミ箱外の子孫をアウトライン順（前順、兄弟は文書順）に並べる                           |
| `id` / `parentId` / `depth`   | 論理ID（UUIDv7）、親の論理ID（rootだけ`null`）、rootからの深さ（root=0）                                       |
| `kind`                        | `"block"`（本文を所有）または `"reference"`（参照項目）                                                        |
| `body` / `bodyVersion`        | `kind="block"`のみ。保存済み本文と、そのBlockの本文版token                                                     |
| `heading`                     | `kind="reference"`のみ。参照項目の固有見出し。無ければ`null`                                                   |
| `target.id`                   | 参照先（代表Block）の論理ID。ゴミ箱内・Missingでも返す                                                         |
| `target.state`                | `"live"`（代表の本文を読取り専用で表示）、`"trashed"`（ゴミ箱内・復元可能）、`"missing"`（完全削除・解決不能） |
| `target.body` / `bodyVersion` | `state="live"`のみ。代表Blockの本文と本文版。参照項目からの編集は代表の本文版で判定する                        |

- ゴミ箱内のBlock（trash markを持つnodeとその子孫）はどのTopicのアウトラインにも出さない。
  ゴミ箱一覧はこのcommandの対象外。
- Svelte
  Flowのnode、画面座標、ELKの結果、Relationの投影は含めない。縦TreeのV2/V3はこの形をTopic単位で再利用する。
- Loro型・TreeID・Petgraph
  index・SQL・内部pathは出さない。payloadのkey集合と内部表現の不在をRustのテストで固定する。

### 本文版token（`bodyVersion`）

- opaqueな文字列。比較は等値だけに使い、UIは中身を解釈しない。
- 実装（`radiora-infra` `workspace/body_version.rs`）: そのBlockのLoroTextに触れたopの集合
  （peerごとの最大op counter）から作るSHA-256 digestの先頭128bit。
  そのBlockの本文を変える操作（編集・Undo/Redo・復元・取込み）で必ず変わり、過去の値へ戻らず、
  他のBlockの操作では変わらない。同じ履歴からは再起動後も同じ値になる。
- workspace全体の版は `generation` としてだけ載せる（#381の競合判定単位）。

### 上限

- 本文・固有見出しは1件あたり UTF-8 で `1048576` bytes（1 MiB）まで。超えるBlockを含む読取りは
  `body_too_large` で失敗し、`blockId` に対象の論理IDを返す。feat Bの本文書込みも同じ上限を使う。
- `generation` は `Number.MAX_SAFE_INTEGER`（2^53−1）以下。超えたら `storage` とする。

## ErrorDto（失敗時）

```json
{ "kind": "busy", "message": "保存中のため…", "blockId": null }
```

| `kind`                  | 意味・UIの扱い                                                        |
| ----------------------- | --------------------------------------------------------------------- |
| `invalid_request`       | 要求の形式誤り                                                        |
| `workspace_unavailable` | このprocessでworkspaceを開けない（保存先、別instance、非対応形式）    |
| `busy`                  | 書込み中。待たずに返したので、保存の完了後に読み直す                  |
| `persist_pending`       | 未耐久の変更が残る。保存済みread modelは公開しない。retry後に読み直す |
| `recovery_required`     | workspaceを開き直す必要がある                                         |
| `body_too_large`        | 本文・固有見出しが上限超過。`blockId`に対象                           |
| `storage`               | 読取り失敗。原因はlogにだけ残す                                       |

- UIは `kind` で分岐し、`message` は表示用（日本語）。SQL・path・Loroの内部表現を含めない。
- `blockId` は `body_too_large` のときだけ値を持ち、他は`null`。

## 検証

- Rust: `crates/radiora-desktop/src/dto.rs`（DTO契約: 形、未知field拒否、上限、error kind、version
  token）、
  `commands.rs`（合成fixtureのcommand経由読取り、内部表現の不在、書込み中の`busy`、未耐久変更の`persist_pending`）、
  `lib.rs`（invoke handler・capabilityとcommand名の一致）。
- 合成fixture: `radiora-infra` `workspace/fixture.rs`（`test-support` featureでだけ公開）。schema
  v1案に沿って
  複数root、入れ子、参照項目、ゴミ箱内の代表、Missingの参照先（未知IDと完全削除）、ゴミ箱内のTopic、
  日本語・emoji・結合文字・CRLFを含む。read modelの解決は `workspace/read_model_tests.rs`
  でも確かめる。
- TypeScript側のruntime validation・invoke adapter・Outline画面への接続は#403の3本目のPRで行う。
