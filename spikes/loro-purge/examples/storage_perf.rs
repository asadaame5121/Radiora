//! Fixture-only synchronous single-writer benchmark. No IPC or UI is measured.
use loro::{ExportMode, LoroDoc, TreeParentId};
use radiora_loro_purge_poc::Result;
use rusqlite::{params, Connection};
use std::{fs, io::Write, path::Path, time::Instant};

const SEED: u64 = 383;
fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn body() -> String {
    let mut text = format!("A{}", "日本語mixed🙂e\u{301}\r\n".repeat(80));
    while text.len() > 1024 {
        text.pop();
    }
    text
}

fn fixture(n: usize) -> Result<LoroDoc> {
    let doc = LoroDoc::new();
    doc.set_peer_id(SEED)?;
    let text = body();
    let refs = doc.get_map("references");
    let order = doc.get_list("order");
    let parents = doc.get_map("parents");
    for i in 0..n {
        order.push(format!("b{i}"))?;
        if i > 0 {
            parents.insert(&format!("b{i}"), format!("b{}", (i - 1) / 10))?;
        }
        if i % 5 == 4 {
            refs.insert(&format!("b{i}"), format!("b{}", i - 1))?;
        } else {
            doc.get_text(format!("b{i}")).insert(0, &text)?;
        }
    }
    let links = doc.get_map("relations");
    let mut random = SEED;
    for i in 0..20_000 {
        random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
        let a = random as usize % n;
        random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
        let b = random as usize % n;
        links.insert(&format!("r{i}"), format!("b{a}->b{b}"))?;
    }
    doc.commit();
    assert_eq!(order.len(), n);
    assert_eq!(refs.len(), n / 5);
    assert_eq!(links.len(), 20_000);
    Ok(doc)
}

fn restore(path: &Path) -> Result<LoroDoc> {
    let db = Connection::open(path)?;
    let bytes: Vec<u8> = db.query_row("SELECT bytes FROM snapshot", [], |r| r.get(0))?;
    let doc = LoroDoc::from_snapshot(&bytes)?;
    let mut query = db.prepare("SELECT bytes FROM updates ORDER BY seq")?;
    for row in query.query_map([], |r| r.get::<_, Vec<u8>>(0))? {
        assert!(doc.import(&row?)?.pending.is_none());
    }
    Ok(doc)
}

fn summary(out: &mut fs::File, n: usize, mode: &str, name: &str, values: &[f64]) -> Result<()> {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let p = |q: f64| sorted[((sorted.len() as f64 * q).ceil() as usize).saturating_sub(1)];
    writeln!(
        out,
        "{n},{mode},{name},{},{:.6},{:.6},{:.6},{:.6}",
        sorted.len(),
        p(0.50),
        p(0.95),
        p(0.99),
        p(1.0)
    )?;
    Ok(())
}

fn restore_samples(
    out: &mut fs::File,
    path: &Path,
    expected: &LoroDoc,
    n: usize,
    mode: &str,
    count: usize,
) -> Result<()> {
    let mut times = Vec::new();
    for _ in 0..5 {
        let start = Instant::now();
        let restored = restore(path)?;
        times.push(ms(start));
        assert_eq!(restored.oplog_vv(), expected.oplog_vv());
        assert_eq!(
            restored.get_text("b0").to_string(),
            expected.get_text("b0").to_string()
        );
        assert_eq!(restored.get_map("references").len(), n / 5);
    }
    summary(out, n, mode, &format!("restore_{count}_updates"), &times)
}

fn bench(dir: &Path, n: usize, count: usize, mode: &str, out: &mut fs::File) -> Result<()> {
    let path = dir.join(format!("{n}-{mode}.db"));
    if path.exists() {
        return Err("refuse to overwrite existing benchmark DB; use a new output directory".into());
    }
    let mut db = Connection::open(&path)?;
    db.execute_batch(if mode == "WAL_FULL" {
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;"
    } else {
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA;"
    })?;
    let journal: String = db.query_row("PRAGMA journal_mode", [], |r| r.get(0))?;
    let sync: i64 = db.query_row("PRAGMA synchronous", [], |r| r.get(0))?;
    assert_eq!(
        (journal.as_str(), sync),
        if mode == "WAL_FULL" {
            ("wal", 2)
        } else {
            ("delete", 3)
        }
    );
    db.execute_batch("CREATE TABLE snapshot(bytes BLOB NOT NULL); CREATE TABLE updates(seq INTEGER PRIMARY KEY, bytes BLOB NOT NULL);")?;
    let start = Instant::now();
    let doc = fixture(n)?;
    summary(out, n, mode, "fixture_build", &[ms(start)])?;
    let start = Instant::now();
    let bytes = doc.export(ExportMode::Snapshot)?;
    summary(out, n, mode, "initial_snapshot_export", &[ms(start)])?;
    let initial_bytes = bytes.len();
    db.execute("INSERT INTO snapshot VALUES(?1)", [bytes])?;
    restore_samples(out, &path, &doc, n, mode, 0)?;
    let mut vv = doc.oplog_vv();
    // Warm-up uses a separate doc/DB so measured history starts at zero updates.
    let warm = LoroDoc::new();
    let mut warmdb = Connection::open(dir.join(format!("{n}-{mode}-warm.db")))?;
    warmdb.execute_batch(if mode == "WAL_FULL" {
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE u(bytes BLOB);"
    } else {
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; CREATE TABLE u(bytes BLOB);"
    })?;
    for _ in 0..50 {
        let from = warm.oplog_vv();
        warm.get_text("warm").insert(0, "x")?;
        warm.commit();
        let bytes = warm.export(ExportMode::updates(&from))?;
        let tx = warmdb.transaction()?;
        tx.execute("INSERT INTO u VALUES(?1)", [bytes])?;
        tx.commit()?;
    }
    let mut raw = fs::File::create(dir.join(format!("{n}-{mode}-operations.csv")))?;
    writeln!(raw, "operation,validation_ms,diff_ms,loro_mutation_ms,loro_commit_ms,export_ms,sqlite_ms,read_model_ms,export_to_commit_ms,total_ms,blob_bytes")?;
    let mut stages: [Vec<f64>; 9] = Default::default();
    let mut random = SEED;
    let mut blob_bytes = 0usize;
    let mut over_second = 0;
    for op in 1..=count {
        let total = Instant::now();
        let start = Instant::now();
        random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
        let index = (random as usize % (n / 5)) * 5;
        assert!(index < n);
        let validation = ms(start);
        let start = Instant::now();
        let text = doc.get_text(format!("b{index}"));
        let mut next = text.to_string();
        let replacement = if next.starts_with('A') { "B" } else { "A" };
        next.replace_range(..1, replacement);
        let diff = ms(start);
        let start = Instant::now();
        text.update(&next, Default::default())?;
        let mutation = ms(start);
        let start = Instant::now();
        doc.commit();
        let commit = ms(start);
        let durable = Instant::now();
        let start = Instant::now();
        let bytes = doc.export(ExportMode::updates(&vv))?;
        let export = ms(start);
        let len = bytes.len();
        let start = Instant::now();
        let tx = db.transaction()?;
        tx.execute("INSERT INTO updates(bytes) VALUES(?1)", params![bytes])?;
        tx.commit()?;
        let sql = ms(start);
        let export_sql = ms(durable);
        vv = doc.oplog_vv();
        let start = Instant::now();
        assert_eq!(text.to_string(), next);
        let read = ms(start);
        let elapsed = ms(total);
        over_second += usize::from(elapsed > 1000.0);
        blob_bytes += len;
        for (values, value) in stages.iter_mut().zip([
            validation, diff, mutation, commit, export, sql, read, export_sql, elapsed,
        ]) {
            values.push(value);
        }
        writeln!(raw, "{op},{validation:.6},{diff:.6},{mutation:.6},{commit:.6},{export:.6},{sql:.6},{read:.6},{export_sql:.6},{elapsed:.6},{len}")?;
        if op == 1000 || op == 10_000 {
            restore_samples(out, &path, &doc, n, mode, op)?;
        }
    }
    for (name, values) in [
        "validation",
        "body_prepare",
        "loro_update_including_diff",
        "loro_commit",
        "export",
        "sqlite_transaction",
        "read_model",
        "export_to_commit",
        "operation_total",
    ]
    .iter()
    .zip(&stages)
    {
        summary(out, n, mode, name, values)?;
    }
    writeln!(out, "# metadata n={n} mode={mode} seed={SEED} operations={count} warmup=50 body_chars={} body_utf8={} initial_snapshot_bytes={initial_bytes} update_blob_bytes={blob_bytes} transactions={count} insert_statements={count} begin_commit_statements={} failures=0 over_1000ms={over_second} db_bytes={} wal_bytes={}",
        body().chars().count(), body().len(), count*2, fs::metadata(&path)?.len(),
        fs::metadata(format!("{}-wal", path.display())).map(|m|m.len()).unwrap_or(0))?;
    let start = Instant::now();
    let bytes = doc.export(ExportMode::Snapshot)?;
    summary(
        out,
        n,
        mode,
        "checkpoint_export_writer_blocked",
        &[ms(start)],
    )?;
    let start = Instant::now();
    let tx = db.transaction()?;
    tx.execute("UPDATE snapshot SET bytes=?1", [bytes])?;
    tx.execute("DELETE FROM updates", [])?;
    tx.commit()?;
    summary(out, n, mode, "checkpoint_sql_writer_blocked", &[ms(start)])?;
    if mode == "WAL_FULL" {
        let start = Instant::now();
        db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        summary(out, n, mode, "sqlite_wal_checkpoint", &[ms(start)])?;
    }
    restore_samples(out, &path, &doc, n, mode, 0)?;
    out.flush()?;
    println!("finished {n} {mode} {count} operations");
    Ok(())
}

fn edge_cases() -> Result<()> {
    let doc = LoroDoc::new();
    let text = "日本語🙂e\u{301}\r\n".repeat(10_001);
    assert!(text.chars().count() > 50_000);
    doc.get_text("long").insert(0, &text)?;
    let tree = doc.get_tree("deep");
    let mut parent = TreeParentId::Root;
    for _ in 0..256 {
        parent = TreeParentId::Node(tree.create_at(parent, 0)?);
    }
    doc.get_list("siblings").push("same-owner")?;
    doc.get_list("siblings").push("same-owner")?;
    doc.commit();
    let restored = LoroDoc::from_snapshot(&doc.export(ExportMode::Snapshot)?)?;
    assert_eq!(restored.get_deep_value(), doc.get_deep_value());
    println!(
        "edge cases PASS: chars={} utf8={} depth=256 duplicate_reference_siblings=2",
        text.chars().count(),
        text.len()
    );
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    let dir = Path::new(args.get(1).ok_or("expected new output directory")?);
    fs::create_dir_all(dir)?;
    edge_cases()?;
    let mut out = fs::File::create(dir.join("summary.csv"))?;
    writeln!(out, "blocks,mode,stage,samples,p50_ms,p95_ms,p99_ms,max_ms")?;
    for (n, count) in [(1000, 1000), (10_000, 10_000), (30_000, 1000)] {
        for mode in ["WAL_FULL", "DELETE_EXTRA"] {
            bench(dir, n, count, mode, &mut out)?;
        }
    }
    Ok(())
}
