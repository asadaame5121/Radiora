use loro::{ExportMode, LoroDoc, VersionVector};
use radiora_loro_purge_poc::Result;
use std::{fs, path::Path};

fn normalized(doc: &LoroDoc) -> Result<String> {
    Ok(serde_json::to_string(&doc.get_deep_value())?)
}

fn emit(doc: &LoroDoc, dir: &Path, name: &str) -> Result<()> {
    fs::write(dir.join(format!("{name}.json")), normalized(doc)?)?;
    fs::write(dir.join(format!("{name}.vv")), doc.oplog_vv().encode())?;
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    let dir = Path::new(args.get(2).ok_or("expected mode directory")?);
    fs::create_dir_all(dir)?;
    match args.get(1).map(String::as_str) {
        Some("export") => {
            let doc = LoroDoc::new();
            doc.set_peer_id(383)?;
            doc.get_text("body").insert(0, "日本語🙂e\u{301}\r\n本文")?;
            doc.get_map("references").insert("display-b", "owner-a")?;
            doc.get_list("order").push("owner-a")?;
            doc.get_list("order").push("display-b")?;
            doc.commit();
            fs::write(dir.join("rust.snapshot"), doc.export(ExportMode::Snapshot)?)?;
            emit(&doc, dir, "rust-base")?;
            let vv = doc.oplog_vv();
            doc.get_text("body").insert(0, "差分:")?;
            doc.get_list("order").push("block-c")?;
            doc.commit();
            fs::write(
                dir.join("rust.update"),
                doc.export(ExportMode::updates(&vv))?,
            )?;
            emit(&doc, dir, "rust-final")?;
        }
        Some("verify") => {
            let doc = LoroDoc::from_snapshot(&fs::read(dir.join("wasm.snapshot"))?)?;
            let base = LoroDoc::from_snapshot(&fs::read(dir.join("rust.snapshot"))?)?;
            base.import(&fs::read(dir.join("rust.update"))?)?;
            assert_eq!(doc.oplog_vv(), base.oplog_vv());
            assert_eq!(doc.get_deep_value(), base.get_deep_value());
            assert!(doc
                .import(&fs::read(dir.join("wasm.update"))?)?
                .pending
                .is_none());
            // JS exports its full final snapshot independently of the delta path.
            let full = LoroDoc::from_snapshot(&fs::read(dir.join("wasm-final.snapshot"))?)?;
            assert_eq!(doc.get_deep_value(), full.get_deep_value());
            assert_eq!(doc.oplog_vv(), full.oplog_vv());
            let wasm_vv = VersionVector::decode(&fs::read(dir.join("wasm-final.vv"))?)?;
            assert_eq!(doc.oplog_vv(), wasm_vv);
            emit(&doc, dir, "roundtrip")?;
            println!("Rust/WASM snapshot+update roundtrip: PASS");
        }
        _ => return Err("expected export or verify".into()),
    }
    Ok(())
}
