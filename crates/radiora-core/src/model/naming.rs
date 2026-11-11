//! Display names and search keys (docs/design/v3-naming-and-search-contract.md).
//!
//! Stored text is never rewritten: names are derived for display, and search keys are derived
//! for the index only.
use super::block::PlainLabel;
use pulldown_cmark::{Event, Parser};
use unicode_normalization::UnicodeNormalization;

/// Display name of an owned body: the Markdown-rendered text of the first source line that
/// renders to non-empty text. Decoration marks are dropped, links contribute their label and
/// inline code its content. `None` means the UI shows "Untitled" with a short ID; that
/// placeholder is never stored or indexed.
///
/// Lines are rendered one by one, so a line that opens a multi-line construct (for example a
/// code fence) renders empty and is skipped.
pub fn display_name(markdown: &str) -> Option<String> {
    markdown
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(render_inline_text)
        .find(|name| !name.is_empty())
}

fn render_inline_text(line: &str) -> String {
    let mut text = String::new();
    for event in Parser::new(line) {
        match event {
            Event::Text(part) | Event::Code(part) => text.push_str(&part),
            Event::SoftBreak | Event::HardBreak => text.push(' '),
            _ => {}
        }
    }
    text.trim().to_owned()
}

/// Index key: NFKC, locale-independent lower case, trimmed, whitespace runs collapsed to one
/// space. No kana folding, readings or fuzzy matching in the first release.
pub fn search_key(text: &str) -> String {
    let folded: String = text.nfkc().collect::<String>().to_lowercase();
    folded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Adds an alias to an owned Block unless an alias with the same search key already exists.
/// Different Blocks may share names and aliases; only duplicates within one Block are dropped.
/// Returns whether the alias was added.
pub fn add_alias(aliases: &mut Vec<PlainLabel>, alias: PlainLabel) -> bool {
    let key = search_key(alias.as_str());
    if aliases
        .iter()
        .any(|existing| search_key(existing.as_str()) == key)
    {
        return false;
    }
    aliases.push(alias);
    true
}
