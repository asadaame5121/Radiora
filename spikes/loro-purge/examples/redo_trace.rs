//! Fixture-only diagnostic: no SQLite, Workspace, update(), or UI.
use loro::{CommitOptions, ExportMode, LoroDoc, UndoManager};
use tracing_subscriber::{
    filter::{LevelFilter, Targets},
    fmt::format::FmtSpan,
    layer::SubscriberExt,
    util::SubscriberInitExt,
};

fn manager(doc: &LoroDoc, other: &str, name: &'static str) -> UndoManager {
    let mut manager = UndoManager::new(doc);
    manager.set_merge_interval(0);
    manager.add_exclude_origin_prefix(other);
    manager.set_on_push(Some(Box::new(move |kind, span, _| {
        println!("[loro-repro] {name} push {kind:?} {span:?}");
        Default::default()
    })));
    manager.set_on_pop(Some(Box::new(move |kind, span, _| {
        println!("[loro-repro] {name} pop {kind:?} {span:?}");
    })));
    manager
}

fn observe(doc: &LoroDoc, managers: &[UndoManager; 2], label: &str, stacks: bool) {
    println!(
        "[loro-repro] {label}: text={:?}, counts={:?}",
        doc.get_text("text").to_string(),
        managers
            .each_ref()
            .map(|m| (m.undo_count(), m.redo_count()))
    );
    if stacks {
        println!("[loro-repro] stacks={managers:#?}");
    }
}

fn sync(
    docs: &[LoroDoc; 2],
    managers: &[UndoManager; 2],
    source: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let target = 1 - source;
    let before = (managers[target].undo_count(), managers[target].redo_count());
    let updates = docs[source].export(ExportMode::updates(&docs[target].oplog_vv()))?;
    assert!(docs[target].import(&updates)?.pending.is_none());
    assert_eq!(
        before,
        (managers[target].undo_count(), managers[target].redo_count()),
        "remote import must not create or clear local history"
    );
    assert_eq!(docs[0].oplog_vv(), docs[1].oplog_vv());
    assert_eq!(
        docs[0].get_text("text").to_string(),
        docs[1].get_text("text").to_string(),
        "replicas must converge after every operation"
    );
    Ok(())
}

fn run_peers(
    reverse: bool,
    reverse_redo: bool,
    stacks: bool,
    roundtrip_only: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let docs = [LoroDoc::new(), LoroDoc::new()];
    docs[0].set_peer_id(1)?;
    docs[1].set_peer_id(2)?;
    // Separate peers need neither origin exclusions nor pause/resume.
    let mut managers = docs.each_ref().map(UndoManager::new);
    let _subscriptions = docs.each_ref().map(|doc| {
        let peer = doc.peer_id();
        doc.subscribe_root(std::sync::Arc::new(move |event| {
            println!("[loro-repro] peer={peer} event={event:?}");
        }))
    });
    for (index, text) in ["A", "B"].into_iter().enumerate() {
        managers[index].set_merge_interval(0);
        docs[index].get_text("text").insert(index, text)?;
        docs[index].commit();
        sync(&docs, &managers, index)?;
        observe(&docs[0], &managers, &format!("insert {text}"), stacks);
    }
    assert_eq!(docs[0].get_text("text").to_string(), "AB");
    assert_eq!(
        managers
            .each_ref()
            .map(|m| (m.undo_count(), m.redo_count())),
        [(1, 0), (1, 0)]
    );
    for (redo, order) in [
        (false, if reverse { [1, 0] } else { [0, 1] }),
        (true, if reverse_redo { [1, 0] } else { [0, 1] }),
    ] {
        for index in order {
            if roundtrip_only && index != usize::from(reverse) {
                continue;
            }
            assert!(if redo {
                managers[index].redo()?
            } else {
                managers[index].undo()?
            });
            sync(&docs, &managers, index)?;
            observe(
                &docs[0],
                &managers,
                &format!("{} peer {}", if redo { "redo" } else { "undo" }, index + 1),
                stacks,
            );
        }
        if !redo {
            let expected = if roundtrip_only {
                if reverse {
                    "A"
                } else {
                    "B"
                }
            } else {
                ""
            };
            assert_eq!(docs[0].get_text("text").to_string(), expected);
        }
    }
    assert_eq!(docs[0].get_text("text").to_string(), "AB");
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--trace") {
        tracing_subscriber::registry()
            .with(Targets::new().with_target("loro_internal", LevelFilter::DEBUG))
            .with(
                tracing_subscriber::fmt::layer()
                    .without_time()
                    .with_ansi(false)
                    .with_span_events(FmtSpan::ENTER | FmtSpan::CLOSE),
            )
            .try_init()?;
    }
    let single = args.iter().any(|arg| arg == "--single");
    let reverse = args.iter().any(|arg| arg == "--reverse-undo");
    let reverse_redo = args.iter().any(|arg| arg == "--reverse-redo");
    let stacks = args.iter().any(|arg| arg == "--stacks");
    if args.iter().any(|arg| arg == "--peers") {
        if single {
            return Err("--peers and --single are mutually exclusive".into());
        }
        return run_peers(
            reverse,
            reverse_redo,
            stacks,
            args.iter().any(|arg| arg == "--roundtrip-only"),
        );
    }
    let doc = LoroDoc::new();
    doc.set_peer_id(1)?;
    let mut managers = [
        manager(&doc, "session:b", "A"),
        manager(&doc, "session:a", "B"),
    ];
    let _subscription = doc.subscribe_root(std::sync::Arc::new(|event| {
        println!("[loro-repro] event={event:?}");
    }));
    doc.get_text("text").insert(0, "A")?;
    doc.commit_with(CommitOptions::new().origin("session:a"));
    doc.get_text("text").insert(1, "B")?;
    doc.commit_with(CommitOptions::new().origin(if single { "session:a" } else { "session:b" }));
    observe(&doc, &managers, "insert A; insert B", stacks);

    let undo_order = if single {
        [0, 0]
    } else if reverse {
        [1, 0]
    } else {
        [0, 1]
    };
    let redo_order = if single {
        [0, 0]
    } else if reverse_redo {
        [1, 0]
    } else {
        [0, 1]
    };
    for (redo, order) in [(false, undo_order), (true, redo_order)] {
        for index in order {
            let other = 1 - index;
            managers[other].pause();
            let result = if redo {
                managers[index].redo()
            } else {
                managers[index].undo()
            };
            managers[other].resume();
            assert!(result?);
            observe(
                &doc,
                &managers,
                &format!("{} {}", if redo { "redo" } else { "undo" }, index),
                stacks,
            );
        }
        if !redo {
            assert_eq!(doc.get_text("text").to_string(), "");
        }
    }
    // This remains the desired contract, not an assertion of documented
    // multi-manager support. A failing run is an intentional diagnostic.
    assert_eq!(doc.get_text("text").to_string(), "AB");
    Ok(())
}
