# Alloy検査記録

指定JAR: `D:\Downloads\alloy-6.2.0-windows-amd64\app\org.alloytools.alloy.dist.jar`
Alloy: 6.2.0 / Java: 21.0.2 / solver: SAT4J / symmetry: 20。
モデルの入力はユーザー提示のIssue #381向けv3設計決定。

## 最終実行

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/document-model-alloy/run.ps1 -OutputDirectory (Join-Path $env:DELTA_SCRATCH_DIR 'alloy-confirmed-run') -TimeoutSeconds 120
```

終了code **0**、30 commandのreceipt照合がすべて成功。12 witnessと3 negative controlがSAT、
15正条件の反例探索がUNSATだった。scratchのraw出力はturn終了で消えるため、
再現時はREADMEの既定出力先`.results/`を使う。

| モデル | SHA-256 |
| --- | --- |
| `document_model.als` | `1B081C1A09EF2E69E6D4E5293B0995700DF44689442BD547742B5F60635F0231` |
| `legacy_sharing.als` | `22E9ACC0640F7B432352C89049BB163A678D7E0BBC1F83C5B86A5AADED87EC20` |

## commandと結果

SATは`run`では充足例、`check`では反例を意味する。

| モデル/index | command | 結果 |
| --- | --- | --- |
| document/0–8 | rootEnter、normalMove、crossDocumentMove、cutOut、duplicateLeaf、removeSubtree、restoreSubtree、purgeSubtree、hoist | 各SAT（最大4 Block、2 State） |
| document/9 | OperationsPreserveStructure | UNSAT（最大5 Block、2 State） |
| document/10 | EveryRetainedBlockHasOneDocument | UNSAT（最大5 Block、1 State） |
| document/11 | NormalMoveCannotChangeDocument | UNSAT（最大5 Block、2 State） |
| document/12 | RootCannotBeDemotedByMove | UNSAT（最大5 Block、2 State） |
| document/13 | CutOutPreservesDescendantIdentity | UNSAT（最大5 Block、2 State） |
| document/14 | HoistDoesNotChangeMembership | UNSAT（最大5 Block、2 State） |
| document/15 | IssuedIDsNeverBecomeAvailable | UNSAT（最大5 Block、2 State） |
| document/16 | PurgeRetainsReferencesWithoutRewiring | UNSAT（最大4 Block、2 State） |
| document/17 | RootEnterCreatesFirstChildNotNewDocument | UNSAT（最大4 Block、2 State） |
| document/18 | SavedPositionUndoRestoresStructure | UNSAT（最大4 Block、3 State） |
| document/19 | NaiveUndoToFirstSiblingRestoresOrder（negative control） | SAT（最大4 Block、3 State） |
| document/20 | NaiveGenericMoveKeepsDocumentBoundary（negative control） | SAT（最大4 Block、2 State） |
| document/21 | owner本文変更＋独自の子を持つ参照項目のwitness | SAT（最大4 Block、2 State） |
| document/22 | BodyEditPreservesStructure | UNSAT（最大4 Block、2 State） |
| document/23 | SharedViewsReflectOwnerEdit | UNSAT（最大4 Block、2 State） |
| legacy/0 | losslessImport | SAT（各signature最大4） |
| legacy/1 | 同じ本文を共有し異なる親を持つPlacementのwitness | SAT（同上） |
| legacy/2 | PreserveSharedBody | UNSAT（同上） |
| legacy/3 | PreserveEachPlacementsChildren | UNSAT（同上） |
| legacy/4 | DisplayOriginalContent | UNSAT（同上） |
| legacy/5 | WorkAloneDeterminesCurrentBody（negative control） | SAT（同上） |

## 反例から引き継ぐ注意点

以下は**決定済み仕様そのものの矛盾ではなく、弱い実装解釈/追加仮説に対する反例**。
solverが返した状態を、関係する親子・順序・本文だけに投影して説明する。

### 1. 親だけ戻すUndoは不十分

```text
前:       R → [A, B]
移動後:   R → [A → B]
誤ったUndo（元の親の先頭へ戻す）:
          R → [B, A]
```

親は同じでも兄弟順が変わる。保存した元の親＋元の前兄弟を使う逆移動では、
このモデルのscope内で構造復元の反例はなかった。
LoroのUndoManagerや、介在操作がある場合の正しさは別の実行試験が必要。

### 2. 通常操作へgeneric moveをそのまま公開しない

```text
前:   R → B
後:   R    B（別のroot）
```

`parent = none`を許すgeneric moveはBを文書rootへ変える。
通常インデント/アウトデントと、明示的な切り出しを別の操作権限として扱う必要がある。

### 3. Work IDだけを本文共有のkeyにしない

```text
Work X / Content 1 → Text A
Work X / Content 2 → Text B
```

同じWorkでも異なるBranch/Revisionの本文は異なり得る。
Work単位の代表1個へ無条件に寄せる仮説は成り立たない。
LegacyContentを区別した候補モデルでは、共有本文と配置ごとの子構造の保全に反例はなかった。
具体的なグループ化・代表選択・archiveは未決であり、この検査で決定していない。

## 結論と限界

ここで定義した前提・操作・scope内では、検査した正条件に反例はなかった。
実装前に必要なposition履歴・境界操作の分離・旧本文同一性の区別もnegative controlで確認できた。
一方、UUIDv7、Markdown書換え、実LoroのUndo/Redo、並行性、全旧データ移行、安全なDB保存は未検証。
モデルへ置いた削除/復元/参照の解釈は[README](README.md)に明記しており、ユーザーの追加決定とは扱わない。

初期の5 Blockでの一括探索は実行全体の240秒timeoutに到達したため、その未完了分を合格に含めていない。
最終モデルではdocument/16–18を4 Blockへ限定し、独立したcommand timeout付きで全30件を再実行・完了した。
