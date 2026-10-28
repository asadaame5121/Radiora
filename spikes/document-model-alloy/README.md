# Radiora v3 文書モデルのAlloy検査

Issue #381についてユーザーが提示した「文書モデル・境界・ID・旧データ移行の設計決定」を入力にした、
**製品実装とは独立の有界モデル検査**。Loro自体の検証や、全仕様の証明ではない。
モデルと実行スクリプトは製品実装と分離した検証成果物としてこのディレクトリに閉じる。
追加の[完全削除/Undo barrierモデル](purge_protocol.als)は、
[実装契約](../../docs/design/purge-undo-contract.md)の参照として使用する。

## 結果

指定されたAlloy **6.2.0**のJAR、Java **21.0.2**、**SAT4J**で実行した。
**30 commandすべてが期待結果と一致**した。

- 12個の`run`で充足例あり（SAT）。操作/共有モデルが矛盾してすべて実行不能になっていないことを確認。
- 15個の正の`check`で反例なし（UNSAT、下記scope内のみ）。
- 意図的に誤った3個の`check`で反例あり（SAT）。反例検出能力の対照試験。
- 詳細は[検査記録](results.md)。具体的なLoro操作・DB・UUID生成器・IME・性能は未検証。

完全削除モデル追加後はOpenJDK 27.0.1.0.2で**全50 commandを再実行して期待結果と一致**した。
新モデルは6 witness、10正条件、4 negative controlの20件。
状態遷移・結果・モデルhashは[追加検査記録](purge-results.md)を参照する。

## 実行

PowerShellからrepository rootで実行する。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./spikes/document-model-alloy/run.ps1
```

既定JARはユーザー指定の以下のファイル。

```text
D:\Downloads\alloy-6.2.0-windows-amd64\app\org.alloytools.alloy.dist.jar
```

別の環境では`-Jar <path>`を指定する。ExecutionPolicyの指定はこの子プロセスだけに適用し、
ユーザー/マシンの永続設定を変更しない。既存の出力を消さず、
`.results/<unique-id>/`に各commandのreceipt・SAT instance・stdout/stderrと`summary.json`を保存する。
出力先は`-OutputDirectory`、各commandのtimeoutは`-TimeoutSeconds`（既定180秒）で変更できる。
timeout・実行エラー・期待結果不一致はスクリプトの失敗とする。
既定では3モデルすべてを実行する。完全削除だけなら`-Models purge_protocol`を指定する。

Analyzerは解析エラー等の際に必ずしも非0終了しないため、exit codeだけでなくreceiptと期待SAT値を照合する。
Windowsのnative wildcard展開を避けるため、`exec -c '*'`ではなくcommand番号ごとに実行する。
GUIでモデルを開く場合は以下。

```powershell
java -jar 'D:\Downloads\alloy-6.2.0-windows-amd64\app\org.alloytools.alloy.dist.jar' gui ./spikes/document-model-alloy/document_model.als
```

## モデル化した決定

| 決定 | 表現・検査 |
| --- | --- |
| 単一workspaceの一つのDoc、root＋子孫＝文書 | 一つのStateに一つのforest。親の単一性・非循環性から所属rootが一意になることを検査 |
| rootと通常Blockの同じID、rootがタイトル | 同じBlock集合・同じbody field。独立した文書タイトルentityを置かない |
| root Enterは最初の子を追加 | `rootEnter`。既存子の前へ挿入し、root集合が変わらないことを検査 |
| 通常の階層変更は文書境界を越えない | `normalMove`は同じ所属文書内のみ。rootの降格を許さない |
| 切り出し・文書間移動はID維持 | `cutOut` / `crossDocumentMove`。Block atomは同じままparent/orderだけを更新 |
| Undoで親・順序・同一性を戻す | 直前の親と前兄弟を保存して逆移動する限定モデル。3 Stateで復元を検査 |
| IDの非再利用・複製時の新ID | issued集合は単調増加。freshはissued外から取得し、purgedを再割当しない |
| 通常削除・復元・完全削除 | dead/purgedを区別。issued IDを残し、purge時bodyを除く |
| Link/Relationを保持し、自動接続しない | 削除/移動等で端点関係をframe。purge後の完全一致を検査 |
| Hoist/Zoomは所属を変えない | viewだけの変更としてモデル化し、文書所属が不変であることを検査 |
| 代表Blockの本文と参照項目の独立した子 | 本文所有とreferenceをparentから分離。owner本文更新の反映と子の保全を検査 |
| 旧共有を黙って解除しない | `legacy_sharing.als`でPlacementごとに別Blockを割当て、同じLegacyContentの本文だけを共有 |

`wellFormed`は**遷移前**の制約。各操作の遷移後を自動的にwellFormedとするfactは置かず、
`OperationsPreserveStructure`等で保存性を検査している。
一方、非循環・ID・参照の意味等をモデルの前提として定義すること自体は必要であり、
それが実装で守られるかをこの結果だけで保証するものではない。

## 仮定・未決事項を確定しないための境界

以下はモデルを実行するための**解釈/抽象化**。製品仕様としての追加決定ではない。

- Block atomを不変の論理UUIDとして扱う。UUIDv7のbit形式・時計・生成・衝突検出は検証していない。
  Loro TreeID/handleとは別であり、内部ノード再生成の正しさも未検証。
- Textは最大2種類の抽象値。文字列の内容、Enterによる文字分割、Shift+Enter、
  URL構文、`[[`補完、前方一致・同名候補・Markdown除外範囲は検証しない。
- 通常削除は「部分木全体をTombstone化し、親/順序/本文を保存」、復元は「親がliveなら部分木復元」、
  完全削除は「Tombstoneの部分木をpurge」と解釈した。
  削除範囲、親も削除済みの場合の復元は別途仕様化が必要。
  後続決定でpurgeはUndo不可・全session履歴リセットとなり、追加の`purge_protocol.als`で扱う。
- referenceは別の本文ownerを直接指し、reference chainを許さない。
  代表削除時の見え方や参照項目を複製した場合など、未決のUX全体は扱わない。
- orderは保存されている兄弟間の厳密全順序。切り出したrootは末尾へ置く解釈。
  Undoは**介在操作なしの構造変更1回**のみ。複数段stack、本文/削除Undo、並行編集、Loro UndoManagerは未検証。
- legacyのLegacyContentは「WorkだけでなくBranch/Revisionを区別した本文同一性」を表す。
  その抽出や代表の決定的選択規則は未決のまま。対応済みPlacementの移行だけを扱い、
  孤立Work・stub・全履歴archive・旧17種類全recordの保持を証明していない。
- 永続化、snapshot/差分、クラッシュ、履歴GC、backup、Importer配布/診断、性能はモデル外。
  単一Docの実機上の容量限界もAlloyでは分からない。

## scopeの意味

`document_model.als`は最大4〜5 Block、1〜3 State、最大2 Text。
`legacy_sharing.als`は各通常signature最大4 atom。
Stateは明示的な前後snapshotであり、Alloy 6の無限temporal traceを探索するモデルではない。
scopeを超えた反例の不存在・実装の正しさ・移行の無損失を一般に証明したとは言わない。

## 参考

- ユーザー指定の[Alloy language reference](https://alloytools.org/spec.html)
  （Functions and Predicates、Commands、scope、SAT/UNSATの解釈を参照）
- 製品実装への引継ぎ先: [#381](https://github.com/asadaame5121/Radiora/issues/381)、
  [保存PoC #383](https://github.com/asadaame5121/Radiora/issues/383)、
  [Legacy Importer #384](https://github.com/asadaame5121/Radiora/issues/384)
