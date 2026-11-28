//! Read-model tests over the synthetic schema-v1 fixture (#403).

use super::fixture::{FixtureBuilder, bodies, representative};
use super::*;
use radiora_core::app::{BlockContent, BlockView, DocumentCommand, Request, TargetView};

fn temp_path() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("temporary directory");
    let path = dir.path().join("workspace.db");
    (dir, path)
}

fn text(block: &BlockView) -> &str {
    block
        .own_body()
        .map(|body| body.text.as_str())
        .expect("owns a body")
}

#[test]
fn the_representative_fixture_reads_as_topics_in_outline_order() {
    let (_dir, path) = temp_path();
    let ids = representative(&path).expect("fixture");
    let store = WorkspaceStore::open(&path).expect("open");
    let view = store.committed_view().expect("view");
    assert_eq!(view.version, 0);

    // The trashed Topic is left out; the other two keep document order.
    assert_eq!(view.topics.len(), 2);
    let first = &view.topics[0];
    let outline: Vec<_> = first
        .blocks
        .iter()
        .map(|block| (block.id, block.parent, block.depth))
        .collect();
    assert_eq!(
        outline,
        vec![
            (ids.first, None, 0),
            (ids.combining, Some(ids.first), 1),
            (ids.crlf, Some(ids.combining), 2),
            (ids.live_reference, Some(ids.first), 1),
            (ids.reference_child, Some(ids.live_reference), 2),
        ],
        "the trashed Block and its child are not in the outline"
    );
    assert_eq!(text(&first.blocks[0]), bodies::FIRST);
    assert_eq!(text(&first.blocks[1]), bodies::COMBINING, "not normalized");
    assert_eq!(text(&first.blocks[2]), bodies::CRLF, "CRLF kept");
    assert_eq!(text(&first.blocks[4]), bodies::REFERENCE_CHILD);

    let BlockContent::Reference {
        target,
        heading,
        resolved: TargetView::Live(shown),
    } = &first.blocks[3].content
    else {
        panic!("a live reference: {:?}", first.blocks[3]);
    };
    assert_eq!(*target, ids.combining);
    assert_eq!(heading.as_deref(), Some(bodies::HEADING));
    assert_eq!(shown.text, bodies::COMBINING);
    assert_eq!(
        Some(&shown.version),
        first.blocks[1].own_body().map(|body| &body.version),
        "a reference shows the representative's body version"
    );

    let second = &view.topics[1];
    assert_eq!(second.root().map(|root| root.id), Some(ids.second));
    let targets: Vec<_> = second.blocks[1..]
        .iter()
        .map(|block| match &block.content {
            BlockContent::Reference {
                target, resolved, ..
            } => (block.id, *target, resolved.clone()),
            other => panic!("a reference item: {other:?}"),
        })
        .collect();
    assert_eq!(
        targets,
        vec![
            (ids.trashed_reference, ids.trashed, TargetView::Trashed),
            (ids.unknown_reference, ids.unknown, TargetView::Missing),
            (ids.purged_reference, ids.purged, TargetView::Missing),
        ]
    );
}

#[test]
fn body_versions_follow_only_their_own_block_and_survive_reopening() {
    let (_dir, path) = temp_path();
    let ids = representative(&path).expect("fixture");
    let version_of = |view: &WorkspaceView, id| {
        view.blocks()
            .find(|block| block.id == id)
            .and_then(|block| block.own_body())
            .map(|body| body.version.clone())
            .expect("a body")
    };
    let mut store = WorkspaceStore::open(&path).expect("open");
    let before = store.committed_view().expect("view");
    let request = Request {
        id: RequestId::new(Uuid::now_v7()),
        base: 0,
        command: DocumentCommand::UpdateBody {
            id: ids.combining,
            body: "edited".into(),
        },
    };
    let change = DocumentChange::SetBody {
        id: ids.combining,
        body: "edited".into(),
    };
    store
        .apply(request.id, &request.fingerprint(), &change)
        .expect("edit");
    let after = store.committed_view().expect("view");
    assert_eq!(after.version, 1, "the publication generation grows");
    assert_ne!(
        version_of(&after, ids.combining),
        version_of(&before, ids.combining)
    );
    assert_eq!(
        version_of(&after, ids.first),
        version_of(&before, ids.first),
        "another Block's version is unchanged"
    );
    drop(store);
    let reopened = WorkspaceStore::open(&path)
        .expect("reopen")
        .committed_view()
        .expect("view");
    assert_eq!(reopened, after);
}

#[test]
fn broken_reference_invariants_are_reported_not_guessed() {
    let cases: [fn(&mut FixtureBuilder); 2] = [
        |b| {
            let root = b.topic("root");
            let shown = b.child(root, "shown");
            let first = b.reference(root, shown, None);
            b.reference(root, first, None);
        },
        |b| {
            let root = b.topic("root");
            let target = b.child(root, "target");
            // A chain stays broken when the referenced reference item is in the trash.
            let chained = b.reference(root, target, None);
            b.trash(chained);
            b.reference(root, chained, None);
        },
    ];
    for build in cases {
        let (_dir, path) = temp_path();
        let mut builder = FixtureBuilder::new();
        build(&mut builder);
        builder.write(&path).expect("fixture");
        let store = WorkspaceStore::open(&path).expect("open");
        assert!(store.committed_view().is_err());
    }
}

#[test]
fn a_fixture_is_never_written_over_an_existing_workspace() {
    let (_dir, path) = temp_path();
    drop(WorkspaceStore::open(&path).expect("create"));
    assert!(FixtureBuilder::new().write(&path).is_err());
}
