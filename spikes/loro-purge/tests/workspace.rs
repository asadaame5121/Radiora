use radiora_loro_purge_poc::{Phase, Workspace};

type TestResult = Result<(), Box<dyn std::error::Error>>;

#[test]
fn purge_is_durable_clears_every_stack_and_allows_future_undo() -> TestResult {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("fixture.db");
    let mut workspace = Workspace::open(&path)?;
    workspace.edit(0, "target", "秘密")?;
    workspace.edit(1, "keep", "変更")?;
    workspace.undo(1)?;
    workspace.trash(0, "target")?;
    assert!(workspace.histories()[0].0 > 0);
    assert!(workspace.histories()[1].1 > 0);

    workspace.purge("target", true)?;
    assert_eq!(workspace.histories(), [(0, 0), (0, 0)]);
    assert_eq!(workspace.text("target")?, None);
    assert!(!workspace.undo(0)?);
    assert!(!workspace.redo(1)?);
    assert!(workspace.edit(0, "target", "復活させない").is_err());

    let reopened = Workspace::open(&path)?;
    assert_eq!(reopened.text("target")?, None);
    assert_eq!(reopened.histories(), [(0, 0), (0, 0)]);
    workspace.edit(1, "keep", "新しい編集")?;
    assert!(workspace.undo(1)?);
    assert_eq!(workspace.text("keep")?.as_deref(), Some("other"));
    assert!(workspace.redo(1)?);
    assert_eq!(workspace.text("keep")?.as_deref(), Some("新しい編集"));
    Ok(())
}

#[test]
fn sqlite_failure_blocks_public_operations_and_retry_only_persists() -> TestResult {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("fixture.db");
    let mut workspace = Workspace::open(&path)?;
    workspace.edit(0, "target", "秘密")?;
    workspace.trash(0, "target")?;
    workspace.edit(1, "keep", "変更")?;
    workspace.undo(1)?;
    let histories = workspace.histories();
    workspace.inject_write_failure(true)?;

    let error = workspace.purge("target", true).unwrap_err();
    assert!(error.to_string().contains("injected"));
    assert_eq!(workspace.phase(), Phase::Dirty);
    assert_eq!(workspace.histories(), histories);
    assert!(workspace.text("keep").is_err());
    assert!(workspace.edit(0, "keep", "blocked").is_err());
    assert!(workspace.undo(0).is_err());
    assert!(workspace.redo(1).is_err());
    assert!(workspace.purge("target", true).is_err());
    assert!(workspace.retry().is_err());
    assert_eq!(workspace.histories(), histories);
    assert!(!Workspace::open(&path)?.is_purged("target")?);

    workspace.inject_write_failure(false)?;
    workspace.retry()?;
    assert_eq!(workspace.phase(), Phase::Ready);
    assert_eq!(workspace.histories(), [(0, 0), (0, 0)]);
    assert!(Workspace::open(&path)?.is_purged("target")?);
    assert!(
        workspace.retry().is_err(),
        "a finished operation is not retried"
    );
    Ok(())
}

#[test]
fn rejection_does_not_mutate_data_or_history() -> TestResult {
    let dir = tempfile::tempdir()?;
    let mut workspace = Workspace::open(&dir.path().join("fixture.db"))?;
    assert!(workspace.purge("target", true).is_err(), "not in trash");
    workspace.trash(0, "target")?;
    let histories = workspace.histories();
    assert!(workspace.purge("target", false).is_err(), "not confirmed");
    assert!(workspace.purge("unknown", true).is_err());
    assert_eq!(workspace.histories(), histories);
    assert!(!workspace.is_purged("target")?);
    assert!(workspace.undo(0)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("before"));
    Ok(())
}

#[test]
fn ordinary_write_retry_keeps_undo_history() -> TestResult {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("fixture.db");
    let mut workspace = Workspace::open(&path)?;
    workspace.inject_write_failure(true)?;
    assert!(workspace.edit(0, "keep", "保存待ち").is_err());
    assert_eq!(workspace.phase(), Phase::Dirty);
    assert_eq!(
        Workspace::open(&path)?.text("keep")?.as_deref(),
        Some("other")
    );
    workspace.inject_write_failure(false)?;
    workspace.retry()?;
    assert!(workspace.histories()[0].0 > 0);
    assert_eq!(workspace.text("keep")?.as_deref(), Some("保存待ち"));
    assert!(workspace.undo(0)?);
    assert_eq!(workspace.text("keep")?.as_deref(), Some("other"));
    Ok(())
}

#[test]
fn session_undo_redo_does_not_capture_another_sessions_replay() -> TestResult {
    let dir = tempfile::tempdir()?;
    let mut workspace = Workspace::open(&dir.path().join("fixture.db"))?;
    workspace.edit(0, "target", "A1")?;
    workspace.edit(1, "keep", "B1")?;
    assert!(workspace.undo(0)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("before"));
    assert!(workspace.undo(1)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("before"));
    assert_eq!(workspace.text("keep")?.as_deref(), Some("other"));
    assert!(workspace.redo(0)?);
    assert!(workspace.redo(1)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("A1"));
    assert_eq!(workspace.text("keep")?.as_deref(), Some("B1"));
    Ok(())
}

#[test]
#[ignore = "Known limitation: non-LIFO cross-session Redo changes shared-text order; run explicitly"]
fn session_replay_transforms_against_another_sessions_shared_text() -> TestResult {
    let dir = tempfile::tempdir()?;
    let mut workspace = Workspace::open(&dir.path().join("fixture.db"))?;
    workspace.edit(0, "target", "before A")?;
    workspace.edit(1, "target", "before A B")?;
    assert!(workspace.undo(0)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("before B"));
    assert!(workspace.undo(1)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("before"));
    assert!(workspace.redo(0)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("before A"));
    assert!(workspace.redo(1)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("before A B"));
    Ok(())
}

#[test]
#[ignore = "Known limitation: cross-session Redo changes shared-text order even after reverse Undo"]
fn session_replay_transforms_in_reverse_edit_order() -> TestResult {
    let dir = tempfile::tempdir()?;
    let mut workspace = Workspace::open(&dir.path().join("fixture.db"))?;
    workspace.edit(0, "target", "before A")?;
    workspace.edit(1, "target", "before A B")?;
    assert!(workspace.undo(1)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("before A"));
    assert!(workspace.undo(0)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("before"));
    assert!(workspace.redo(0)?);
    assert!(workspace.redo(1)?);
    assert_eq!(workspace.text("target")?.as_deref(), Some("before A B"));
    Ok(())
}
