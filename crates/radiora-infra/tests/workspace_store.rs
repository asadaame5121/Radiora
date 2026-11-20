//! V01 integration tests (I): the product application entry (`DocumentCoordinator`) over the
//! real Loro/SQLite document adapter. Persistence failures are injected from a second
//! connection with a SQLite trigger, so the product code carries no test hook.

use radiora_core::app::{
    BlockView, CommandError, DocumentCommand, DocumentCoordinator, PlanError, Request, RequestId,
    Saved,
};
use radiora_core::model::BlockId;
use radiora_infra::workspace::{WorkspaceError, WorkspaceStore, issue_block_id};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use uuid::Uuid;

type Coordinator = DocumentCoordinator<WorkspaceStore>;

fn temp_db() -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = dir.path().join("workspace.db");
    (dir, path)
}

fn open(path: &Path) -> Coordinator {
    DocumentCoordinator::new(WorkspaceStore::open(path).expect("open the workspace"))
}

fn block() -> BlockId {
    issue_block_id().expect("UUIDv7 block id")
}

fn new_id() -> RequestId {
    RequestId::new(Uuid::now_v7())
}

fn create(id: RequestId, base: u64, block: BlockId) -> Request {
    Request {
        id,
        base,
        command: DocumentCommand::CreateDocument { id: block },
    }
}

fn edit(id: RequestId, base: u64, block: BlockId, body: &str) -> Request {
    Request {
        id,
        base,
        command: DocumentCommand::UpdateBody {
            id: block,
            body: body.into(),
        },
    }
}

fn saved(version: u64, replayed: bool) -> Saved {
    Saved { version, replayed }
}

fn bodies(coordinator: &Coordinator) -> Vec<(BlockId, String)> {
    coordinator
        .view()
        .expect("committed view")
        .blocks
        .into_iter()
        .map(|block| (block.id, block.body))
        .collect()
}

fn set_write_failure(path: &Path, enabled: bool) {
    let db = Connection::open(path).expect("second connection");
    db.execute_batch(if enabled {
        "CREATE TRIGGER reject_update BEFORE INSERT ON updates
         BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;"
    } else {
        "DROP TRIGGER reject_update;"
    })
    .expect("toggle the injected failure");
}

#[test]
fn a_new_workspace_is_empty_at_version_zero() {
    let (_dir, path) = temp_db();
    let view = open(&path).view().expect("view");
    assert_eq!(view.version, 0);
    assert!(view.blocks.is_empty());
}

#[test]
fn saved_documents_and_bodies_survive_reopening() {
    let (_dir, path) = temp_db();
    let (first, second) = (block(), block());
    {
        let mut app = open(&path);
        assert_eq!(
            app.execute(create(new_id(), 0, first)).expect("create"),
            saved(1, false)
        );
        app.execute(create(new_id(), 1, second)).expect("create");
        app.execute(edit(new_id(), 2, first, "思索の連鎖 🌱\n二行目"))
            .expect("edit");
        app.execute(edit(new_id(), 3, second, "後で消す"))
            .expect("edit");
        app.execute(edit(new_id(), 4, second, "")).expect("clear");
        assert_eq!(app.version(), 5);
    }
    let app = open(&path);
    assert_eq!(app.version(), 5);
    assert_eq!(
        app.view().expect("view").blocks,
        vec![
            BlockView {
                id: first,
                parent: None,
                index: 0,
                body: "思索の連鎖 🌱\n二行目".into(),
            },
            BlockView {
                id: second,
                parent: None,
                index: 1,
                body: String::new(),
            },
        ]
    );
}

#[test]
fn a_resent_request_returns_its_recorded_result_without_reapplying() {
    let (_dir, path) = temp_db();
    let id = block();
    let mut app = open(&path);
    app.execute(create(new_id(), 0, id)).expect("create");
    let request = new_id();
    assert_eq!(
        app.execute(edit(request, 1, id, "once")).expect("edit"),
        saved(2, false)
    );
    assert_eq!(
        app.execute(edit(request, 1, id, "once")).expect("resend"),
        saved(2, true)
    );
    drop(app);
    let reopened = open(&path);
    assert_eq!(reopened.version(), 2);
    assert_eq!(bodies(&reopened), vec![(id, "once".into())]);
}

#[test]
fn a_request_id_cannot_be_reused_for_another_operation() {
    let (_dir, path) = temp_db();
    let id = block();
    let mut app = open(&path);
    app.execute(create(new_id(), 0, id)).expect("create");
    let request = new_id();
    app.execute(edit(request, 1, id, "first")).expect("edit");
    let error = app.execute(edit(request, 1, id, "second")).unwrap_err();
    assert!(matches!(error, CommandError::RequestReused(reused) if reused == request));
    assert_eq!(bodies(&app), vec![(id, "first".into())]);
}

#[test]
fn an_unchanged_body_is_recorded_without_a_new_version() {
    let (_dir, path) = temp_db();
    let id = block();
    let mut app = open(&path);
    app.execute(create(new_id(), 0, id)).expect("create");
    app.execute(edit(new_id(), 1, id, "same")).expect("edit");
    let no_op = app
        .execute(edit(new_id(), 2, id, "same"))
        .expect("no-op edit");
    assert_eq!(no_op, saved(2, false));
}

#[test]
fn a_stale_base_version_is_rejected_without_changing_the_document() {
    let (_dir, path) = temp_db();
    let id = block();
    let mut app = open(&path);
    app.execute(create(new_id(), 0, id)).expect("create");
    app.execute(edit(new_id(), 1, id, "newer")).expect("edit");
    let error = app.execute(edit(new_id(), 1, id, "older")).unwrap_err();
    assert!(matches!(
        error,
        CommandError::StaleVersion {
            base: 1,
            current: 2
        }
    ));
    assert_eq!(bodies(&app), vec![(id, "newer".into())]);
}

#[test]
fn unknown_and_duplicate_blocks_are_rejected() {
    let (_dir, path) = temp_db();
    let id = block();
    let missing = block();
    let mut app = open(&path);
    app.execute(create(new_id(), 0, id)).expect("create");
    let error = app.execute(edit(new_id(), 1, missing, "x")).unwrap_err();
    assert!(
        matches!(error, CommandError::Plan(PlanError::UnknownBlock(unknown)) if unknown == missing)
    );
    let error = app.execute(create(new_id(), 1, id)).unwrap_err();
    assert!(
        matches!(error, CommandError::Plan(PlanError::DuplicateBlock(duplicate)) if duplicate == id)
    );
    assert_eq!(app.version(), 1);
}

#[test]
fn a_failed_save_stays_dirty_and_retry_persists_it_once() {
    let (_dir, path) = temp_db();
    let id = block();
    let mut app = open(&path);
    app.execute(create(new_id(), 0, id)).expect("create");
    app.execute(edit(new_id(), 1, id, "saved")).expect("edit");

    set_write_failure(&path, true);
    let request = new_id();
    let error = app
        .execute(edit(request, 2, id, "saved, then more"))
        .unwrap_err();
    assert!(matches!(error, CommandError::Persist(_)));
    assert!(app.is_dirty());
    assert_eq!(app.version(), 2);
    assert!(matches!(app.view(), Err(CommandError::PersistPending)));
    let other = app.execute(edit(new_id(), 2, id, "other")).unwrap_err();
    assert!(matches!(other, CommandError::PersistPending));
    assert!(matches!(app.retry(), Err(CommandError::Persist(_))));

    set_write_failure(&path, false);
    assert_eq!(app.retry().expect("retry"), saved(3, false));
    assert!(!app.is_dirty());
    assert!(matches!(app.retry(), Err(CommandError::NothingToRetry)));
    let again = app
        .execute(edit(request, 2, id, "saved, then more"))
        .expect("resend");
    assert_eq!(again, saved(3, true));
    drop(app);

    let reopened = open(&path);
    assert_eq!(reopened.version(), 3);
    assert_eq!(bodies(&reopened), vec![(id, "saved, then more".into())]);
}

#[test]
fn resending_the_failed_request_persists_it_like_retry() {
    let (_dir, path) = temp_db();
    let id = block();
    let mut app = open(&path);
    app.execute(create(new_id(), 0, id)).expect("create");

    set_write_failure(&path, true);
    let request = new_id();
    app.execute(edit(request, 1, id, "draft")).unwrap_err();
    let reused = app.execute(edit(request, 1, id, "changed")).unwrap_err();
    assert!(matches!(reused, CommandError::RequestReused(_)));
    set_write_failure(&path, false);

    assert_eq!(
        app.execute(edit(request, 1, id, "draft")).expect("resend"),
        saved(2, false)
    );
    assert_eq!(bodies(&app), vec![(id, "draft".into())]);
}

#[test]
fn an_unsaved_change_is_lost_on_reopen_and_never_published() {
    let (_dir, path) = temp_db();
    let id = block();
    {
        let mut app = open(&path);
        app.execute(create(new_id(), 0, id)).expect("create");
        app.execute(edit(new_id(), 1, id, "durable")).expect("edit");
        set_write_failure(&path, true);
        app.execute(edit(new_id(), 2, id, "never saved"))
            .unwrap_err();
    }
    set_write_failure(&path, false);
    let reopened = open(&path);
    assert_eq!(reopened.version(), 2);
    assert_eq!(bodies(&reopened), vec![(id, "durable".into())]);
}

#[test]
fn another_store_schema_version_is_refused() {
    let (_dir, path) = temp_db();
    drop(WorkspaceStore::open(&path).expect("create"));
    Connection::open(&path)
        .expect("second connection")
        .execute(
            "UPDATE store_meta SET value = '99' WHERE key = 'schema_version'",
            [],
        )
        .expect("change the schema marker");
    let error = WorkspaceStore::open(&path).err().expect("refused");
    assert!(matches!(
        error,
        WorkspaceError::SchemaMismatch { expected: 1, .. }
    ));
}

#[test]
fn a_database_of_another_application_is_refused() {
    let (_dir, path) = temp_db();
    Connection::open(&path)
        .expect("foreign database")
        .execute_batch("CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT);")
        .expect("foreign table");
    let error = WorkspaceStore::open(&path).err().expect("refused");
    assert!(matches!(error, WorkspaceError::NotWorkspace(_)));
}

#[test]
fn the_database_is_left_in_wal_mode() {
    let (_dir, path) = temp_db();
    let _store = WorkspaceStore::open(&path).expect("open");
    let journal: String = Connection::open(&path)
        .expect("second connection")
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("journal mode");
    assert_eq!(journal, "wal");
}

/// Pins the stored layout to schema v1 of `docs/design/v3-legacy-import-mapping.md` §2/§3,
/// which the Legacy Importer writes too. Reads SQLite and Loro directly.
#[test]
fn the_stored_document_follows_the_shared_schema_v1() {
    use loro::{Container, LoroDoc, LoroValue, TreeParentId, ValueOrContainer};

    let (_dir, path) = temp_db();
    let id = block();
    {
        let mut app = open(&path);
        app.execute(create(new_id(), 0, id)).expect("create");
        app.execute(edit(new_id(), 1, id, "本文")).expect("edit");
    }
    let db = Connection::open(&path).expect("second connection");
    let snapshot: Vec<u8> = db
        .query_row("SELECT bytes FROM snapshot WHERE id = 1", [], |row| {
            row.get(0)
        })
        .expect("snapshot row");
    let doc = LoroDoc::from_snapshot(&snapshot).expect("snapshot");
    let mut query = db
        .prepare("SELECT bytes FROM updates ORDER BY seq")
        .expect("updates");
    for update in query
        .query_map([], |row| row.get::<_, Vec<u8>>(0))
        .expect("update rows")
    {
        doc.import(&update.expect("update")).expect("import");
    }

    let meta = doc.get_map("meta");
    assert_eq!(
        meta.get("schemaVersion")
            .map(|value| value.get_deep_value()),
        Some(LoroValue::I64(1))
    );
    let Some(LoroValue::String(workspace_id)) =
        meta.get("workspaceId").map(|value| value.get_deep_value())
    else {
        panic!("workspaceId is missing");
    };
    assert_eq!(
        workspace_id
            .parse::<Uuid>()
            .expect("UUID")
            .get_version_num(),
        7
    );

    let tree = doc.get_tree("blocks");
    let roots = tree.children(TreeParentId::Root).expect("roots");
    assert_eq!(roots.len(), 1);
    let node = tree.get_meta(roots[0]).expect("node metadata");
    assert_eq!(
        node.get("id").map(|value| value.get_deep_value()),
        Some(LoroValue::String(id.to_string().into()))
    );
    assert_eq!(
        node.get("kind").map(|value| value.get_deep_value()),
        Some(LoroValue::String("block".into()))
    );
    let Some(ValueOrContainer::Container(Container::Text(text))) = node.get("text") else {
        panic!("the body is not a LoroText in the node metadata");
    };
    assert_eq!(text.to_string(), "本文");
}
