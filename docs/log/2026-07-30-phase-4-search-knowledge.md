# Phase 4 検索と知識整備

- 実施日: 2026-07-30
- storage schema: `3 -> 6`
- backup schema: `3 -> 6`
- 対象Issue: `#51`, `#52`–`#60`
- 状態: closeout検証済み

## 実装した境界

- 検索、Today、保存Queryで共用する一時Occurrence投影を導入した。投影は実データを参照するだけで、
  表示やQuery実行のために永続Occurrenceを作成しない
- 一致、祖先、直接リンク、score、順位理由を最小文脈として保持するSparse Outlineを追加した
- 保存QueryをSparse Outline表示へ接続し、投影ノードから実Workを編集して再実行できるようにした
- 明示作成した未配置WorkをStubとして扱い、作成経路・文脈・Backlink・一覧を保持する。
  本文が非空の場合だけ明示解除できる
- タイトル正規化、alias、共有タグ、共有リンクを根拠に重複候補を表示する。候補算出は読み取り専用で、
  自動統合しない
- 統合前previewと、配置・リンク・Revision・alias・来歴を保持するtransactional mergeを追加した。
  統合元Workは削除せずprovenanceを残す
- 非統合時の`LIKE`、`RELATED`、却下を別操作にし、意味リンクは利用者の明示操作でだけ作成する
- 発見候補を確定リンクから分離して永続化し、採用・理由付き却下・保留と根拠を追跡する。
  採用時だけ`origin: "suggestion"`のリンクを候補状態と原子的に確定する
- 3,000 Work、500一致、24,000リンクの回帰テストで、祖先・選択・順位理由と入力非破壊を確認する

## 永続化と互換性

`0004_stub_state`、`0005_merge_provenance`、`0006_emergence_suggestion`により、
storage schemaとbackup schemaをversion `6`へ進めた。

- version `3`からStub状態を追加する
- version `4`から統合先と統合時刻を持つprovenanceを追加し、統合元Workを黙って削除しない
- version `5`から発見候補エンティティを追加する。旧`emergence_feedback`は推測変換せず、
  同一候補の再発見時にだけ遅延反映する
- JSON backupは新規保存時にschema version `6`を使い、旧version入力は一段ずつ移行する

## Issueとchange

- `#52` `40e84570`: 検索・Today・保存Queryの一時投影
- `#53` `c989225b`: Sparse Outline生成
- `#54` `e4ff85d4`, `88a7599b`: 保存QueryのSparse Outline表示と実Work編集
- `#55` `d9db5e96`: Stub、作成文脈、Backlink、schema version `4`
- `#56` `c67c04a5`: 重複候補のscore・根拠表示
- `#57` `dc91e093`: 統合preview、transactional merge、schema version `5`
- `#58` `d1f5a272`: 非統合時の`LIKE`・`RELATED`明示操作
- `#59` `3a22ab48`: 発見候補の永続化と意思決定、schema version `6`
- `#60` `731cc4e1`: 高密度Sparse Outlineの文脈・性能回帰テスト

## 検証

- 各Issue changeで`deno task verify`を実行し、成功後に専用bookmarkをpushした
- Phase 4統合状態: `329 passed / 0 failed`
- Deno型検査、Svelte検査、production buildに成功した
- 高密度Sparse Outline: 3,000 items、500 matches、24,000 linksを600ms
  （回帰上限2.5秒）で投影した

## 既知の制約

- 高密度回帰はSparse Outline生成器を対象にし、Svelte描画全体の性能測定ではない
- 重複候補の「却下（何もしない）」は画面内の除外であり、再起動後まで判断を永続化しない
- 発見候補は自動提案由来と人間確定を`origin`で識別するが、AI model固有のprovenanceは持たない
- Phase 4 changesは専用bookmarkへpush済みで、`main`への統合は別判断とする
