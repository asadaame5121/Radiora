//! Unit tests for adapter states that the public API cannot produce on demand.

use super::*;
use radiora_core::app::{DocumentCommand, Request};

fn request(base: u64, command: DocumentCommand) -> (RequestId, Fingerprint) {
    let request = Request {
        id: RequestId::new(Uuid::now_v7()),
        base,
        command,
    };
    (request.id, request.fingerprint())
}

/// After a SQLite COMMIT that succeeded while the caller saw an error, the adapter is
/// pending although the update and its receipt are durable. Reproduced by rolling the
/// in-memory state back; the receipt then matches, `acknowledge_durable` settles it, and
/// the update is not appended a second time.
#[test]
fn a_lost_commit_result_is_settled_by_its_receipt() {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = dir.path().join("workspace.db");
    let id = issue_block_id().expect("block id");
    let mut store = WorkspaceStore::open(&path).expect("open");
    let (create, create_fp) = request(0, DocumentCommand::CreateDocument { id });
    store
        .apply(create, &create_fp, &DocumentChange::CreateDocument { id })
        .expect("create");

    let (edit, edit_fp) = request(
        1,
        DocumentCommand::UpdateBody {
            id,
            body: "durable".into(),
        },
    );
    let saved_before = store.saved.clone();
    let change = DocumentChange::SetBody {
        id,
        body: "durable".into(),
    };
    assert_eq!(store.apply(edit, &edit_fp, &change).expect("edit"), 2);

    store.saved = saved_before;
    store.version = 1;
    store.state = State::Pending;
    assert!(store.committed_view().is_err());

    let receipt = store
        .receipt(edit, &edit_fp)
        .expect("receipt")
        .expect("found");
    assert_eq!(
        receipt,
        Receipt {
            matches: true,
            version: 2
        }
    );
    store.acknowledge_durable(receipt.version).expect("settle");
    assert_eq!(store.durable_version(), 2);
    let (next, next_fp) = request(
        2,
        DocumentCommand::UpdateBody {
            id,
            body: "next".into(),
        },
    );
    let next_change = DocumentChange::SetBody {
        id,
        body: "next".into(),
    };
    assert_eq!(store.apply(next, &next_fp, &next_change).expect("next"), 3);
    drop(store);

    let reopened = WorkspaceStore::open(&path).expect("reopen");
    assert_eq!(reopened.durable_version(), 3);
    assert_eq!(
        reopened.committed_view().expect("view").blocks[0].body,
        "next"
    );
}
