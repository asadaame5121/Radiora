use loro::{CommitOptions, LoroDoc, UndoManager};

fn manager(doc: &LoroDoc, other_origin: &str) -> UndoManager {
    let mut undo = UndoManager::new(doc);
    undo.set_merge_interval(0);
    undo.add_exclude_origin_prefix("system:");
    undo.add_exclude_origin_prefix(other_origin);
    undo
}

#[test]
fn tombstone_undo_redo_retains_body_and_logical_id() {
    let doc = LoroDoc::new();
    doc.get_text("block:a").insert(0, "消さずに戻す").unwrap();
    doc.commit();
    let mut undo = manager(&doc, "session:b");

    doc.get_map("trash").insert("block:a", true).unwrap();
    doc.commit_with(CommitOptions::new().origin("session:a"));
    assert!(doc.get_map("trash").get("block:a").is_some());
    assert!(undo.undo().unwrap());
    assert!(doc.get_map("trash").get("block:a").is_none());
    assert_eq!(doc.get_text("block:a").to_string(), "消さずに戻す");
    assert!(undo.redo().unwrap());
    assert!(doc.get_map("trash").get("block:a").is_some());
}

#[test]
fn excluded_purge_origin_does_not_clear_older_histories() {
    let doc = LoroDoc::new();
    let a = manager(&doc, "session:b");
    let mut b = manager(&doc, "session:a");
    doc.get_text("block:a").insert(0, "A").unwrap();
    doc.commit_with(CommitOptions::new().origin("session:a"));
    doc.get_text("block:b").insert(0, "B").unwrap();
    doc.commit_with(CommitOptions::new().origin("session:b"));
    assert_eq!((a.undo_count(), b.undo_count()), (1, 1));

    assert!(b.undo().unwrap());
    assert!(b.can_redo());
    let counts = (a.undo_count(), b.redo_count());
    doc.get_map("purged").insert("block:a", true).unwrap();
    doc.commit_with(CommitOptions::new().origin("system:purge"));
    assert_eq!((a.undo_count(), b.redo_count()), counts);

    a.clear();
    assert!(!a.can_undo() && !a.can_redo());
    assert!(b.can_redo(), "clearing A must not masquerade as clearing B");
    b.clear();
    assert!(!b.can_undo() && !b.can_redo());
}

#[test]
fn uncoordinated_managers_can_capture_each_others_undo() {
    let doc = LoroDoc::new();
    doc.get_text("a").insert(0, "A0").unwrap();
    doc.get_text("b").insert(0, "B0").unwrap();
    doc.commit();
    let mut a = manager(&doc, "session:b");
    let mut b = manager(&doc, "session:a");
    doc.get_text("a").update("A1", Default::default()).unwrap();
    doc.commit_with(CommitOptions::new().origin("session:a"));
    doc.get_text("b").update("B1", Default::default()).unwrap();
    doc.commit_with(CommitOptions::new().origin("session:b"));

    assert!(a.undo().unwrap());
    assert_eq!(doc.get_text("a").to_string(), "A0");
    assert_eq!(doc.get_text("b").to_string(), "B1");
    assert!(b.undo().unwrap());
    // Negative control for this pinned Loro version, NOT desired v3 behavior:
    // B recorded A's undo and now undoes that, resurrecting A1.
    assert_eq!(doc.get_text("a").to_string(), "A1");
    assert_eq!(doc.get_text("b").to_string(), "B1");
}
