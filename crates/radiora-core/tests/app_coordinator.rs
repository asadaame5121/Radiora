//! V01 for the application layer (docs/design/v3-verification-plan.md):
//! P — the pure planner; S — a state-machine PBT of `DocumentCoordinator` over a controllable
//! port that injects save failures, lost commit results, partial applies and reopening.
//!
//! The fake port is a small reference model (maps only); it never calls Loro or SQLite.

use proptest::prelude::*;
use radiora_core::app::{
    ApplyFailure, BlockPresence, BlockView, CommandError, DocumentChange, DocumentCommand,
    DocumentCoordinator, DocumentStore, Fingerprint, PlanError, Receipt, Request, RequestId,
    StoreFailure, WorkspaceView, plan,
};
use radiora_core::model::BlockId;
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;
use uuid::Uuid;

fn block(n: u8) -> BlockId {
    format!("0190a6e0-0000-7000-8000-0000000000{n:02x}")
        .parse()
        .expect("fixed UUIDv7")
}

// ---- P: planner -------------------------------------------------------------------------

#[test]
fn create_document_is_planned_only_for_an_unused_id() {
    let id = block(1);
    let command = DocumentCommand::CreateDocument { id };
    assert_eq!(
        plan(&command, None),
        Ok(DocumentChange::CreateDocument { id })
    );
    for taken in [
        BlockPresence::Live { owns_body: true },
        BlockPresence::Live { owns_body: false },
        BlockPresence::Retired,
    ] {
        assert_eq!(
            plan(&command, Some(taken)),
            Err(PlanError::DuplicateBlock(id))
        );
    }
}

#[test]
fn update_body_is_planned_only_for_a_live_block_that_owns_its_body() {
    let id = block(2);
    let command = DocumentCommand::UpdateBody {
        id,
        body: "本文".into(),
    };
    assert_eq!(
        plan(&command, Some(BlockPresence::Live { owns_body: true })),
        Ok(DocumentChange::SetBody {
            id,
            body: "本文".into()
        })
    );
    assert_eq!(
        plan(&command, Some(BlockPresence::Live { owns_body: false })),
        Err(PlanError::NoBody(id))
    );
    assert_eq!(
        plan(&command, Some(BlockPresence::Retired)),
        Err(PlanError::UnknownBlock(id))
    );
    assert_eq!(plan(&command, None), Err(PlanError::UnknownBlock(id)));
}

#[test]
fn fingerprints_distinguish_every_field() {
    let id = RequestId::new(Uuid::nil());
    let request = |base, command| Request { id, base, command };
    let body = |text: &str| DocumentCommand::UpdateBody {
        id: block(1),
        body: text.into(),
    };
    let a = request(1, body("ab")).fingerprint();
    assert_eq!(a, request(1, body("ab")).fingerprint());
    assert_ne!(a, request(2, body("ab")).fingerprint());
    assert_ne!(a, request(1, body("abc")).fingerprint());
    assert_ne!(
        a,
        request(1, DocumentCommand::CreateDocument { id: block(1) }).fingerprint()
    );
}

// ---- S: coordinator state machine ---------------------------------------------------------

/// What the port does on the next write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fault {
    None,
    /// The write fails before anything is durable.
    BeforeCommit,
    /// The write commits, but the caller sees a failure (lost result).
    AfterCommit,
    /// The in-memory change stops part-way (apply only).
    Partial,
}

#[derive(Debug, Default)]
struct Model {
    memory: BTreeMap<BlockId, String>,
    durable: BTreeMap<BlockId, String>,
    version: u64,
    receipts: HashMap<RequestId, (Fingerprint, u64)>,
    pending: bool,
    broken: bool,
    /// Applications to the in-memory document since it was last opened.
    applied: HashMap<RequestId, u32>,
    /// Durable commits per request over the whole run.
    committed: HashMap<RequestId, u32>,
    fault: Option<Fault>,
}

impl Model {
    fn take_fault(&mut self) -> Fault {
        self.fault.take().unwrap_or(Fault::None)
    }

    fn commit(&mut self, request: RequestId, fingerprint: &Fingerprint) {
        if self.memory != self.durable {
            self.durable = self.memory.clone();
            self.version += 1;
        }
        self.receipts
            .insert(request, (fingerprint.clone(), self.version));
        *self.committed.entry(request).or_default() += 1;
    }

    /// Reopening keeps only durable state, as the real adapter does. A change lost this way
    /// may be applied again by resending its request; that is not a double application.
    fn reopen(&mut self) {
        self.memory = self.durable.clone();
        self.pending = false;
        self.broken = false;
        self.applied.clear();
    }
}

#[derive(Debug)]
struct Refused(&'static str);

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for Refused {}

fn failure(reason: &'static str) -> StoreFailure {
    StoreFailure::new(Refused(reason))
}

#[derive(Clone)]
struct FakeStore(Rc<RefCell<Model>>);

impl DocumentStore for FakeStore {
    fn durable_version(&self) -> u64 {
        self.0.borrow().version
    }

    fn receipt(
        &self,
        request: RequestId,
        fingerprint: &Fingerprint,
    ) -> Result<Option<Receipt>, StoreFailure> {
        Ok(self
            .0
            .borrow()
            .receipts
            .get(&request)
            .map(|(stored, version)| Receipt {
                matches: stored == fingerprint,
                version: *version,
            }))
    }

    fn presence(&self, id: BlockId) -> Result<Option<BlockPresence>, StoreFailure> {
        Ok(self
            .0
            .borrow()
            .memory
            .contains_key(&id)
            .then_some(BlockPresence::Live { owns_body: true }))
    }

    fn apply(
        &mut self,
        request: RequestId,
        fingerprint: &Fingerprint,
        change: &DocumentChange,
    ) -> Result<u64, ApplyFailure> {
        let mut model = self.0.borrow_mut();
        assert!(!model.pending && !model.broken, "apply while not clean");
        match model.take_fault() {
            Fault::Partial => {
                model.broken = true;
                Err(ApplyFailure::Partial(failure("partial")))
            }
            fault => {
                match change {
                    DocumentChange::CreateDocument { id } => {
                        model.memory.insert(*id, String::new());
                    }
                    DocumentChange::SetBody { id, body } => {
                        model.memory.insert(*id, body.clone());
                    }
                }
                *model.applied.entry(request).or_default() += 1;
                match fault {
                    Fault::None => {
                        model.commit(request, fingerprint);
                        Ok(model.version)
                    }
                    Fault::BeforeCommit => {
                        model.pending = true;
                        Err(ApplyFailure::NotDurable(failure("before commit")))
                    }
                    Fault::AfterCommit | Fault::Partial => {
                        model.commit(request, fingerprint);
                        model.pending = true;
                        Err(ApplyFailure::NotDurable(failure("result lost")))
                    }
                }
            }
        }
    }

    fn persist_pending(
        &mut self,
        request: RequestId,
        fingerprint: &Fingerprint,
    ) -> Result<u64, StoreFailure> {
        let mut model = self.0.borrow_mut();
        assert!(model.pending, "persist_pending without a pending change");
        assert!(
            !model.receipts.contains_key(&request),
            "persist_pending would append a committed request twice"
        );
        match model.take_fault() {
            Fault::None | Fault::Partial => {
                model.commit(request, fingerprint);
                model.pending = false;
                Ok(model.version)
            }
            Fault::BeforeCommit => Err(failure("before commit")),
            Fault::AfterCommit => {
                model.commit(request, fingerprint);
                Err(failure("result lost"))
            }
        }
    }

    fn acknowledge_durable(&mut self, version: u64) -> Result<(), StoreFailure> {
        let mut model = self.0.borrow_mut();
        assert!(model.pending, "acknowledge without a pending change");
        assert_eq!(
            model.memory, model.durable,
            "acknowledged state is not durable"
        );
        assert_eq!(version, model.version);
        model.pending = false;
        Ok(())
    }

    fn committed_view(&self) -> Result<WorkspaceView, StoreFailure> {
        let model = self.0.borrow();
        if model.pending || model.broken {
            return Err(failure("not clean"));
        }
        Ok(WorkspaceView {
            version: model.version,
            blocks: model
                .durable
                .iter()
                .enumerate()
                .map(|(index, (id, body))| BlockView {
                    id: *id,
                    parent: None,
                    index,
                    body: body.clone(),
                })
                .collect(),
        })
    }
}

#[derive(Debug, Clone)]
enum Op {
    Create {
        block: u8,
        stale: bool,
        fault: Fault,
    },
    Edit {
        block: u8,
        body: u8,
        stale: bool,
        fault: Fault,
    },
    ResendLast,
    Retry {
        fault: Fault,
    },
    View,
    Reopen,
}

fn fault() -> impl Strategy<Value = Fault> {
    prop_oneof![
        4 => Just(Fault::None),
        2 => Just(Fault::BeforeCommit),
        2 => Just(Fault::AfterCommit),
        1 => Just(Fault::Partial),
    ]
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (0u8..4, any::<bool>(), fault()).prop_map(|(block, stale, fault)| Op::Create {
            block,
            stale,
            fault
        }),
        (0u8..4, 0u8..3, any::<bool>(), fault()).prop_map(|(block, body, stale, fault)| {
            Op::Edit {
                block,
                body,
                stale,
                fault,
            }
        }),
        Just(Op::ResendLast),
        fault().prop_map(|fault| Op::Retry { fault }),
        Just(Op::View),
        Just(Op::Reopen),
    ]
}

/// Checks the V01 invariants after one step.
fn check(
    model: &Model,
    coordinator: &DocumentCoordinator<FakeStore>,
    outcome: &Result<radiora_core::app::Saved, CommandError>,
    request: Option<&Request>,
    last_version: &mut u64,
) {
    // The published version never exceeds the durable one, and never goes back.
    assert!(coordinator.version() <= model.version);
    assert!(model.version >= *last_version);
    *last_version = model.version;
    // No request is applied twice to an open document, nor made durable twice.
    assert!(model.applied.values().all(|count| *count <= 1));
    assert!(model.committed.values().all(|count| *count <= 1));
    if let Ok(saved) = outcome {
        assert!(!coordinator.is_dirty());
        assert!(saved.version <= model.version);
        if let (Some(request), false) = (request, saved.replayed) {
            match &request.command {
                DocumentCommand::CreateDocument { id } => assert!(model.durable.contains_key(id)),
                DocumentCommand::UpdateBody { id, body } => {
                    assert_eq!(model.durable.get(id), Some(body))
                }
            }
        }
    }
    // Reads publish durable state only, and only when nothing is pending.
    match coordinator.view() {
        Ok(view) => {
            assert!(!coordinator.is_dirty());
            assert_eq!(view.version, model.version);
            let published: BTreeMap<_, _> =
                view.blocks.into_iter().map(|b| (b.id, b.body)).collect();
            assert_eq!(published, model.durable);
        }
        Err(error) => assert!(matches!(
            error,
            CommandError::PersistPending | CommandError::RecoveryRequired
        )),
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn the_coordinator_publishes_only_durable_changes_and_never_applies_twice(
        ops in prop::collection::vec(op(), 1..40)
    ) {
        let model = Rc::new(RefCell::new(Model::default()));
        let mut coordinator = DocumentCoordinator::new(FakeStore(model.clone()));
        let mut last: Option<Request> = None;
        let mut last_version = 0;
        let mut issued: u128 = 0;
        let mut fresh_request = || { issued += 1; RequestId::new(Uuid::from_u128(issued)) };
        for op in ops {
            let base = |stale: bool, coordinator: &DocumentCoordinator<FakeStore>| {
                let current = coordinator.version();
                if stale { current.saturating_sub(1) } else { current }
            };
            let (outcome, request) = match op {
                Op::Create { block: n, stale, fault } => {
                    let request = Request {
                        id: fresh_request(),
                        base: base(stale, &coordinator),
                        command: DocumentCommand::CreateDocument { id: block(n) },
                    };
                    model.borrow_mut().fault = Some(fault);
                    (coordinator.execute(request.clone()), Some(request))
                }
                Op::Edit { block: n, body, stale, fault } => {
                    let request = Request {
                        id: fresh_request(),
                        base: base(stale, &coordinator),
                        command: DocumentCommand::UpdateBody {
                            id: block(n),
                            body: ["", "a", "本文"][usize::from(body)].into(),
                        },
                    };
                    model.borrow_mut().fault = Some(fault);
                    (coordinator.execute(request.clone()), Some(request))
                }
                Op::ResendLast => match last.clone() {
                    Some(request) => (coordinator.execute(request.clone()), Some(request)),
                    None => continue,
                },
                Op::Retry { fault } => {
                    model.borrow_mut().fault = Some(fault);
                    (coordinator.retry(), None)
                }
                Op::View => (coordinator.view().map(|view| radiora_core::app::Saved {
                    version: view.version,
                    replayed: true,
                }), None),
                Op::Reopen => {
                    model.borrow_mut().reopen();
                    coordinator = DocumentCoordinator::new(FakeStore(model.clone()));
                    (Err(CommandError::NothingToRetry), None)
                }
            };
            model.borrow_mut().fault = None;
            check(&model.borrow(), &coordinator, &outcome, request.as_ref(), &mut last_version);
            if let Some(request) = request {
                last = Some(request);
            }
        }
    }
}
