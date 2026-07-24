---
title: Radiora v2 スキーマ変更・マイグレーション規則
date: 2026-07-26
status: accepted
tags:
  - radiora
  - design
  - schema
  - migration
---

# Radiora v2 スキーマ変更・マイグレーション規則

## 1. 目的

この文書は、Radioraの実DBとJSONバックアップ形式を変更する際の規則を定める。
データモデルの変更を禁止するものではなく、変更の意図、変換手順、検証方法を後から追跡でき、
既存データを失わず新しい実装へ移せることを目的とする。

製品上のデータモデルと機能境界は[[product-direction]]を正とする。本書は、そのモデルを
永続化形式へ反映する際の手続きを扱う。

## 2. 現在の基準点

現行PoCは次の状態にある。

- SurrealDB schemaは`SurrealGraphStore.initialize()`内の`DEFINE ... IF NOT EXISTS`で生成している
- DB内に適用済みschema versionを記録していない
- JSON storeは`items`、`links`などを直下に持ち、形式名とschema versionを持たない
- `OutlineItem.parentId`が配置と系譜を兼ねており、Work / Occurrence導入時に大きな移行が必要になる

この現行形式を次のように扱う。

| 対象 | 現行形式 |
|---|---|
| SurrealDB storage schema | version `0` |
| versionなしJSON | backup schema version `0` |
| Work / Occurrence以降の最初の正式形式 | version `1` |

version `0`は互換入力として扱うlegacy形式であり、今後同じ形へ新規出力しない。

## 3. 二つのschema version

実DBと交換用JSONは別々にversionを持つ。

```ts
type StorageSchemaVersion = number;
type BackupSchemaVersion = number;
```

### 3.1 Storage schema version

ローカルSurrealDBのtable、field、relation、index、保存上の不変条件を表す。
アプリ起動時のmigration判断に使用する。

### 3.2 Backup schema version

JSONバックアップのenvelopeと`data`の形を表す。Import、restore、外部ツールとの交換判断に使う。

両者は同時に増えるとは限らない。検索indexの追加はstorageだけ、JSON envelopeのmetadata追加は
backupだけを増やし得る。Workの必須field追加のように両方へ影響する変更では、それぞれを増やす。

アプリのSemVer、SurrealDB本体のversion、storage schema version、backup schema versionを
相互に代用しない。

## 4. Version付与規則

- versionは`0`以上の単調増加整数とする
- 永続データの形または意味を変更するたび、影響するschema versionを一つ増やす
- 小数、日付、アプリversionをschema versionに使わない
- 一度公開したversion番号の意味を後から書き換えない
- migrationは必ず`N -> N + 1`の一段ずつとし、飛び級を実装しない
- 自動downgrade migrationは提供しない。失敗時はmigration前バックアップから復元する

次はstorage schema versionを増やす変更である。

- table、field、relation、indexの追加、削除、改名、型変更
- nullability、default、unique制約などの変更
- 同じfieldを異なる意味で解釈する変更
- ID形式、時刻形式、リンク方向など永続上の不変条件の変更

メモリ内だけの型、UI表示、保存されない計算結果の変更では増やさない。

## 5. DB内のversion記録

version `1`以降は、DB内に一件だけschema metadataを保持する。

```ts
interface SchemaMetadata {
	id: "radiora";
	version: number;
	updatedAt: string;
	lastMigrationId: string;
	appVersion: string;
}
```

metadataがなく、既存の`outline_item`などversion `0`のtableが存在するDBはversion `0`として
検出する。空の新規DBは、同じmigration列を通して現行versionまで構築する。

適用履歴は別のmigration journalへ残す。

```ts
interface MigrationJournalEntry {
	id: string;
	fromVersion: number;
	toVersion: number;
	startedAt: string;
	completedAt?: string;
	appVersion: string;
	status: "started" | "completed" | "failed";
	error?: string;
}
```

## 6. Migrationの構造

各migrationは独立したファイルとし、番号と目的を名前に含める。

```text
src/storage/migrations/
  mod.ts
  0001_work_occurrence.ts
  0002_revision_branch.ts
```

最低限、次の契約を持つ。

```ts
interface StorageMigration {
	id: string;
	fromVersion: number;
	toVersion: number;
	up(context: MigrationContext): Promise<void>;
	validate(context: MigrationContext): Promise<void>;
}
```

`toVersion`は常に`fromVersion + 1`とする。`validate`は件数だけでなく、参照整合性、
必須field、リンク方向、孤児record、日本語本文の一致など、そのmigration固有の不変条件を検査する。

## 7. DB migrationの実行手順

アプリ起動時は次の順に処理する。

1. DBを排他的なmigration状態で開く
2. 現在のstorage schema versionを読む
3. アプリが知るversionより新しければ、書き込まず起動を停止する
4. migration前の保護SnapshotまたはDBバックアップを作る
5. `N -> N + 1`を一件適用する
6. migration固有の`validate`を実行する
7. 成功した場合だけschema metadataのversionを更新する
8. journalを`completed`にして次のmigrationへ進む
9. 全migration完了後に通常のstoreを公開する

SurrealDBで対象操作をtransactionに含められる場合はtransaction内で実行する。含められない
schema操作がある場合は、再実行可能な段階へ分割し、失敗時は保護バックアップから復元する。
version番号だけを先に進めない。

大きな置換は可能な限り次の三段階に分ける。

1. **Expand**: 新構造を追加する
2. **Migrate**: 旧データを変換し、新旧の整合性を検証する
3. **Contract**: 十分な検証後に旧構造を削除する

## 8. JSONバックアップ形式

version `1`以降のJSONは次のenvelopeを持つ。

```json
{
  "format": "radiora-backup",
  "schemaVersion": 1,
  "exportedAt": "2026-07-26T00:00:00.000Z",
  "appVersion": "0.0.0",
  "source": {
    "storageSchemaVersion": 1
  },
  "data": {}
}
```

- `format`が異なるJSONをRadioraバックアップとして推測importしない
- `schemaVersion`はbackup schema versionであり、storage versionではない
- ID、時刻、本文、Revision親子、Branch、化身、意味リンクを完全バックアップできる
- 現行のenvelopeなしJSONはversion `0`として専用readerで受ける
- 新しいexportでversion `0`を生成しない

Import時は入力ファイルを直接書き換えない。旧versionはメモリ内または一時領域で一段ずつ
現行形式へ変換し、全体検証に成功してからDBへtransactionalに反映する。現在のアプリより新しい
backup schema versionは、部分的に読み込まず明示的に拒否する。

一度公開したbackup schemaのmigration chainは原則として維持する。将来アプリ本体から外す必要が
生じた場合も、旧形式から現行形式へ変換する独立ツールを先に提供する。

## 9. 変更時に必ず残すもの

永続形式を変更する作業には次を含める。

- schema versionを増やす理由
- 変更前後のデータ例
- 一段のmigration実装
- migration前versionのfixture
- 変換後のdomain invariant検証
- 日本語、改行、Markdown、`radiora://`内部参照を含むround-trip test
- 途中失敗と再起動を想定したtest
- JSON export、import、restoreへの影響
- [[product-direction]]または本書の該当箇所の更新

生成したDB、migration診断ログ、test出力はリポジトリへコミットしない。fixtureは個人データを
含まない最小の手書きデータだけを使用する。

## 10. Work / Occurrence移行での初回適用

version `0`から`1`へのmigrationは、少なくとも次を明示的に検証する。

- 各`OutlineItem`から一つのWorkと一つのOccurrenceが作られる
- `text`、作成日時、更新日時が失われない
- `parentId`はOccurrenceの親子配置へ移し、意味上の`FROM`へ自動複製しない
- 現行の意味リンクは正しいWork端点と正準方向へ変換される
- 循環または孤児になっている配置をStashへ隔離し、黙って削除しない
- 既存JSON version `0`とSurrealDB version `0`の双方から同じdomain状態を得られる

この移行はRadioraの配置と系譜を分離する境界になるため、単なるtable renameとして扱わない。
