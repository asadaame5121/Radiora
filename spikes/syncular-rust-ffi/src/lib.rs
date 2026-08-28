//! Syncular Rust FFI Spike
//!
//! Re-exports the complete C-ABI surface from `syncular-ffi` for Deno FFI.

pub use syncular::*;

#[cfg(test)]
mod spike_tests {
    use super::*;
    use serde_json::{json, Value};
    use std::ffi::{CStr, CString};

    fn run_command(handle: *mut Handle, method: &str, params: Value) -> Value {
        let cmd = CString::new(json!({ "method": method, "params": params }).to_string()).unwrap();
        let reply_ptr = syncular_client_command(handle, cmd.as_ptr());
        assert!(!reply_ptr.is_null(), "command {method} returned null");
        let text = unsafe { CStr::from_ptr(reply_ptr) }
            .to_str()
            .unwrap()
            .to_owned();
        syncular_free_string(reply_ptr);
        serde_json::from_str(&text).unwrap()
    }

    fn poll_next_event(handle: *mut Handle) -> Option<Value> {
        let event_ptr = syncular_client_poll_event(handle, 0);
        if event_ptr.is_null() {
            return None;
        }
        let text = unsafe { CStr::from_ptr(event_ptr) }
            .to_str()
            .unwrap()
            .to_owned();
        syncular_free_string(event_ptr);
        Some(serde_json::from_str(&text).unwrap())
    }

    fn sample_schema() -> Value {
        json!({
            "version": 1,
            "tables": [{
                "name": "work_note",
                "primaryKey": "id",
                "columns": [
                    { "name": "id", "type": "string", "nullable": false },
                    { "name": "text", "type": "string", "nullable": false },
                    { "name": "updated_at", "type": "string", "nullable": false }
                ],
                "scopes": []
            }]
        })
    }

    #[test]
    fn test_syncular_local_sqlite_lifecycle() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let db_path = temp_dir
            .path()
            .join("radiora_syncular.db")
            .to_str()
            .unwrap()
            .to_owned();

        let config = CString::new("{}").unwrap();
        let handle = syncular_client_new(config.as_ptr());
        assert!(!handle.is_null(), "Handle creation failed");

        // 1. Create client with schema and file-backed SQLite database
        let create_res = run_command(
            handle,
            "create",
            json!({
                "clientId": "client_spike_1",
                "schema": sample_schema(),
                "dbPath": db_path
            }),
        );
        assert_eq!(create_res["result"], json!({}), "Create must succeed");

        // 2. Subscribe to table
        let sub_res = run_command(
            handle,
            "subscribe",
            json!({
                "id": "sub_notes",
                "table": "work_note",
                "scopes": {}
            }),
        );
        assert_eq!(sub_res["result"], json!({}), "Subscribe must succeed");

        // 3. Mutate (Upsert a row)
        let mutate_res = run_command(
            handle,
            "mutate",
            json!({
                "mutations": [{
                    "op": "upsert",
                    "table": "work_note",
                    "values": {
                        "id": "work_001",
                        "text": "Radiora Syncular Spike Test Note",
                        "updated_at": "2026-08-26T19:30:00.000Z"
                    }
                }]
            }),
        );
        let commit_id = mutate_res["result"]["clientCommitId"]
            .as_str()
            .expect("commit id string");
        assert!(!commit_id.is_empty(), "Valid commit id returned");

        // 4. Read rows via Syncular readRows
        let rows_res = run_command(handle, "readRows", json!({ "table": "work_note" }));
        let rows = rows_res["result"]["rows"].as_array().expect("rows array");
        assert_eq!(rows.len(), 1, "One row present");
        assert_eq!(rows[0]["values"]["id"], "work_001");
        assert_eq!(
            rows[0]["values"]["text"],
            "Radiora Syncular Spike Test Note"
        );

        // 5. Query via Syncular SQL query
        let query_res = run_command(
            handle,
            "query",
            json!({
                "sql": "SELECT id, text, updated_at FROM work_note WHERE id = ?",
                "params": ["work_001"]
            }),
        );
        let query_rows = query_res["result"]["rows"].as_array().expect("query rows");
        assert_eq!(query_rows.len(), 1);
        assert_eq!(query_rows[0]["text"], "Radiora Syncular Spike Test Note");

        // 6. Verify Outbox / Pending commits
        let pending_res = run_command(handle, "pendingCommitIds", Value::Null);
        let pending_ids = pending_res["result"]["ids"]
            .as_array()
            .expect("pending ids array");
        assert_eq!(pending_ids.len(), 1, "Exactly 1 pending commit in outbox");
        assert_eq!(pending_ids[0], commit_id);

        // 7. Poll Events (change batch and sync-intent)
        let mut events = Vec::new();
        while let Some(ev) = poll_next_event(handle) {
            events.push(ev);
        }
        let change_ev = events
            .iter()
            .find(|e| e["type"] == "change")
            .expect("Change event emitted");
        assert_eq!(change_ev["batch"]["tables"][0]["table"], "work_note");
        assert_eq!(change_ev["batch"]["status"]["outbox"], 1);

        let intent_ev = events
            .iter()
            .find(|e| e["type"] == "sync-intent")
            .expect("Sync intent emitted");
        assert_eq!(intent_ev["intent"]["kind"], "interactive");

        // 8. Close client
        syncular_client_close(handle);
    }
}
