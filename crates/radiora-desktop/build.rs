mod command_names {
    include!("src/command_names.rs");
}

fn main() {
    let manifest = tauri_build::AppManifest::new().commands(command_names::COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to run the Tauri build script");
}
