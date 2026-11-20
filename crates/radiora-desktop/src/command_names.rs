// Single source of the command names: included by `build.rs` (app manifest permissions)
// and by the crate (invoke handler check). Keep in the order of `commands.rs`.
pub const COMMANDS: &[&str] = &[
    "workspace_view",
    "new_block_id",
    "create_document",
    "update_body",
    "retry_save",
];
