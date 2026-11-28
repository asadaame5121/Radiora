// Single source of the command names: included by `build.rs` (app manifest permissions) and
// by the crate's tests (invoke handler and capability checks). Keep in the order of
// `commands.rs`. Recorded in `docs/design/v3-ipc-read-model.md`.
pub const COMMANDS: &[&str] = &["read_saved_workspace"];
