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

#[test]
fn finite_numbers_keep_f64_bits_through_json_payloads_and_ipc_shapes() {
    use radiora_core::legacy::Number;
    use serde::Serialize;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Numeric {
        value: Number,
    }
    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Flattened {
        #[serde(flatten)]
        fields: Numeric,
    }
    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    #[serde(untagged)]
    enum Ipc {
        Numeric(Flattened),
    }

    for literal in [
        "0.1",
        "1.7976931348623157e308",
        "5e-324",
        "-0.0",
        "-1.7976931348623157e308",
    ] {
        let expected: f64 = literal.parse().unwrap();
        let number: Number = serde_json::from_str(literal).unwrap();
        assert_eq!(number.0.to_bits(), expected.to_bits());
        let encoded = serde_json::to_string(&number).unwrap();
        let restored: Number = serde_json::from_str(&encoded).unwrap();
        assert_eq!(restored.0.to_bits(), expected.to_bits());

        let payload = format!(
            r#"{{"workId":"w","occurrenceId":"o","caretOffset":{literal},"updatedAt":"2026-01-01T00:00:00.000Z"}}"#
        );
        let Payload::ResumePosition(value) =
            validate_record("resume_position", "current", &payload).unwrap()
        else {
            panic!("expected resume_position");
        };
        assert_eq!(value.caret_offset.0.to_bits(), expected.to_bits());

        let json = format!(r#"{{"value":{literal}}}"#);
        let ipc: Ipc = serde_json::from_str(&json).unwrap();
        let Ipc::Numeric(value) = &ipc;
        assert_eq!(value.fields.value.0.to_bits(), expected.to_bits());
        let encoded = serde_json::to_string(&ipc).unwrap();
        let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        assert!(value["value"].is_number());
        assert_eq!(
            value["value"].as_f64().unwrap().to_bits(),
            expected.to_bits()
        );
        assert_eq!(serde_json::from_str::<Ipc>(&encoded).unwrap(), ipc);
    }
}

#[test]
fn overflowing_json_numbers_are_record_errors_for_importer_quarantine() {
    for literal in ["1e400", "-1e400"] {
        let payload = format!(
            r#"{{"workId":"w","occurrenceId":"o","caretOffset":{literal},"updatedAt":"2026-01-01T00:00:00.000Z"}}"#
        );
        let error = validate_record("resume_position", "current", &payload).unwrap_err();
        assert_eq!(error.table, "resume_position");
        assert_eq!(error.id, "current");
        assert!(error.reason.contains("number out of range"));
    }
}
