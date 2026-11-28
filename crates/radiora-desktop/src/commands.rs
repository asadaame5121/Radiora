//! Tauri commands: validation at the boundary, then the coordinator on a blocking thread.
//! No domain logic lives here. Names are listed in `command_names.rs`.

use crate::dto::{ErrorDto, ReadSavedWorkspaceRequest, SavedWorkspaceDto};
use crate::host::{Coordinator, WorkspaceHost, reader};
use std::sync::Mutex;
use tauri::State;

/// Returns the saved (durable) read model. Never returns unsaved values and never waits for
/// a running save: it answers `busy`, `persist_pending` or `recovery_required` instead.
#[tauri::command]
pub async fn read_saved_workspace(
    host: State<'_, WorkspaceHost>,
    request: Option<serde_json::Value>,
) -> Result<SavedWorkspaceDto, ErrorDto> {
    let ReadSavedWorkspaceRequest {} = ReadSavedWorkspaceRequest::parse(request)?;
    let handle = host.coordinator()?;
    tauri::async_runtime::spawn_blocking(move || read_saved(&handle))
        .await
        .map_err(|error| {
            tracing::error!(%error, "reading the saved workspace did not complete");
            ErrorDto::storage()
        })?
}

/// The body of `read_saved_workspace`, callable without a Tauri runtime.
pub(crate) fn read_saved(handle: &Mutex<Coordinator>) -> Result<SavedWorkspaceDto, ErrorDto> {
    let coordinator = reader(handle)?;
    let view = coordinator.view().map_err(|error| {
        tracing::warn!(%error, "the saved read model was refused");
        ErrorDto::from_read(&error)
    })?;
    SavedWorkspaceDto::try_from(view)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::ErrorKind;
    use crate::host::DATABASE_FILE;
    use radiora_infra::workspace::fixture::{bodies, representative};
    use serde_json::{Value, json};

    fn rows(topic: &Value) -> &Vec<Value> {
        topic["blocks"].as_array().expect("blocks")
    }

    #[test]
    fn the_representative_fixture_reads_through_the_command() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let ids = representative(&dir.path().join(DATABASE_FILE)).expect("fixture");
        let host = WorkspaceHost::open(dir.path());
        let handle = host.coordinator().expect("available");
        let dto = read_saved(&handle).expect("read");
        let json = serde_json::to_value(&dto).expect("json");

        assert_eq!(json["generation"], json!(0));
        let topics = json["topics"].as_array().expect("topics");
        assert_eq!(topics.len(), 2, "the trashed Topic is left out");

        let first = rows(&topics[0]);
        let outline: Vec<_> = first
            .iter()
            .map(|row| (row["id"].clone(), row["depth"].clone(), row["kind"].clone()))
            .collect();
        assert_eq!(
            outline,
            vec![
                (json!(ids.first.to_string()), json!(0), json!("block")),
                (json!(ids.combining.to_string()), json!(1), json!("block")),
                (json!(ids.crlf.to_string()), json!(2), json!("block")),
                (
                    json!(ids.live_reference.to_string()),
                    json!(1),
                    json!("reference")
                ),
                (
                    json!(ids.reference_child.to_string()),
                    json!(2),
                    json!("block")
                ),
            ]
        );
        assert_eq!(first[0]["parentId"], Value::Null);
        assert_eq!(first[2]["parentId"], json!(ids.combining.to_string()));
        assert_eq!(first[0]["body"], json!(bodies::FIRST));
        assert_eq!(first[1]["body"], json!(bodies::COMBINING));
        assert_eq!(first[2]["body"], json!(bodies::CRLF));
        let live = &first[3];
        assert_eq!(live["heading"], json!(bodies::HEADING));
        assert_eq!(live["target"]["id"], json!(ids.combining.to_string()));
        assert_eq!(live["target"]["state"], json!("live"));
        assert_eq!(live["target"]["body"], json!(bodies::COMBINING));
        assert_eq!(live["target"]["bodyVersion"], first[1]["bodyVersion"]);
        assert!(live.get("body").is_none(), "a reference item owns no body");

        let second = rows(&topics[1]);
        let targets: Vec<_> = second[1..]
            .iter()
            .map(|row| (row["target"]["id"].clone(), row["target"]["state"].clone()))
            .collect();
        assert_eq!(
            targets,
            vec![
                (json!(ids.trashed.to_string()), json!("trashed")),
                (json!(ids.unknown.to_string()), json!("missing")),
                (json!(ids.purged.to_string()), json!("missing")),
            ]
        );
        for row in &second[1..] {
            assert!(
                row["target"].get("body").is_none(),
                "no body without a live target"
            );
        }
    }

    /// The payload holds logical IDs, bodies and opaque versions only.
    #[test]
    fn the_payload_exposes_no_internal_identifier_or_path() {
        let dir = tempfile::tempdir().expect("temporary directory");
        representative(&dir.path().join(DATABASE_FILE)).expect("fixture");
        let host = WorkspaceHost::open(dir.path());
        let handle = host.coordinator().expect("available");
        let text = serde_json::to_string(&read_saved(&handle).expect("read")).expect("json");
        let dir_text = dir.path().display().to_string();
        for leak in [
            "cid:",
            "Text",
            "@",
            "SELECT",
            "workspace.db",
            dir_text.as_str(),
        ] {
            assert!(!text.contains(leak), "the payload contains {leak:?}");
        }
        let json: Value = serde_json::from_str(&text).expect("json");
        for topic in json["topics"].as_array().expect("topics") {
            for row in rows(topic) {
                let mut keys: Vec<_> = row.as_object().expect("row").keys().cloned().collect();
                keys.sort();
                let expected: &[&str] = if row["kind"] == "block" {
                    &["body", "bodyVersion", "depth", "id", "kind", "parentId"]
                } else {
                    &["depth", "heading", "id", "kind", "parentId", "target"]
                };
                assert_eq!(keys, expected);
            }
        }
    }

    #[test]
    fn a_read_during_a_write_is_refused_instead_of_waiting() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let host = WorkspaceHost::open(dir.path());
        let handle = host.coordinator().expect("available");
        let writing = handle.lock().expect("hold the writer");
        assert_eq!(read_saved(&handle).expect_err("busy").kind, ErrorKind::Busy);
        drop(writing);
        assert!(read_saved(&handle).is_ok());
    }

    /// A change applied in memory but not yet durable is never published: the read is refused
    /// with `persist_pending` until the retry makes it durable.
    #[test]
    fn an_unsaved_change_is_never_read() {
        use radiora_core::app::{DocumentCommand, Request, RequestId};
        use radiora_infra::workspace::fixture::set_write_failure;
        use radiora_infra::workspace::issue_block_id;
        use uuid::Uuid;

        let dir = tempfile::tempdir().expect("temporary directory");
        let host = WorkspaceHost::open(dir.path());
        let handle = host.coordinator().expect("available");
        let block = issue_block_id().expect("id");
        let request = |base, command| Request {
            id: RequestId::new(Uuid::now_v7()),
            base,
            command,
        };
        handle
            .lock()
            .expect("writer")
            .execute(request(0, DocumentCommand::CreateDocument { id: block }))
            .expect("create");
        let saved = read_saved(&handle).expect("read");

        let path = dir.path().join(DATABASE_FILE);
        set_write_failure(&path, true).expect("inject a write failure");
        let edit = DocumentCommand::UpdateBody {
            id: block,
            body: "未保存".into(),
        };
        assert!(
            handle
                .lock()
                .expect("writer")
                .execute(request(1, edit))
                .is_err()
        );
        assert_eq!(
            read_saved(&handle).expect_err("withheld").kind,
            ErrorKind::PersistPending
        );

        set_write_failure(&path, false).expect("remove the failure");
        handle.lock().expect("writer").retry().expect("retry");
        let after = read_saved(&handle).expect("read");
        assert!(after.generation > saved.generation);
        let row = serde_json::to_value(&after.topics[0].blocks[0]).expect("json");
        assert_eq!(row["body"], json!("未保存"));
    }

    #[test]
    fn an_unavailable_workspace_reports_its_kind() {
        let host = WorkspaceHost::unavailable(crate::host::Unavailable::Unreadable, None);
        assert_eq!(
            host.coordinator().err().expect("unavailable").kind,
            ErrorKind::WorkspaceUnavailable
        );
    }
}
