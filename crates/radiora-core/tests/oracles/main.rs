//! Independent PBT oracles for the v3 contracts (docs/design/v3-verification-plan.md §3).
//!
//! Each module is a small reference model built from maps, vectors and sets.
//! None of them calls production code, Loro or SQLite; product commands will be
//! compared against these models and the shared JSON fixtures in `tests/fixtures/`.

mod history;
mod lineage;
mod structure;
mod support;
mod trash;
