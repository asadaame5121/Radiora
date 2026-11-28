//! Independent PBT oracles for the v3 contracts (docs/design/v3-verification-plan.md §3).
//!
//! Each module is a small reference model built from maps, vectors and sets.
//! None of them calls production code, Loro or SQLite; product commands are
//! compared against these models and the shared JSON fixtures in `tests/fixtures/`
//! in separate `*_conformance` modules.

mod history;
mod import;
mod lineage;
mod lineage_conformance;
mod structure;
mod support;
mod trash;
