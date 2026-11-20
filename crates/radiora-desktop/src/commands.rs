//! Tauri commands of the body slice: validation at the boundary, then the coordinator on a
//! blocking thread. No domain logic lives here.

use crate::dto::{
    CreateDocumentArgs, ErrorDto, ErrorKind, SavedDto, UpdateBodyArgs, WorkspaceViewDto,
};
use crate::host::{Coordinator, WorkspaceHost, writer};
use radiora_core::app::{CommandError, Request};
use radiora_infra::workspace::issue_block_id;
use tauri::State;

#[tauri::command]
pub async fn workspace_view(host: State<'_, WorkspaceHost>) -> Result<WorkspaceViewDto, ErrorDto> {
    with_writer(&host, |coordinator| {
        coordinator.view().map(WorkspaceViewDto::from)
    })
    .await
}

/// Issues the logical ID for a new document; the client sends it back in `create_document`,
/// so a resent creation request names the same Block.
#[tauri::command]
pub fn new_block_id() -> Result<String, ErrorDto> {
    issue_block_id()
        .map(|id| id.to_string())
        .map_err(|error| ErrorDto::new(ErrorKind::Storage, error.to_string()))
}

#[tauri::command]
pub async fn create_document(
    host: State<'_, WorkspaceHost>,
    request: CreateDocumentArgs,
) -> Result<SavedDto, ErrorDto> {
    execute(&host, request.into_request()?).await
}

#[tauri::command]
pub async fn update_body(
    host: State<'_, WorkspaceHost>,
    request: UpdateBodyArgs,
) -> Result<SavedDto, ErrorDto> {
    execute(&host, request.into_request()?).await
}

#[tauri::command]
pub async fn retry_save(host: State<'_, WorkspaceHost>) -> Result<SavedDto, ErrorDto> {
    with_writer(&host, |coordinator| coordinator.retry().map(SavedDto::from)).await
}

async fn execute(host: &WorkspaceHost, request: Request) -> Result<SavedDto, ErrorDto> {
    with_writer(host, move |coordinator| {
        coordinator.execute(request).map(SavedDto::from)
    })
    .await
}

/// Runs `work` with the single writer on a blocking thread (SQLite I/O is synchronous).
async fn with_writer<T, F>(host: &WorkspaceHost, work: F) -> Result<T, ErrorDto>
where
    T: Send + 'static,
    F: FnOnce(&mut Coordinator) -> Result<T, CommandError> + Send + 'static,
{
    let handle = host.coordinator()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut coordinator = writer(&handle)?;
        work(&mut coordinator).map_err(|error| {
            log_command_error(&error);
            ErrorDto::from(error)
        })
    })
    .await
    .map_err(|error| {
        tracing::error!(%error, "a workspace command did not complete");
        ErrorDto::new(ErrorKind::Storage, "処理を完了できませんでした。")
    })?
}

fn log_command_error(error: &CommandError) {
    match error {
        CommandError::Persist(_) | CommandError::Store(_) | CommandError::RecoveryRequired => {
            tracing::warn!(%error, "workspace command failed");
        }
        _ => tracing::debug!(%error, "workspace command refused"),
    }
}
