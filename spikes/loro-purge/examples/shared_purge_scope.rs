//! Fixture-only observation for: does purging a parent include a child that
//! was already tombstoned before the parent's delete?
//!
//! This prints both the captured deletion group and the physical Loro Tree
//! links. It does not change the fixture's purge behavior.
use radiora_loro_purge_poc::SharedWorkspace;
use std::error::Error;

fn show(workspace: &SharedWorkspace, label: &str) -> Result<(), Box<dyn Error>> {
    println!("\n[{label}]");
    for id in ["A", "B", "C", "D"] {
        let purged = workspace.is_purged(id)?;
        let text = workspace.text(id)?;
        let scope = workspace.trash_scope(id).ok();
        let record_parent = workspace.trash_parent(id).ok().flatten();
        println!(
            "{id}: purged={purged}, text={text:?}, trash_scope={scope:?}, record_parent={record_parent:?}"
        );
    }
    for row in workspace.tree_probe()? {
        println!("tree: {row:?}");
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let dir = tempfile::tempdir()?;
    let mut workspace = SharedWorkspace::open(&dir.path().join("shared-purge-scope.db"))?;

    workspace.delete(0, "C")?;
    workspace.delete(1, "B")?;
    show(&workspace, "after C trash, then B trash")?;

    let confirmation = workspace.trash_scope("B")?;
    println!("\nB deletion group / purge confirmation = {confirmation:?}");
    println!(
        "C tombstone parent before B purge = {:?}",
        workspace.trash_parent("C")?
    );
    let confirmed: Vec<&str> = confirmation.iter().map(String::as_str).collect();
    workspace.purge("B", &confirmed)?;
    show(&workspace, "after purging B with exactly the confirmed set")?;

    println!(
        "\nC restore without confirmation errors = {}",
        workspace.restore(0, "C", false).is_err()
    );
    workspace.restore(1, "C", true)?;
    println!(
        "C after confirmed independent restore = text {:?}, row {:?}",
        workspace.text("C")?,
        workspace
            .render()?
            .into_iter()
            .find(|block| block.id == "C")
    );
    Ok(())
}
