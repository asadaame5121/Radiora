use radiora_loro_purge_poc::{Result, Workspace};

fn main() -> Result<()> {
    let fixture = tempfile::tempdir()?;
    let path = fixture.path().join("purge-demo.db");
    let mut workspace = Workspace::open(&path)?;
    workspace.edit(0, "target", "fixture secret")?;
    workspace.trash(0, "target")?;
    workspace.edit(1, "keep", "session 1 edit")?;
    workspace.undo(1)?;
    println!("Before purge: histories={:?}", workspace.histories());

    workspace.inject_write_failure(true)?;
    match workspace.purge("target", true) {
        Err(error) => println!("Expected real SQLite failure: {error}"),
        Ok(()) => return Err("fault injection did not fail".into()),
    }
    println!(
        "After failed persistence: phase={:?}, histories={:?}, undo blocked={}",
        workspace.phase(),
        workspace.histories(),
        workspace.undo(0).is_err()
    );
    println!(
        "Separate connection sees purged={}",
        Workspace::open(&path)?.is_purged("target")?
    );

    workspace.inject_write_failure(false)?;
    workspace.retry()?;
    println!(
        "After retry: phase={:?}, histories={:?}, purged={}",
        workspace.phase(),
        workspace.histories(),
        Workspace::open(&path)?.is_purged("target")?
    );
    workspace.edit(1, "keep", "fresh edit")?;
    workspace.undo(1)?;
    println!("Future edits can still undo: {:?}", workspace.text("keep")?);
    println!("Fixture only; temporary DB is removed on exit.");
    Ok(())
}
