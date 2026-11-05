# Expected: quarantine invalid payloads

- Fixture JSON自体はvalid。各recordの`payloadSource`はSQLiteのpayload TEXTへそのまま書く原文。
- 8 recordすべてをarchive件数に含める（metadata込みのlegacy_archiveは9行）。
- 正常なwork/feedbackの2 recordだけがLegacySource.recordsへ入る。
- JSON構文不正、型不正、歴史年代yearと通常orderKeyの1e400、孤立UTF-16 surrogate、identity不一致の6
  recordは隔離する。
- 各隔離recordについて診断を1件ずつ保存する。severity=error、kind=invalid-record、action=archived-only。
- 隔離行はLoro文書には出ない。I4/I5未実装のため今回の自動試験はtyped
  recordsからの除外までを確認する。
- 隔離されたIDへの参照はI1 oracleのResolution::Missing扱いとし、別recordへリダイレクトしない。
- 全recordのid/position/payload原文、row/table hash・件数・bytesを照合する。
- main DB/WALのsize・mtime・SHA-256が不変。import_runは文書層未完のrunningのまま。
- serde_jsonはfloat_roundtripを使用する。1e400はfield検証の前にJSON parseで失敗する。
  有限f64に収まらない数値は原文archive＋診断へ隔離し、正常行の変換を続行する。
