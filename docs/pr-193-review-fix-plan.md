# PR #193 レビュー指摘の修正手順

対象PR: https://github.com/asadaame5121/Radiora/pull/193

レビュー対象コミット: `6546bb804b4526a3cac8e9437251a948e6fe9710`。
以下の行番号はこのコミットを基準とする。実装時は最新差分と関数名で位置を再確認する。
この文書は修正計画であり、修正完了の報告ではない。

## 0. 作業開始

1. PRの最新headと作業ツリーの変更を確認する。既存の未コミット変更を上書きしない。
2. `codex/chronology-draft` の最新headを使う作業環境で実施する。
   レビュー用に展開した `output/review-pr193` は実装対象にしない。
3. 下記の順に、再現テスト追加 → 修正前の失敗確認 → 実装修正 → 対象テスト成功確認を行う。
4. 最後に全体検証とPRのCIを確認する。

## 1. SurrealDBの移行SQLの構文エラー［P1］

### 原因と修正方針

`FLEXIBLE` が `TYPE` より前にあり、CIのSurrealDB 3.2.3が構文エラーを返す。
schema移行が停止するため、SurrealDB storeの初期化・旧データ移行が完了しない。
失敗ログは `FLEXIBLE must be specified after TYPE`。

既存migrationのSQLを修正する。新しいmigration番号やschema versionは追加しない。
今回の変更は、まだマージされていないmigrationを実行可能にするための修正である。

### 修正箇所

| ファイル | 対象 | 変更内容 |
| --- | --- | --- |
| `src/storage/migrations/0007_historical_time.ts` | `up()`、9行目 | `TYPE option<object> FLEXIBLE` の順に変更 |
| `tests/historical_time_storage_test.ts` | `Surreal historical metadata ...` テスト | 誤ったSQLを正解としている文字列assertを修正 |
| `scripts/surreal_integration.ts` | store初期化後と再接続の検証部分 | 既存の実DBテストに年代の保存・再読込・削除の確認を追加 |

### 手順

1. 修正前の `deno task test:integration` が当該構文で失敗することを確認する。
   既存CIログも再現根拠として使える。
2. SQLを次の形にする。

   ```sql
   DEFINE FIELD IF NOT EXISTS historical_time ON work TYPE option<object> FLEXIBLE;
   ```

3. 単体テストの `includes("FLEXIBLE TYPE option<object>")` を正しい順序に追従させる。
   このassertだけではSQLの実行可否は証明できないため、実DBテストも必須とする。
4. 既存の実DB統合テスト内で、移行したWorkの年代が未設定であることを確認する。
   年代を設定し、storeを閉じて再接続後もネストした値が保持されること、
   `null` による削除後は未設定になることを確認する。
5. 次を実行する。

   ```powershell
   deno test -A tests/historical_time_storage_test.ts
   deno task test:integration
   ```

### 完了条件

- 実DBで旧形式から現行schemaへの移行と再初期化が成功する。
- 年代のネストした値が保持され、削除も反映される。
- PRの `SurrealDB legacy migration integration` が成功する。

## 2. 年表の対応範囲外での例外［P2］

### 原因と修正方針

年表の表示domainには余白とパン・ズームが含まれるが、日座標から日付への変換は
対応年の範囲外を拒否する。日単位の目盛りでは下限チェックが抜け、年・月単位でも
表示domainの下端が対応年の上限を越えると初期cursorの計算で例外になる。

`historicalTimelineTicks()` を修正責務の境界とする。
表示domainと対応範囲の共通部分だけで目盛りを生成し、共通部分がなければ `[]` を返す。
domain側の例外をcatchして握り潰したり、暦計算側の範囲制限を緩めたりしない。
カメラや年表の余白計算は変更不要。

### 修正箇所

| ファイル | 対象 | 変更内容 |
| --- | --- | --- |
| `src/ui/historical_timeline_axis.ts` | `historicalTimelineTicks()`、53〜64行目 | 有効な生成区間の計算、空区間の早期return、候補値の範囲判定 |
| 同上 | `calculateInitialCursor()`、28〜35行目 | 範囲内に制限した開始座標を受け取る。不要になった片側だけのclampは整理 |
| `tests/historical_timeline_test.ts` | 目盛り生成テスト | 下限・上限・範囲外・通常表示の回帰例を追加 |

### 手順

1. 次の2例を追加し、修正前に `RangeError` が発生することを確認する。

   ```ts
   const firstDay = historicalDay(-MAX_HISTORICAL_YEAR);
   const endExclusive = historicalDay(MAX_HISTORICAL_YEAR + 1);

   historicalTimelineTicks([firstDay - 1, firstDay + 1], 8);
   historicalTimelineTicks([endExclusive, historicalDay(MAX_HISTORICAL_YEAR + 2)], 8);
   ```

2. 有効範囲を `[firstDay, endExclusive)` と定義する。
   整数の日座標での最後の日は `endExclusive - 1`。
3. 生成開始を `max(domain[0], firstDay)`、生成終了を
   `min(domain[1], endExclusive - 1)` にする。開始が終了より大きければ `[]` を返す。
   最終日1日だけの区間は有効なので、同値では早期returnしない。
4. `calculateInitialCursor()` には制限後の開始を渡す。
   日付変換に渡す候補は必ず有効範囲内に限定する。
5. 目盛りの単位・間隔は元の表示domainの幅から計算する。
   境界に触れた瞬間に年目盛りが日目盛りへ切り替わるような挙動を避ける。
6. 次をテストする。

   | ケース | 期待結果 |
   | --- | --- |
   | 下限の前日〜下限の翌日 | 例外なし。下限以降の目盛りだけを返す |
   | 上限の前日付近〜範囲外 | 例外なし。最終日より後の目盛りを返さない |
   | 全体が下限より前／上限以降 | `[]` |
   | 最終日のみ | 最終日の目盛りを生成できる |
   | 年・月単位で境界をまたぐ区間 | 例外なし。返す値はすべて範囲内 |
   | 通常の年・月・日とBCE/CE境界 | 既存テストの期待を維持 |

7. `deno test tests/historical_timeline_test.ts` を実行する。
8. UIで天文学年 `-999999`（入力表記は紀元前1000000年）の1月1日と、
   西暦999999年12月31日を日精度で表示する。境界外へパンしてから戻し、
   例外なく年表表示・選択が続けられることを確認する。

### 完了条件

- 境界付近の有効な年代を初期表示しても例外が発生しない。
- 対応範囲外へパンしても目盛り生成が停止せず、範囲内へ戻れる。
- 範囲外の座標を日付変換へ渡さず、通常の目盛り間隔は維持される。

## 3. 時点→期間の切替で開始年が不明になる［P2］

### 原因と修正方針

新規draftの `start.unknown` は `true`。時点フォームではこのフラグを使わずに年月日を
編集できるが、種類のselectは `draft.kind` だけを更新する。
その結果、期間へ切り替えると入力済みの開始が `null` として保存される。

種類の切替を `HistoricalTimeController` の明示的な操作にする。
「時点→期間」では時点を既知の開始として引き継ぎ、`start.unknown = false` にする。
年月日・精度・頃・原表記・終了側のdraftは維持する。
期間側で利用者が明示的に「不明」を選ぶ操作は引き続き尊重する。

### 修正箇所

| ファイル | 対象 | 変更内容 |
| --- | --- | --- |
| `src/ui/historical_time_controller.svelte.ts` | `reset()` / `select()` と並ぶ状態操作 | `setKind(kind)` を追加して切替時のフラグ更新を所有 |
| `src/ui/HistoricalTimeEditor.svelte` | 種類select、11行目 | `draft.kind` への直接書込みをController呼出しへ変更 |
| `vitest/historical_time_controller.svelte.test.ts` | Controllerテスト | 入力→切替→保存の回帰ケースと不明端点保持の確認を追加 |

`historical_time_form.ts` のnullable変換や `HistoricalDateFields.svelte` の不明checkboxは
変更しない。保存時に「文字があれば不明を解除する」といった推測は入れない。
その方法では、利用者が明示的に選んだ不明端点を壊してしまう。

### 手順

1. 新規Workを選択し、時点の年に `1604` を入力する回帰ケースを追加する。
   期間へ切り替え、終了を既知の `1867` にして保存する。
   保存portへ渡る開始が `null` ではなく1604年であることを検証する。
2. Controllerへ次の動作を追加する。

   ```ts
   setKind(kind: "point" | "period"): void {
     if (this.draft.kind === kind) return;
     if (this.draft.kind === "point" && kind === "period") {
       this.draft.start.unknown = false;
     }
     this.draft.kind = kind;
   }
   ```

3. Viewは選択された種類をControllerへ渡すだけにする。
   直接の `bind:value={controller.draft.kind}` を残してから `onchange` を足す方式は避ける。
   先にkindが書き換わるとControllerが遷移前の種類を判定できない。
   Svelteの関数binding、または `value` と `onchange` を使い、値は
   `"point" | "period"` の確認後に渡す。
4. 以下の状態遷移を確認する。

   | 操作 | 期待結果 |
   | --- | --- |
   | 新規の1604年の時点→期間 | 開始1604年が表示・保存される |
   | 未入力の時点→期間 | 開始は既知の空欄。入力するか明示的に不明を選ぶまで保存時validationで拒否 |
   | 期間で開始不明を明示→保存 | 開始は `null`。古い入力文字列が残っていても不明を優先 |
   | 種類を同じ値に設定 | no-op。不明フラグを変更しない |
   | 既存の両端不明の期間を読込→保存 | 両端不明を維持。読込時には種類切替操作を呼ばない |
   | BCE・世紀・頃・原表記を含む時点→期間 | 開始の全フィールドを保持 |
   | 切替後に取消 | 保存済みの種類・値へ戻る |

5. 次を実行する。

   ```powershell
   npm run test:svelte -- vitest/historical_time_controller.svelte.test.ts
   npm run check
   ```

6. 実UIで新規Workの「1604年の時点→期間→終了1867年→保存」を操作し、
   開始欄が消えないことと、Inspector再選択・年表で1604〜1867年として反映されることを確認する。

### 完了条件

- 種類切替で入力済みの時点が失われない。
- 開始不明・終了不明・両端不明の明示入力を維持できる。
- 状態遷移はControllerが所有し、Viewに日付の解釈や保存処理を追加しない。

## 4. 最終検証と報告

対象テストに合格した後、PRの実装環境で次を実行する。

```powershell
deno task verify
deno task test:integration
```

`test:integration` は `verify` に含まれないため別途実行する。
実DBテストには `surreal` CLIが必要。ローカルに用意できない場合はPRの統合CI結果を確認し、
未実行のまま合格とは記載しない。

完了報告には、修正した3点、対象コミット、テスト結果、UIで確認した操作、残る制限を記載する。
この手順書ではコミット・push・マージの実施は扱わない。

### レビュー時点の検証記録

- Denoの歴史年代・保存・年表テスト: 12件成功。
- HistoricalTimeControllerテスト: 4件成功。
- 指摘1: PRの実SurrealDB統合CIで構文エラーを確認。
- 指摘2: 下限前日を含む日目盛りと、上限以降の表示区間で `RangeError` を再現。
- 指摘3: 新規draftへ1604年を入力後に期間へ切り替え、開始が `null` になることを再現。

既存テストの成功だけでは3件の修正完了を判断しない。追加した回帰ケースと実DB・UIの確認を使う。
