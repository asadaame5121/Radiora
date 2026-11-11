//! Display names, search keys, aliases and internal links in Markdown (#381, #290 contract).
use proptest::prelude::*;
use radiora_core::model::*;
use std::collections::{BTreeMap, BTreeSet};
use uuid::{Builder, Variant, Version};

fn block(seed: u32) -> BlockId {
    let mut bytes = [0xB0; 16];
    bytes[..4].copy_from_slice(&seed.to_be_bytes());
    let uuid = Builder::from_random_bytes(bytes)
        .with_version(Version::SortRand)
        .with_variant(Variant::RFC4122)
        .into_uuid();
    BlockId::from_uuid(uuid).unwrap()
}
fn url(seed: u32) -> String {
    block_link_url(block(seed))
}

#[test]
fn display_name_renders_the_first_non_empty_line() {
    let cases = [
        ("# **Free** _will_\nbody", Some("Free will")),
        ("\n\n  \nsecond line\nthird", Some("second line")),
        (
            "see [the label](https://example.com) now",
            Some("see the label now"),
        ),
        ("`code` in name", Some("code in name")),
        ("```rust\nfn main() {}\n```", Some("fn main() {}")),
        ("---\nafter rule", Some("after rule")),
        ("", None),
        ("   \n\t\n", None),
        ("<!-- only html -->", None),
    ];
    for (markdown, expected) in cases {
        assert_eq!(display_name(markdown).as_deref(), expected, "{markdown:?}");
    }
    let linked = format!("[target name]({}) rest", url(1));
    assert_eq!(display_name(&linked).as_deref(), Some("target name rest"));
}

#[test]
fn search_key_normalizes_width_case_and_spaces() {
    assert_eq!(search_key("  Ｆｒｅｅ\u{3000}\tＷｉｌｌ  "), "free will");
    assert_eq!(search_key("ｶﾞ"), "ガ");
    assert_eq!(search_key("ÉCOLE  Étude"), "école étude");
    // No kana folding in the first release.
    assert_ne!(search_key("かな"), search_key("カナ"));
}

#[test]
fn aliases_are_unique_per_block_after_normalization() {
    let mut aliases = Vec::new();
    let label = |text: &str| PlainLabel::new(text).unwrap();
    assert!(add_alias(&mut aliases, label("Free Will")));
    assert!(!add_alias(&mut aliases, label(" ｆｒｅｅ  will ")));
    assert!(add_alias(&mut aliases, label("自由意志")));
    // The stored text is the user's original string.
    assert_eq!(aliases[0].as_str(), "Free Will");
    assert_eq!(aliases.len(), 2);
}

#[test]
fn only_real_link_destinations_are_extracted() {
    let markdown = format!(
        "inline [a]({u1}) and <{u2}>\n\
         ref [b][r] and [c][r]\n\
         code `{u3}` and plain {u4}\n\
         label spells it: [{u6}]({u6})\n\
         titled [d]({u7} \"{u8}\")\n\n\
         ```\n[e]({u9})\n```\n\n\
         [r]: {u10}\n",
        u1 = url(1),
        u2 = url(2),
        u3 = url(3),
        u4 = url(4),
        u6 = url(6),
        u7 = url(7),
        u8 = url(8),
        u9 = url(9),
        u10 = url(10),
    );
    let targets: Vec<BlockId> = internal_links(&markdown)
        .into_iter()
        .map(|link| link.target)
        .collect();
    assert_eq!(targets, [1, 2, 6, 7, 10].map(block));
    for link in internal_links(&markdown) {
        assert_eq!(&markdown[link.url_range], block_link_url(link.target));
    }
    assert_eq!(
        linked_targets(&markdown),
        BTreeSet::from([1, 2, 6, 7, 10].map(block))
    );
}

#[test]
fn copy_remap_rewrites_only_copied_targets() {
    let markdown = format!(
        "[B]({}) [C]({}) `{}` [{}]({})",
        url(1),
        url(2),
        url(1),
        url(1),
        url(1)
    );
    let copies = BTreeMap::from([(block(1), block(101))]);
    let expected = format!(
        "[B]({}) [C]({}) `{}` [{}]({})",
        url(101),
        url(2),
        url(1),
        url(1),
        url(101)
    );
    assert_eq!(remap_internal_links(&markdown, &copies), expected);
    assert_eq!(remap_internal_links(&markdown, &BTreeMap::new()), markdown);
}

#[derive(Debug, Clone)]
enum Piece {
    Text(String),
    Inline(u32, String),
    Code(u32),
    Fence(u32),
    Autolink(u32),
}

fn piece() -> impl Strategy<Value = Piece> {
    let text = "[a-zA-Z0-9 ,.#*_\n日本語]{0,12}";
    prop_oneof![
        text.prop_map(Piece::Text),
        (1u32..6, "[a-z ]{0,6}").prop_map(|(seed, label)| Piece::Inline(seed, label)),
        (1u32..6).prop_map(Piece::Code),
        (1u32..6).prop_map(Piece::Fence),
        (1u32..6).prop_map(Piece::Autolink),
    ]
}

fn render(pieces: &[Piece], map: &dyn Fn(u32) -> u32) -> String {
    pieces
        .iter()
        .map(|piece| match piece {
            Piece::Text(text) => text.replace(['[', ']', '(', ')', '<', '>', '`'], ""),
            Piece::Inline(seed, label) => format!(" [x{label}]({}) ", url(map(*seed))),
            Piece::Code(seed) => format!(" `{}` ", url(*seed)),
            Piece::Fence(seed) => format!("\n\n```\n[x]({})\n```\n\n", url(*seed)),
            Piece::Autolink(seed) => format!(" <{}> ", url(map(*seed))),
        })
        .collect()
}

proptest! {
    /// Remapping equals rendering the document with mapped link destinations: code spans, code
    /// blocks, labels and every other byte stay unchanged.
    #[test]
    fn remap_changes_nothing_but_link_destinations(
        pieces in prop::collection::vec(piece(), 0..12),
        copied in prop::collection::btree_set(1u32..6, 0..5),
    ) {
        let copies: BTreeMap<BlockId, BlockId> =
            copied.iter().map(|seed| (block(*seed), block(seed + 100))).collect();
        let original = render(&pieces, &|seed| seed);
        let expected = render(&pieces, &|seed| if copied.contains(&seed) { seed + 100 } else { seed });
        let remapped = remap_internal_links(&original, &copies);
        prop_assert_eq!(&remapped, &expected);
        let linked: usize = pieces.iter().filter(|p| matches!(p, Piece::Inline(..) | Piece::Autolink(_))).count();
        prop_assert_eq!(internal_links(&original).len(), linked);
    }

    #[test]
    fn search_key_is_idempotent_and_space_normalized(text in "\\PC{0,24}") {
        let key = search_key(&text);
        prop_assert_eq!(search_key(&key), key.clone());
        prop_assert_eq!(key.trim(), key.as_str());
        prop_assert!(!key.contains("  "));
    }
}
