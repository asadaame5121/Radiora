use radiora_loro_purge_poc::{BlockView, Phase, SharedWorkspace};
use std::path::{Path, PathBuf};

type TestResult = Result<(), Box<dyn std::error::Error>>;

struct Fixture {
    _dir: tempfile::TempDir,
    path: PathBuf,
}

fn fixture() -> Result<Fixture, Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("shared-undo.db");
    Ok(Fixture { _dir: dir, path })
}

fn open(path: &Path) -> Result<SharedWorkspace, Box<dyn std::error::Error>> {
    SharedWorkspace::open(path)
}

fn find(ws: &SharedWorkspace, id: &str) -> Result<Option<BlockView>, Box<dyn std::error::Error>> {
    Ok(ws.render()?.into_iter().find(|block| block.id == id))
}

fn child_ids(
    ws: &SharedWorkspace,
    parent: Option<&str>,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut blocks: Vec<_> = ws
        .render()?
        .into_iter()
        .filter(|block| block.parent.as_deref() == parent)
        .collect();
    blocks.sort_by_key(|block| block.index);
    Ok(blocks.into_iter().map(|block| block.id).collect())
}

fn tree_id(ws: &SharedWorkspace, id: &str) -> Result<String, Box<dyn std::error::Error>> {
    find(ws, id)?
        .map(|block| block.tree_id)
        .ok_or_else(|| format!("{id} is not live").into())
}

fn shape(ws: &SharedWorkspace) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    Ok(ws
        .render()?
        .into_iter()
        .map(|block| {
            format!(
                "{}/{}/{}:{}",
                block.id,
                block.parent.as_deref().unwrap_or("-"),
                block.index,
                block.text
            )
        })
        .collect())
}

fn assert_block(
    ws: &SharedWorkspace,
    id: &str,
    parent: Option<&str>,
    index: usize,
    text: &str,
) -> TestResult {
    let block = find(ws, id)?.ok_or_else(|| format!("{id} is not live"))?;
    assert_eq!(block.parent.as_deref(), parent, "{id} parent");
    assert_eq!(block.index, index, "{id} sibling index");
    assert_eq!(block.text, text, "{id} body");
    Ok(())
}

fn assert_absent(ws: &SharedWorkspace, id: &str) -> TestResult {
    assert!(find(ws, id)?.is_none(), "{id} must not be live");
    assert_eq!(ws.text(id)?, None, "{id} body must be hidden");
    Ok(())
}

const INITIAL: [&str; 7] = [
    "A/-/0:alpha",
    "B/A/0:bravo",
    "C/B/0:charlie",
    "D/B/1:delta",
    "E/A/1:echo",
    "X/-/1:xray",
    "Y/X/0:yankee",
];

#[test]
fn multiple_panes_share_one_lifo_history_for_same_and_different_bodies() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;
    assert_eq!(shape(&ws)?, INITIAL);
    assert_eq!(ws.history(), (0, 0));
    let b_tree = tree_id(&ws, "B")?;
    let d_tree = tree_id(&ws, "D")?;

    ws.edit(0, "B", "bravo one")?;
    ws.edit(1, "B", "bravo one two")?;
    ws.edit(0, "D", "delta one")?;
    assert_eq!(ws.history(), (3, 0));
    assert_eq!(ws.text("B")?.as_deref(), Some("bravo one two"));
    assert_eq!(ws.text("D")?.as_deref(), Some("delta one"));
    assert_eq!(tree_id(&ws, "B")?, b_tree, "body edit keeps TreeID");
    assert_eq!(tree_id(&ws, "D")?, d_tree, "body edit keeps TreeID");

    // Undo from a pane other than the one that made the last edit. Pane is
    // request context only; all edits are in this one LIFO order.
    assert!(ws.undo(1)?);
    assert_eq!(ws.text("D")?.as_deref(), Some("delta"));
    assert!(ws.undo(0)?);
    assert_eq!(ws.text("B")?.as_deref(), Some("bravo one"));
    assert!(ws.undo(1)?);
    assert_eq!(ws.text("B")?.as_deref(), Some("bravo"));
    assert!(!ws.undo(0)?, "no older local edit remains");
    assert_eq!(ws.history(), (0, 3));
    assert_eq!(shape(&ws)?, INITIAL);

    assert!(ws.redo(0)?);
    assert_eq!(ws.text("B")?.as_deref(), Some("bravo one"));
    assert!(ws.redo(1)?);
    assert_eq!(ws.text("B")?.as_deref(), Some("bravo one two"));
    assert!(ws.redo(0)?);
    assert_eq!(ws.text("D")?.as_deref(), Some("delta one"));
    assert!(!ws.redo(1)?);
    assert_eq!(ws.history(), (3, 0));
    assert_eq!(tree_id(&ws, "B")?, b_tree);
    assert_eq!(tree_id(&ws, "D")?, d_tree);
    assert_eq!(
        shape(&ws)?,
        [
            "A/-/0:alpha",
            "B/A/0:bravo one two",
            "C/B/0:charlie",
            "D/B/1:delta one",
            "E/A/1:echo",
            "X/-/1:xray",
            "Y/X/0:yankee",
        ]
    );
    Ok(())
}

#[test]
fn tree_move_preserves_logical_ids_and_roundtrips_subtree_and_sibling_order() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;
    let initial = shape(&ws)?;
    let b_tree = tree_id(&ws, "B")?;
    let c_tree = tree_id(&ws, "C")?;
    let d_tree = tree_id(&ws, "D")?;

    // Move the whole B subtree from document A under document X.
    ws.move_under(0, "B", Some("X"), 1)?;
    assert_eq!(child_ids(&ws, None)?, ["A", "X"]);
    assert_eq!(child_ids(&ws, Some("A"))?, ["E"]);
    assert_eq!(child_ids(&ws, Some("X"))?, ["Y", "B"]);
    assert_eq!(child_ids(&ws, Some("B"))?, ["C", "D"]);
    assert_eq!(tree_id(&ws, "B")?, b_tree);
    assert_eq!(tree_id(&ws, "C")?, c_tree);
    assert_eq!(tree_id(&ws, "D")?, d_tree);
    assert_eq!(ws.text("B")?.as_deref(), Some("bravo"));
    assert_eq!(ws.text("C")?.as_deref(), Some("charlie"));

    // Reorder siblings under the moved subtree.
    ws.move_before(1, "D", "C")?;
    assert_eq!(child_ids(&ws, Some("B"))?, ["D", "C"]);
    assert_eq!(ws.history(), (2, 0));
    assert_eq!(tree_id(&ws, "D")?, d_tree);
    assert_eq!(tree_id(&ws, "C")?, c_tree);

    assert!(ws.undo(0)?);
    assert_eq!(child_ids(&ws, Some("B"))?, ["C", "D"]);
    assert!(ws.undo(1)?);
    assert_eq!(shape(&ws)?, initial);
    assert_eq!(tree_id(&ws, "B")?, b_tree);
    assert_eq!(tree_id(&ws, "C")?, c_tree);
    assert_eq!(tree_id(&ws, "D")?, d_tree);
    assert!(!ws.undo(0)?);

    assert!(ws.redo(0)?);
    assert_eq!(child_ids(&ws, Some("X"))?, ["Y", "B"]);
    assert!(ws.redo(1)?);
    assert_eq!(child_ids(&ws, Some("B"))?, ["D", "C"]);
    assert_eq!(ws.history(), (2, 0));
    assert_eq!(tree_id(&ws, "B")?, b_tree);
    assert_eq!(tree_id(&ws, "C")?, c_tree);
    assert_eq!(tree_id(&ws, "D")?, d_tree);

    let moved = shape(&ws)?;
    let reopened = open(&fixture.path)?;
    assert_eq!(shape(&reopened)?, moved, "moves survive SQLite reopen");
    assert_eq!(tree_id(&reopened, "B")?, b_tree);
    assert_eq!(tree_id(&reopened, "C")?, c_tree);
    assert_eq!(tree_id(&reopened, "D")?, d_tree);
    assert_eq!(reopened.history(), (0, 0), "history is not persisted");
    Ok(())
}

#[test]
fn cut_subtree_to_a_new_document_root_preserves_ids_and_order() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;
    let b_tree = tree_id(&ws, "B")?;
    let c_tree = tree_id(&ws, "C")?;
    let d_tree = tree_id(&ws, "D")?;

    // Pull B and its C,D children out of document A to become a document root.
    ws.move_under(0, "B", None, 1)?;
    assert_eq!(child_ids(&ws, None)?, ["A", "B", "X"]);
    assert_eq!(child_ids(&ws, Some("A"))?, ["E"]);
    assert_eq!(child_ids(&ws, Some("B"))?, ["C", "D"]);
    assert_block(&ws, "B", None, 1, "bravo")?;
    assert_block(&ws, "C", Some("B"), 0, "charlie")?;
    assert_block(&ws, "D", Some("B"), 1, "delta")?;
    assert_eq!(tree_id(&ws, "B")?, b_tree);
    assert_eq!(tree_id(&ws, "C")?, c_tree);
    assert_eq!(tree_id(&ws, "D")?, d_tree);

    assert!(ws.undo(1)?);
    assert_eq!(child_ids(&ws, None)?, ["A", "X"]);
    assert_eq!(child_ids(&ws, Some("A"))?, ["B", "E"]);
    assert_eq!(tree_id(&ws, "B")?, b_tree);

    assert!(ws.redo(0)?);
    assert_eq!(child_ids(&ws, None)?, ["A", "B", "X"]);
    assert_block(&ws, "B", None, 1, "bravo")?;
    assert_eq!(child_ids(&ws, Some("B"))?, ["C", "D"]);
    assert_eq!(tree_id(&ws, "B")?, b_tree);
    Ok(())
}

#[test]
fn delete_tombstones_the_subtree_and_parent_undo_does_not_revive_deleted_child() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;
    let c_tree = tree_id(&ws, "C")?;

    ws.delete(0, "C")?;
    assert_absent(&ws, "C")?;
    assert_eq!(ws.trash_scope("C")?, ["C"]);
    assert_eq!(child_ids(&ws, Some("B"))?, ["D"]);

    assert!(ws.undo(1)?);
    assert_block(&ws, "C", Some("B"), 0, "charlie")?;
    assert_eq!(
        ws.trash_scope("C").unwrap_err().to_string(),
        "C is not in the trash"
    );
    assert_ne!(
        tree_id(&ws, "C")?,
        c_tree,
        "Loro re-creates TreeIDs when a delete is undone"
    );
    assert_eq!(child_ids(&ws, Some("B"))?, ["C", "D"]);

    assert!(ws.redo(0)?);
    assert_absent(&ws, "C")?;
    assert_eq!(ws.trash_scope("C")?, ["C"]);

    // The second delete captures only B and its still-live child D.
    ws.delete(1, "B")?;
    assert_eq!(ws.trash_scope("B")?, ["B", "D"]);
    assert_eq!(ws.trash_scope("C")?, ["C"]);
    assert_eq!(child_ids(&ws, Some("A"))?, ["E"]);

    assert!(ws.undo(0)?);
    assert_block(&ws, "B", Some("A"), 0, "bravo")?;
    assert_block(&ws, "D", Some("B"), 0, "delta")?;
    assert_eq!(child_ids(&ws, Some("A"))?, ["B", "E"]);
    assert_absent(&ws, "C")?;
    assert_eq!(
        ws.trash_scope("C")?,
        ["C"],
        "undoing B's delete must not restore C's separate delete"
    );
    assert!(ws.trash_scope("B").is_err(), "B's tombstone was undone");

    assert!(ws.redo(1)?);
    assert_eq!(child_ids(&ws, Some("A"))?, ["E"]);
    assert_absent(&ws, "B")?;
    assert_eq!(ws.trash_scope("B")?, ["B", "D"]);
    assert_eq!(ws.trash_scope("C")?, ["C"]);

    assert!(ws.undo(0)?);
    assert_block(&ws, "B", Some("A"), 0, "bravo")?;
    assert_absent(&ws, "C")?;
    Ok(())
}

#[test]
fn trash_restore_is_a_new_operation_and_keeps_already_deleted_child_deleted() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;
    let b_tree = tree_id(&ws, "B")?;

    ws.delete(0, "C")?;
    ws.delete(1, "B")?;
    assert_eq!(child_ids(&ws, Some("A"))?, ["E"]);
    assert_absent(&ws, "B")?;
    assert_absent(&ws, "C")?;
    assert_eq!(ws.trash_scope("B")?, ["B", "D"]);
    assert_eq!(ws.trash_scope("C")?, ["C"]);

    let before_restore = ws.history();
    ws.restore(0, "B", false)?;
    assert_eq!(ws.history().0, before_restore.0 + 1);
    assert_eq!(ws.history().1, 0);
    assert_block(&ws, "B", Some("A"), 0, "bravo")?;
    assert_block(&ws, "D", Some("B"), 0, "delta")?;
    assert_eq!(child_ids(&ws, Some("A"))?, ["B", "E"], "anchor E is live");
    assert_eq!(child_ids(&ws, Some("B"))?, ["D"]);
    assert_absent(&ws, "C")?;
    assert_eq!(ws.trash_scope("C")?, ["C"]);
    assert!(ws.trash_scope("B").is_err());
    assert_ne!(
        tree_id(&ws, "B")?,
        b_tree,
        "trash restore creates a new TreeID"
    );

    // Trash restore is a new item; Undo reverses the restore, not the earlier
    // delete history, and C remains tombstoned throughout.
    assert!(ws.undo(1)?);
    assert_eq!(child_ids(&ws, Some("A"))?, ["E"]);
    assert_absent(&ws, "B")?;
    assert_absent(&ws, "C")?;
    assert_eq!(ws.trash_scope("B")?, ["B", "D"]);
    assert_eq!(ws.trash_scope("C")?, ["C"]);

    assert!(ws.redo(0)?);
    assert_block(&ws, "B", Some("A"), 0, "bravo")?;
    assert_block(&ws, "D", Some("B"), 0, "delta")?;
    assert_absent(&ws, "C")?;
    assert_eq!(ws.trash_scope("C")?, ["C"]);
    Ok(())
}

#[test]
fn tombstone_survives_reopen_and_restores_logical_ids_and_bodies() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;
    let b_tree = tree_id(&ws, "B")?;
    ws.delete(0, "C")?;
    ws.delete(1, "B")?;
    assert_eq!(ws.trash_scope("B")?, ["B", "D"]);
    assert_eq!(ws.trash_scope("C")?, ["C"]);
    drop(ws);

    let mut reopened = open(&fixture.path)?;
    assert_eq!(reopened.history(), (0, 0));
    assert_absent(&reopened, "B")?;
    assert_absent(&reopened, "C")?;
    assert_eq!(reopened.trash_scope("B")?, ["B", "D"]);
    assert_eq!(reopened.trash_scope("C")?, ["C"]);

    reopened.restore(0, "B", false)?;
    assert_block(&reopened, "B", Some("A"), 0, "bravo")?;
    assert_block(&reopened, "D", Some("B"), 0, "delta")?;
    assert_eq!(child_ids(&reopened, Some("A"))?, ["B", "E"]);
    assert_eq!(child_ids(&reopened, Some("B"))?, ["D"]);
    assert_absent(&reopened, "C")?;
    assert_eq!(reopened.trash_scope("C")?, ["C"]);
    assert_ne!(tree_id(&reopened, "B")?, b_tree);
    assert_eq!(reopened.history(), (1, 0));

    assert!(reopened.undo(1)?);
    assert_absent(&reopened, "B")?;
    assert_eq!(reopened.trash_scope("B")?, ["B", "D"]);
    assert!(reopened.redo(0)?);
    assert_block(&reopened, "B", Some("A"), 0, "bravo")?;
    assert_eq!(child_ids(&reopened, Some("B"))?, ["D"]);
    Ok(())
}

#[test]
fn restore_uses_original_parent_else_end_and_ignores_missing_anchor() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;

    ws.delete(0, "B")?;
    ws.delete(1, "E")?;
    ws.purge("E", &["E"])?;
    assert_eq!(ws.history(), (0, 0));
    assert_eq!(child_ids(&ws, Some("A"))?, Vec::<String>::new());
    assert_eq!(ws.trash_scope("B")?, ["B", "C", "D"]);
    assert!(ws.is_purged("E")?);

    // The original parent A is live, but the next-sibling marker E is purged,
    // so B is appended to A rather than reviving E or guessing a position.
    ws.restore(0, "B", false)?;
    assert_eq!(child_ids(&ws, Some("A"))?, ["B"]);
    assert_eq!(child_ids(&ws, Some("B"))?, ["C", "D"]);
    assert_block(&ws, "B", Some("A"), 0, "bravo")?;
    assert_block(&ws, "C", Some("B"), 0, "charlie")?;
    assert_block(&ws, "D", Some("B"), 1, "delta")?;
    assert!(ws.is_purged("E")?);

    assert!(ws.undo(1)?);
    assert_eq!(child_ids(&ws, Some("A"))?, Vec::<String>::new());
    assert_eq!(ws.trash_scope("B")?, ["B", "C", "D"]);
    assert!(ws.redo(0)?);
    assert_eq!(child_ids(&ws, Some("A"))?, ["B"]);
    assert_block(&ws, "C", Some("B"), 0, "charlie")?;
    Ok(())
}

#[test]
fn restore_requires_confirmation_when_the_original_parent_is_unavailable() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;

    ws.delete(0, "B")?;
    ws.delete(1, "A")?;
    assert_eq!(ws.trash_scope("A")?, ["A", "E"]);
    assert_eq!(ws.trash_scope("B")?, ["B", "C", "D"]);
    assert_absent(&ws, "A")?;
    assert_absent(&ws, "B")?;
    let before_rejection = ws.history();
    assert!(ws.restore(0, "B", false).is_err());
    assert_eq!(ws.history(), before_rejection, "rejection changes nothing");
    assert_absent(&ws, "B")?;
    assert_absent(&ws, "A")?;

    // First case: parent A is in the trash (deleted, not purged).
    ws.restore(1, "B", true)?;
    assert_eq!(child_ids(&ws, None)?, ["X", "B"]);
    assert_block(&ws, "B", None, 1, "bravo")?;
    assert_eq!(child_ids(&ws, Some("B"))?, ["C", "D"]);
    assert_absent(&ws, "A")?;
    assert_eq!(ws.trash_scope("A")?, ["A", "E"]);

    assert!(ws.undo(0)?);
    assert_eq!(child_ids(&ws, None)?, ["X"]);
    assert_absent(&ws, "A")?;
    assert_absent(&ws, "B")?;
    assert_eq!(ws.trash_scope("B")?, ["B", "C", "D"]);

    // Second case: parent A is purged. The history clear is intentional.
    ws.purge("A", &["A", "E"])?;
    assert_eq!(ws.history(), (0, 0));
    assert!(ws.is_purged("A")?);
    assert!(ws.is_purged("E")?);
    assert!(!ws.is_purged("B")?);
    assert_eq!(ws.trash_scope("B")?, ["B", "C", "D"]);
    assert!(ws.restore(0, "B", false).is_err());
    assert_eq!(ws.history(), (0, 0));

    ws.restore(1, "B", true)?;
    assert_eq!(child_ids(&ws, None)?, ["X", "B"]);
    assert_block(&ws, "B", None, 1, "bravo")?;
    assert_block(&ws, "C", Some("B"), 0, "charlie")?;
    assert_block(&ws, "D", Some("B"), 1, "delta")?;
    assert_eq!(ws.history(), (1, 0));

    assert!(ws.undo(1)?);
    assert_absent(&ws, "B")?;
    assert_eq!(ws.trash_scope("B")?, ["B", "C", "D"]);
    assert!(ws.redo(0)?);
    assert_block(&ws, "B", None, 1, "bravo")?;
    assert_block(&ws, "C", Some("B"), 0, "charlie")?;
    Ok(())
}

#[test]
fn document_root_delete_and_restore_roundtrips_root_and_subtree() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;
    let a_tree = tree_id(&ws, "A")?;

    ws.delete(0, "A")?;
    assert_eq!(ws.trash_scope("A")?, ["A", "B", "C", "D", "E"]);
    assert_eq!(child_ids(&ws, None)?, ["X"]);
    assert_absent(&ws, "A")?;
    assert_absent(&ws, "B")?;
    assert_absent(&ws, "C")?;
    assert_absent(&ws, "E")?;

    assert!(ws.undo(1)?);
    assert_eq!(child_ids(&ws, None)?, ["A", "X"], "original root position");
    assert_block(&ws, "A", None, 0, "alpha")?;
    assert_block(&ws, "B", Some("A"), 0, "bravo")?;
    assert_block(&ws, "C", Some("B"), 0, "charlie")?;
    assert_block(&ws, "D", Some("B"), 1, "delta")?;
    assert_block(&ws, "E", Some("A"), 1, "echo")?;
    assert_ne!(
        tree_id(&ws, "A")?,
        a_tree,
        "delete undo recreates the document subtree with new TreeIDs"
    );

    assert!(ws.redo(0)?);
    assert_eq!(child_ids(&ws, None)?, ["X"]);
    assert_absent(&ws, "A")?;
    let before_restore = ws.history();
    ws.restore(1, "A", false)?;
    assert_eq!(ws.history().0, before_restore.0 + 1);
    assert_eq!(child_ids(&ws, None)?, ["A", "X"], "anchor X is live");
    assert_block(&ws, "A", None, 0, "alpha")?;
    assert_block(&ws, "B", Some("A"), 0, "bravo")?;
    assert_block(&ws, "C", Some("B"), 0, "charlie")?;
    assert_block(&ws, "D", Some("B"), 1, "delta")?;
    assert_block(&ws, "E", Some("A"), 1, "echo")?;

    assert!(ws.undo(0)?);
    assert_eq!(child_ids(&ws, None)?, ["X"]);
    assert_eq!(ws.trash_scope("A")?, ["A", "B", "C", "D", "E"]);
    assert!(ws.redo(1)?);
    assert_eq!(child_ids(&ws, None)?, ["A", "X"]);
    assert_block(&ws, "B", Some("A"), 0, "bravo")?;
    Ok(())
}

#[test]
fn split_is_one_history_item_and_roundtrips_ids_order_and_bodies() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;
    let b_tree = tree_id(&ws, "B")?;

    ws.split(0, "B", 2, "B2")?;
    assert_eq!(ws.history(), (1, 0), "the composite split is one item");
    assert_eq!(child_ids(&ws, Some("A"))?, ["B", "B2", "E"]);
    assert_eq!(child_ids(&ws, Some("B"))?, ["C", "D"]);
    assert_block(&ws, "B", Some("A"), 0, "br")?;
    assert_block(&ws, "B2", Some("A"), 1, "avo")?;
    assert_eq!(tree_id(&ws, "B")?, b_tree, "split keeps the source TreeID");
    let split_tree = tree_id(&ws, "B2")?;

    assert!(ws.undo(1)?);
    assert_eq!(ws.history(), (0, 1));
    assert_eq!(child_ids(&ws, Some("A"))?, ["B", "E"]);
    assert_block(&ws, "B", Some("A"), 0, "bravo")?;
    assert_absent(&ws, "B2")?;
    assert_eq!(child_ids(&ws, Some("B"))?, ["C", "D"]);

    assert!(ws.redo(0)?);
    assert_eq!(ws.history(), (1, 0));
    assert_eq!(child_ids(&ws, Some("A"))?, ["B", "B2", "E"]);
    assert_block(&ws, "B", Some("A"), 0, "br")?;
    assert_block(&ws, "B2", Some("A"), 1, "avo")?;
    assert_eq!(child_ids(&ws, Some("B"))?, ["C", "D"]);
    assert_ne!(
        tree_id(&ws, "B2")?,
        split_tree,
        "Loro re-creates the TreeID when a create is redone; logical ID/order/body roundtrip"
    );
    assert_eq!(
        tree_id(&ws, "B")?,
        b_tree,
        "the source TreeID is not replaced"
    );
    Ok(())
}

#[test]
fn sqlite_failure_keeps_dirty_and_retry_persists_without_duplicate_history() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;
    ws.edit(0, "B", "bravo one")?;
    ws.edit(1, "D", "delta one")?;
    assert_eq!(ws.history(), (2, 0));
    let b_tree = tree_id(&ws, "B")?;

    ws.inject_write_failure(true)?;
    let error = ws.edit(0, "B", "pending").unwrap_err();
    assert!(error.to_string().contains("injected"));
    assert_eq!(ws.phase(), Phase::Dirty);
    assert_eq!(
        ws.history(),
        (3, 0),
        "the failed edit is one in-memory item"
    );
    assert!(ws.text("B").is_err());
    assert!(ws.render().is_err());
    assert!(ws.edit(1, "D", "blocked").is_err());
    assert!(ws.move_before(0, "D", "C").is_err());
    assert!(ws.delete(0, "C").is_err());
    assert!(ws.restore(0, "C", false).is_err());
    assert!(ws.split(0, "B", 2, "B2").is_err());
    assert!(ws.purge("C", &["C"]).is_err());
    assert!(ws.undo(0).is_err());
    assert!(ws.redo(1).is_err());
    assert!(ws.retry().is_err(), "persistence is still failing");
    assert_eq!(ws.phase(), Phase::Dirty);
    assert_eq!(ws.history(), (3, 0));

    let persisted = open(&fixture.path)?;
    assert_eq!(persisted.text("B")?.as_deref(), Some("bravo one"));
    assert_eq!(persisted.text("D")?.as_deref(), Some("delta one"));
    assert_eq!(persisted.history(), (0, 0));

    ws.inject_write_failure(false)?;
    ws.retry()?;
    assert_eq!(ws.phase(), Phase::Ready);
    assert_eq!(ws.history(), (3, 0), "retry saves only; no extra item");
    assert_eq!(ws.text("B")?.as_deref(), Some("pending"));
    assert_eq!(tree_id(&ws, "B")?, b_tree);

    assert!(ws.undo(1)?);
    assert_eq!(ws.text("B")?.as_deref(), Some("bravo one"));
    assert_eq!(ws.history(), (2, 1));
    assert!(ws.redo(0)?);
    assert_eq!(ws.text("B")?.as_deref(), Some("pending"));
    assert_eq!(ws.history(), (3, 0));
    Ok(())
}

#[test]
fn purge_scope_excludes_a_child_deleted_before_its_parent() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;

    ws.delete(0, "C")?;
    ws.delete(1, "B")?;
    assert_eq!(ws.trash_scope("B")?, ["B", "D"]);
    assert_eq!(ws.trash_scope("C")?, ["C"]);
    assert_eq!(ws.trash_parent("B")?, Some("A".to_string()));
    assert_eq!(ws.trash_parent("C")?, Some("B".to_string()));
    assert!(!ws.is_purged("C")?);

    // Adopted rule: separately deleted trash items remain independent.
    // C was already tombstoned, so B's captured purge group is [B,D].
    // The Loro Tree probe shows C at the deleted root, not physically under B,
    // while D is still physically under B's deleted node.
    let before_purge = ws.tree_probe()?;
    let b_row = before_purge
        .iter()
        .find(|row| row.block_id == "B" && row.deleted)
        .ok_or("B deleted row")?;
    let c_row = before_purge
        .iter()
        .find(|row| row.block_id == "C" && row.deleted)
        .ok_or("C deleted row")?;
    let d_row = before_purge
        .iter()
        .find(|row| row.block_id == "D" && row.deleted)
        .ok_or("D deleted row")?;
    assert!(b_row.parent_is_deleted_root);
    assert!(c_row.parent_is_deleted_root);
    assert!(c_row.parent_block_id.is_none());
    assert_eq!(d_row.parent_block_id.as_deref(), Some("B"));
    assert!(!d_row.parent_is_deleted_root);

    // B's confirmed scope is only the visible subtree [B,D]. C was already
    // tombstoned separately and is not swept into this purge.
    ws.purge("B", &["D", "B"])?;
    assert_eq!(ws.history(), (0, 0));
    assert!(ws.is_purged("B")?);
    assert!(ws.is_purged("D")?);
    assert!(!ws.is_purged("C")?);
    assert!(!ws.is_purged("A")?);
    assert_eq!(ws.trash_scope("C")?, ["C"]);
    assert_eq!(ws.trash_parent("C")?, Some("B".to_string()));
    assert_absent(&ws, "C")?;
    assert_absent(&ws, "B")?;

    // purge removes the confirmed bodies/marks, not the Loro Tree nodes. B/D
    // remain as deleted physical nodes; C remains a separate deleted subtree.
    let after_purge = ws.tree_probe()?;
    let c_row = after_purge
        .iter()
        .find(|row| row.block_id == "C" && row.deleted)
        .ok_or("C deleted row after purge")?;
    assert!(c_row.parent_is_deleted_root);
    assert!(after_purge
        .iter()
        .any(|row| row.block_id == "B" && row.deleted));
    assert!(after_purge.iter().any(|row| row.block_id == "D"
        && row.deleted
        && row.parent_block_id.as_deref() == Some("B")));

    // C's original parent B is purged, so restoring C requires the explicit
    // independent-document confirmation. C keeps its logical ID and body.
    assert!(ws.restore(0, "C", false).is_err());
    assert_eq!(ws.history(), (0, 0));
    ws.restore(1, "C", true)?;
    assert_eq!(child_ids(&ws, None)?, ["A", "X", "C"]);
    assert_block(&ws, "C", None, 2, "charlie")?;
    assert!(ws.trash_scope("C").is_err(), "C is no longer in the trash");
    assert_eq!(ws.history(), (1, 0));

    assert!(ws.undo(0)?);
    assert_absent(&ws, "C")?;
    assert_eq!(ws.trash_scope("C")?, ["C"]);
    assert!(ws.redo(1)?);
    assert_block(&ws, "C", None, 2, "charlie")?;
    Ok(())
}

#[test]
fn purge_requires_trash_and_confirmation_and_clears_both_stacks_only_after_save() -> TestResult {
    let fixture = fixture()?;
    let mut ws = open(&fixture.path)?;
    ws.edit(0, "B", "bravo edit")?;
    ws.delete(1, "B")?;
    ws.edit(0, "E", "echo edit")?;
    assert!(ws.undo(1)?);
    assert_eq!(ws.history(), (2, 1));
    assert_eq!(ws.text("E")?.as_deref(), Some("echo"));
    assert_eq!(ws.trash_scope("B")?, ["B", "C", "D"]);

    assert!(ws.purge("A", &["A"]).is_err(), "A is not in the trash");
    assert!(ws.purge("B", &[]).is_err(), "confirmation is required");
    assert!(ws.purge("B", &["B"]).is_err(), "partial scope is rejected");
    assert!(ws.purge("B", &["B", "C", "D", "E"]).is_err());
    assert!(
        ws.purge("B", &["B", "C", "C"]).is_err(),
        "duplicates are rejected"
    );
    assert_eq!(ws.history(), (2, 1));
    assert_eq!(ws.trash_scope("B")?, ["B", "C", "D"]);

    ws.inject_write_failure(true)?;
    let confirmation = ["D", "B", "C"];
    let error = ws.purge("B", &confirmation).unwrap_err();
    assert!(error.to_string().contains("injected"));
    assert_eq!(ws.phase(), Phase::Dirty);
    assert_eq!(ws.history(), (2, 1), "old history is not cleared early");
    assert!(ws.undo(0).is_err());
    assert!(ws.redo(1).is_err());
    assert!(ws.purge("B", &confirmation).is_err());
    assert!(ws.retry().is_err());
    assert_eq!(ws.history(), (2, 1));

    let persisted = open(&fixture.path)?;
    assert!(!persisted.is_purged("B")?);
    assert_eq!(persisted.trash_scope("B")?, ["B", "C", "D"]);
    assert_eq!(persisted.text("E")?.as_deref(), Some("echo"));

    ws.inject_write_failure(false)?;
    ws.retry()?;
    assert_eq!(ws.phase(), Phase::Ready);
    assert_eq!(ws.history(), (0, 0));
    assert!(ws.is_purged("B")?);
    assert!(ws.is_purged("C")?);
    assert!(ws.is_purged("D")?);
    assert!(!ws.is_purged("A")?);
    assert!(!ws.is_purged("X")?);
    assert_eq!(ws.text("B")?, None);
    assert!(ws.trash_scope("B").is_err());
    assert!(!ws.undo(0)?);
    assert!(!ws.redo(1)?);
    assert!(ws.purge("B", &["B"]).is_err());

    // New edits after the reset are immediately undoable, before reopen too.
    ws.edit(1, "E", "post purge")?;
    assert_eq!(ws.history(), (1, 0));
    assert!(ws.undo(0)?);
    assert_eq!(ws.text("E")?.as_deref(), Some("echo"));
    assert!(ws.redo(1)?);
    assert_eq!(ws.text("E")?.as_deref(), Some("post purge"));
    assert!(ws.undo(0)?, "leave E at echo for the reopen check");
    assert_eq!(ws.history(), (0, 1));

    let mut reopened = open(&fixture.path)?;
    assert!(reopened.is_purged("B")?);
    assert!(reopened.is_purged("C")?);
    assert!(reopened.is_purged("D")?);
    assert!(!reopened.is_purged("E")?);
    assert_eq!(reopened.history(), (0, 0));
    assert_eq!(reopened.text("E")?.as_deref(), Some("echo"));
    assert_eq!(child_ids(&reopened, Some("A"))?, ["E"]);
    assert_eq!(child_ids(&reopened, Some("X"))?, ["Y"]);

    reopened.edit(1, "E", "after purge")?;
    assert!(reopened.undo(0)?);
    assert_eq!(reopened.text("E")?.as_deref(), Some("echo"));
    assert!(reopened.redo(1)?);
    assert_eq!(reopened.text("E")?.as_deref(), Some("after purge"));
    Ok(())
}
