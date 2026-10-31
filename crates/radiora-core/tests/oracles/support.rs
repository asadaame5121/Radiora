//! Shared PBT budget and branch-coverage accounting (v3-verification-plan.md §3).

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::PathBuf;

use proptest::test_runner::{Config, FileFailurePersistence, TestRunner};

/// PR budget: 100 sequences unless `PROPTEST_CASES` overrides it (scheduled: 1000).
pub fn runner(source_file: &'static str) -> TestRunner {
    let mut config = Config {
        failure_persistence: Some(Box::new(FileFailurePersistence::SourceParallel(
            "proptest-regressions",
        ))),
        source_file: Some(source_file),
        ..Config::default()
    };
    if std::env::var_os("PROPTEST_CASES").is_none() {
        config.cases = 100;
    }
    TestRunner::new(config)
}

/// PR budget: at most 50 operations per sequence unless `RADIORA_PBT_MAX_OPS` overrides it.
pub fn max_ops() -> usize {
    std::env::var("RADIORA_PBT_MAX_OPS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(50)
}

pub fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

pub fn read_fixture(name: &str) -> String {
    let path = fixture_path(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read fixture {}: {error}", path.display()))
}

/// Counts which oracle branches random sequences actually reached.
/// A branch with zero hits fails the run instead of counting as verified.
#[derive(Default)]
pub struct Coverage {
    hits: RefCell<BTreeMap<&'static str, usize>>,
}

impl Coverage {
    pub fn hit(&self, branch: &'static str) {
        *self.hits.borrow_mut().entry(branch).or_default() += 1;
    }

    pub fn require(&self, property: &str, branches: &[&'static str]) {
        let hits = self.hits.borrow();
        let missing: Vec<_> = branches
            .iter()
            .filter(|branch| hits.get(*branch).copied().unwrap_or(0) == 0)
            .collect();
        eprintln!("{property} coverage: {hits:?}");
        assert!(
            missing.is_empty(),
            "{property}: random sequences never reached {missing:?}; add a generator bias or a fixed example"
        );
    }
}
