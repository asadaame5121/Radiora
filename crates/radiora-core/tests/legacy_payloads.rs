use radiora_core::legacy::{Payload, RECORD_TABLES, validate_record};
use serde::Deserialize;
#[derive(Deserialize)]
struct Case {
    name: String,
    table: String,
    id: String,
    json: String,
    accept: bool,
}
#[test]
fn v2_schema_corpus() {
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("fixtures/legacy_payload_cases.json")).unwrap();
    for case in cases {
        let result = validate_record(&case.table, &case.id, &case.json);
        assert_eq!(result.is_ok(), case.accept, "{}: {result:?}", case.name);
        if let Err(error) = result {
            assert_eq!(error.table, case.table);
            assert_eq!(error.id, case.id);
            assert!(!error.reason.is_empty());
        }
    }
}
#[test]
fn malformed_json_identity_and_unknown_table_are_record_errors() {
    for table in RECORD_TABLES {
        let error = validate_record(table, "fixture", "{").unwrap_err();
        assert_eq!((&*error.table, &*error.id), (table, "fixture"));
    }
    assert!(validate_record("unknown", "x", "{}").is_err());
    assert!(validate_record("work", "", "{}").is_err());
    assert!(
        validate_record(
            "working_copy",
            "different",
            r#"{"branchId":"b","workId":"w","text":"","updatedAt":"2026-01-01T00:00:00.000Z"}"#
        )
        .is_err()
    );
    let result = validate_record("emergence_feedback", "not-uuid", r#""pin""#).unwrap();
    assert!(matches!(result, Payload::EmergenceFeedback(_)));
}

#[test]
fn unsupported_utf16_is_a_record_error_without_lossy_replacement() {
    // Keep the original source untouched rather than silently changing text.
    let error = validate_record(
        "working_copy",
        "b",
        r#"{"branchId":"b","workId":"w","text":"\ud800","updatedAt":"2026-01-01T00:00:00.000Z"}"#,
    )
    .unwrap_err();
    assert_eq!(error.table, "working_copy");
    assert_eq!(error.id, "b");
}
