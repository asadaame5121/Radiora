//! Canonical internal link target `radiora://block/<UUID>`.
//!
//! Only the URL is handled here. Extracting links from Markdown (and leaving non-link text such
//! as code spans untouched) belongs to a parser module built on pulldown-cmark.
use super::id::{BlockId, IdError};

pub const BLOCK_LINK_PREFIX: &str = "radiora://block/";

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LinkError {
    #[error("not a radiora block link: {url:?}")]
    NotBlockLink { url: String },
    #[error("radiora block link has an invalid ID: {url:?}")]
    InvalidId {
        url: String,
        #[source]
        source: IdError,
    },
}

/// Formats the canonical URL. The label is stored separately in the Markdown link, so renaming
/// the target never changes this value.
pub fn block_link_url(target: BlockId) -> String {
    format!("{BLOCK_LINK_PREFIX}{target}")
}

pub fn parse_block_link_url(url: &str) -> Result<BlockId, LinkError> {
    let Some(id) = url.strip_prefix(BLOCK_LINK_PREFIX) else {
        return Err(LinkError::NotBlockLink {
            url: url.to_owned(),
        });
    };
    id.parse().map_err(|source| LinkError::InvalidId {
        url: url.to_owned(),
        source,
    })
}
