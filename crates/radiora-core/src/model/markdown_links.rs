//! Internal links inside Markdown bodies: extraction and copy remapping.
//!
//! Only real link destinations are touched: inline links, autolinks and reference definitions
//! whose destination is `radiora://block/<UUID>`. The same text inside code spans, code blocks
//! or plain prose is not a link and is never rewritten. Labels are kept as written.
use super::block::remap_on_copy;
use super::id::BlockId;
use super::link::{BLOCK_LINK_PREFIX, parse_block_link_url};
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag, TagEnd};
use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

/// One internal link destination and the byte range of its URL in the source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InternalLink {
    pub target: BlockId,
    pub url_range: Range<usize>,
}

fn parser_options() -> Options {
    Options::empty()
}

/// Finds `url` in `source[from..to]`. Block link URLs contain no characters that Markdown
/// escapes, so the destination appears verbatim in the source.
fn locate(source: &str, from: usize, to: usize, url: &str) -> Option<Range<usize>> {
    let start = from + source.get(from..to)?.find(url)?;
    Some(start..start + url.len())
}

/// Internal link destinations in source order, deduplicated by URL range (a reference
/// definition used by several links is reported once). The URL is searched after the label (or
/// after `]:` for definitions), so a label that spells out a URL is never treated as the
/// destination.
pub fn internal_links(markdown: &str) -> Vec<InternalLink> {
    let mut ranges: BTreeMap<usize, InternalLink> = BTreeMap::new();
    let mut found = |url: &str, from: usize, to: usize| {
        if let Ok(target) = parse_block_link_url(url)
            && let Some(url_range) = locate(markdown, from, to, url)
        {
            ranges.insert(url_range.start, InternalLink { target, url_range });
        }
    };
    let events = Parser::new_ext(markdown, parser_options()).into_offset_iter();
    let definitions: Vec<(String, Range<usize>)> = events
        .reference_definitions()
        .iter()
        .map(|(_, definition)| (definition.dest.to_string(), definition.span.clone()))
        .collect();
    // Open inline links: destination, link span, and the end of the label seen so far.
    let mut open: Vec<(String, Range<usize>, usize)> = Vec::new();
    for (event, span) in events {
        match event {
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                id: label,
                ..
            }) => {
                let inline = label.is_empty() && link_type != LinkType::Autolink;
                if inline {
                    open.push((dest_url.to_string(), span.clone(), span.start + 1));
                } else if link_type == LinkType::Autolink {
                    found(&dest_url, span.start, span.end);
                }
                if !inline {
                    open.push((String::new(), span, usize::MAX));
                }
            }
            Event::End(TagEnd::Link) => {
                if let Some((url, link, label_end)) = open.pop()
                    && label_end != usize::MAX
                {
                    found(&url, label_end, link.end);
                }
            }
            _ => {
                if let Some((_, _, label_end)) = open.last_mut()
                    && *label_end != usize::MAX
                {
                    *label_end = (*label_end).max(span.end);
                }
            }
        }
    }
    for (dest, span) in definitions {
        let after_label = markdown
            .get(span.clone())
            .and_then(|text| text.find("]:"))
            .map_or(span.start, |offset| span.start + offset + 2);
        found(&dest, after_label, span.end);
    }
    ranges.into_values().collect()
}

/// Copy remapping for a body: link targets inside the copied set follow the copy; others keep
/// the original target. Every byte outside rewritten URLs is preserved.
pub fn remap_internal_links(markdown: &str, copies: &BTreeMap<BlockId, BlockId>) -> String {
    let mut output = String::with_capacity(markdown.len());
    let mut cursor = 0;
    for link in internal_links(markdown) {
        let target = remap_on_copy(link.target, copies);
        output.push_str(&markdown[cursor..link.url_range.start]);
        output.push_str(BLOCK_LINK_PREFIX);
        if target == link.target {
            output.push_str(
                &markdown[link.url_range.start + BLOCK_LINK_PREFIX.len()..link.url_range.end],
            );
        } else {
            output.push_str(&target.to_string());
        }
        cursor = link.url_range.end;
    }
    output.push_str(&markdown[cursor..]);
    output
}

/// Distinct targets linked from a body, for backlinks and Missing checks.
pub fn linked_targets(markdown: &str) -> BTreeSet<BlockId> {
    internal_links(markdown)
        .into_iter()
        .map(|link| link.target)
        .collect()
}
