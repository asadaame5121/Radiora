<script lang="ts">
	import { onMount, tick } from "svelte";
	import GlobalLineage from "./GlobalLineage.svelte";
	import RevisionComparison from "./RevisionComparison.svelte";
	import ComparisonPane from "./ComparisonPane.svelte";
	import RecoverySnapshots from "./RecoverySnapshots.svelte";
	import WorkLineage from "./WorkLineage.svelte";
	import AdvancedLinkEditor from "./AdvancedLinkEditor.svelte";
	import MarkdownEditor from "./MarkdownEditor.svelte";
	import type {
		Bookmark,
		CreateLinkInput,
		EmergenceAction,
		EmergenceSuggestion,
		LinkType,
		OutlineItem,
		OutlineLink,
		OutlineSnapshot,
		NavigationTarget,
		RuleQueryResult,
		SavedRuleQuery,
		SearchAlias,
		SearchResult,
		ScopedTagSet,
		TagAlias,
		TagSummary,
		Revision,
		RecoverySnapshot,
		Suggestion,
		TrashEntry,
		UnplacedWork,
	} from "../domain/models";
	import { LINK_TYPES } from "../domain/models";
	import type { RadioraBindings, StartupStatus } from "../shared/bindings";
	import type {
		GlobalLineageProjection,
	WorkLineageProjection,
	} from "../services/branch_service";
	import type { DateProjection, DateRange } from "../services/date_projection";
	import {
		WorkingCopyAutosaveCoordinator,
		type WorkingCopySaveStatus,
	} from "../services/working_copy_autosave";
	import { ResumePositionAutosaveCoordinator } from "../services/resume_position_autosave";
	import {
		activateBrowsingPane,
		activeBrowsingPane,
		ancestorBreadcrumb,
		browseToOutlineOccurrence,
		canMoveBrowsingHistory,
		createBrowsingNavigationState,
		currentBrowsingLocation,
		moveBrowsingHistory,
		openBrowsingPane,
		projectBrowsingOutline,
		reconcileBrowsingState,
		setBrowsingHoist,
	} from "../services/browsing_navigation_state";
	import { useUiVocabulary } from "./ui_vocabulary_context";
	import { navigationUiState } from "./navigation_state";
	import {
		COMMAND_DEFINITIONS,
		commandAvailability,
		dispatchCommand,
		isEditableTarget,
		shortcutForKeyboardEvent,
		validateShortcuts,
		type CommandContext,
		type CommandId,
	} from "./command_service";
	import {
	commandPaletteItems,
	nextCommandPaletteIndex,
	type CommandPaletteItem,
	} from "./command_palette.ts";
	import { findInternalReferenceTrigger } from "../services/internal_reference";
	import { parseMarkdownCandidates } from "../services/markdown_parser";
	import type {
		InternalReferenceBacklink,
		InternalReferenceCompletion,
		InternalReferenceResolution,
	} from "../services/internal_reference_service";
	import {
		comparisonDocumentKey,
		isComparableLinkType,
		type LinkComparisonProjection,
		type WorkComparisonDocuments,
	} from "../services/comparison_service";

	const api = new Proxy({}, {
		get: (_target, property) => async (...args: unknown[]) => {
			const response = await fetch(`/api/rpc/${String(property)}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ args }),
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.message ?? "API request failed.");
			return payload.result;
		},
	}) as RadioraBindings;

	type VisibleRow = { item: OutlineItem; depth: number; hasChildren: boolean; stash: boolean };
	type ViewMode =
		| "outline"
		| "today"
		| "unplaced"
		| "globalLineage"
		| "workLineage"
		| "comparison"
		| "trash";
	type AsideMode = "links" | "discover" | "tags" | "query";
	type PendingConfirmation =
		| { action: "trash"; occurrenceId: string; occurrenceCount: number }
		| { action: "purge"; workId: string; occurrenceCount: number; linkCount: number };
	type InternalReferenceCompletionState = {
		itemId: string;
		range: { start: number; end: number };
		candidates: InternalReferenceCompletion[];
		activeIndex: number;
	};

	const vocabulary = useUiVocabulary();
	let snapshot = $state<OutlineSnapshot>({ items: [], links: [], knots: [], stashItemIds: [] });
	let loading = $state(true);
	let startup = $state<StartupStatus>({ phase: "starting", message: "Radioraを起動しています…" });
	let error = $state("");
	let quickCaptureText = $state("");
	let quickCaptureSubmitting = $state(false);
	let unplacedWorks = $state<UnplacedWork[]>([]);
	let unplacedLinkTargets = $state<Record<string, string>>({});
	let unplacedLinkDirections = $state<Record<string, "from" | "to">>({});
	let unplacedLinkType = $state<LinkType>("RELATED");
	let viewMode = $state<ViewMode>("outline");
	let dateStart = $state(localDateValue(new Date()));
	let dateEnd = $state(localDateValue(addDays(new Date(), 1)));
	let dateProjection = $state<DateProjection | null>(null);
	let dateProjectionLoading = $state(false);
	let selectedId = $state<string | null>(null);
	let browsing = $state(createBrowsingNavigationState());
	let nextPaneNumber = 2;
	let bookmarks = $state<Bookmark[]>([]);
	let transientExpandedIds = $state<string[]>([]);
	let searchQuery = $state("");
	let suggestions = $state<Suggestion[]>([]);
	let searchResults = $state<SearchResult[]>([]);
	let searchActiveIndex = $state(-1);
	let asideMode = $state<AsideMode>("links");
	let emergenceSuggestions = $state<EmergenceSuggestion[]>([]);
	let emergenceLoading = $state(false);
	let aliases = $state<SearchAlias[]>([]);
	let aliasCanonical = $state("");
	let aliasVariants = $state("");
	let tags = $state<TagSummary[]>([]);
	let tagAliases = $state<TagAlias[]>([]);
	let tagAll = $state("");
	let tagNone = $state("");
	let tagHistoryRevisionIds = $state("");
	let tagMatches = $state<ScopedTagSet[]>([]);
	let tagRenameFrom = $state("");
	let tagRenameTo = $state("");
	let tagMergeSources = $state("");
	let tagMergeTarget = $state("");
	let tagError = $state("");
	let ruleSource = $state('?- link("LIKE", From, To).');
	let ruleResult = $state<RuleQueryResult | null>(null);
	let ruleName = $state("");
	let savedRuleQueries = $state<SavedRuleQuery[]>([]);
	let ruleError = $state("");
	let draggedId = $state<string | null>(null);
	let trashEntries = $state<TrashEntry[]>([]);
	let revisions = $state<Revision[]>([]);
	let recoverySnapshots = $state<RecoverySnapshot[]>([]);
	let revisionsLoading = $state(false);
	let revisionLoadRequest = 0;
	let globalLineage = $state<GlobalLineageProjection | null>(null);
	let workLineage = $state<WorkLineageProjection | null>(null);
	let workLineageLoading = $state(false);
	let workLineageLoadRequest = 0;
	let comparisonPreferredRevisionId = $state<string | undefined>();
	let linkComparison = $state<LinkComparisonProjection | null>(null);
	let workComparison = $state<
		(WorkComparisonDocuments & { preferredLeftKey?: string; preferredRightKey?: string }) | null
	>(null);
	let comparisonRequest = 0;
	let pendingConfirmation = $state<PendingConfirmation | null>(null);
	let confirmationSubmitting = $state(false);
	let confirmationDialog: HTMLDialogElement;
	let commandPaletteOpen = $state(false);
	let commandPaletteQuery = $state("");
	let commandPaletteActiveIndex = $state(-1);
	let commandPaletteInput = $state<HTMLInputElement | null>(null);
	let commandPaletteRestoreFocus: HTMLElement | null = null;
	let workingCopySaveStatuses = $state<WorkingCopySaveStatus[]>([]);
	let internalReferenceCompletion = $state<InternalReferenceCompletionState | null>(null);
	let internalReferenceBacklinks = $state<InternalReferenceBacklink[]>([]);
	let internalReferenceNotice = $state("");
	let internalReferenceCompletionRequest = 0;
	const autosave = new WorkingCopyAutosaveCoordinator({
		save: (occurrenceId, text) => api.updateItemText(occurrenceId, text),
		onStatusChange: (statuses) => workingCopySaveStatuses = statuses,
	});
	const resumeAutosave = new ResumePositionAutosaveCoordinator({
		save: async (occurrenceId, caretOffset) => {
			await api.saveResumePosition(occurrenceId, caretOffset);
		},
		onError: (cause) => error = errorMessage(cause),
	});

	const itemById = $derived(new Map(snapshot.items.map((item) => [item.id, item])));
	const itemByWorkId = $derived(new Map(snapshot.items.map((item) => [item.workId, item])));
	const selectedItem = $derived(selectedId ? itemById.get(selectedId) ?? null : null);
	const browsingLocation = $derived(currentBrowsingLocation(browsing));
	const browsingPane = $derived(activeBrowsingPane(browsing));
	const browsingProjection = $derived(projectBrowsingOutline(
		snapshot,
		browsingLocation.hoistOccurrenceId,
	));
	const selectedBreadcrumb = $derived(ancestorBreadcrumb(snapshot, selectedId));
	const selectedBranchId = $derived(
		selectedItem?.revisionSelector.mode === "branch"
			? selectedItem.revisionSelector.branchId
			: null,
	);
	const selectedPlacements = $derived(selectedItem
		? snapshot.items.filter((item) => item.workId === selectedItem.workId)
			.sort((left, right) => left.orderKey - right.orderKey || left.id.localeCompare(right.id))
		: []);
	const selectedLinks = $derived(selectedItem
		? snapshot.links.filter((link) =>
			link.fromId === selectedItem.workId || link.toId === selectedItem.workId
		)
		: []);
	const linkableWorks = $derived([
		...new Map([
			...snapshot.items.map((item) => [item.workId, { workId: item.workId, text: item.text }] as const),
			...unplacedWorks.map((work) => [
				work.workId,
				{ workId: work.workId, text: work.text },
			] as const),
		]).values(),
	]);
	const visibleRows = $derived.by(() => buildVisibleRows(snapshot, browsingProjection));
	const searchEntries = $derived([
		...suggestions.map((suggestion) => ({ kind: "suggestion" as const, value: suggestion })),
		...searchResults.map((result) => ({ kind: "result" as const, value: result })),
	]);
	const workingCopySaveStatus = $derived.by(() => {
		const failed = workingCopySaveStatuses.find((status) => status.phase === "failed");
		if (failed) return failed;
		const saving = workingCopySaveStatuses.find((status) => status.phase === "saving");
		if (saving) return saving;
		const unsaved = workingCopySaveStatuses.find((status) => status.phase === "unsaved");
		if (unsaved) return unsaved;
		return workingCopySaveStatuses[0];
	});
	const commandContext = $derived<CommandContext>({
		startupReady: startup.phase === "ready",
		selectedOccurrenceId: selectedId,
		hasSelectedBranch: Boolean(selectedBranchId),
		hasSelectedRecoverySnapshot: false,
		hasLinkTarget: false,
		quickCaptureText,
		quickCaptureSubmitting,
		ruleSource,
		ruleName,
		isHoisted: Boolean(browsingLocation.hoistOccurrenceId),
	});
	const commands = $derived(commandAvailability(commandContext));
	const commandPaletteCommands = $derived(commandPaletteItems(
		commandPaletteQuery,
		commandContext,
		vocabulary,
	));
	const activeCommandPaletteItem = $derived(
		commandPaletteActiveIndex < 0 ? null : commandPaletteCommands[commandPaletteActiveIndex] ?? null,
	);
	const shortcuts = validateShortcuts(COMMAND_DEFINITIONS.flatMap((command) =>
		command.shortcut ? [{ commandId: command.id, shortcut: command.shortcut }] : []
	));

	$effect(() => {
		const id = selectedId;
		if (id && startup.phase === "ready") void loadEmergence(id);
		else emergenceSuggestions = [];
	});

	$effect(() => {
		if (commandPaletteCommands.length === 0) {
			commandPaletteActiveIndex = -1;
		} else if (commandPaletteActiveIndex < 0 || commandPaletteActiveIndex >= commandPaletteCommands.length) {
			commandPaletteActiveIndex = 0;
		}
	});

	$effect(() => {
		const workId = selectedItem?.workId;
		if (workId && startup.phase === "ready") {
			void loadRevisions(workId);
			void loadWorkLineage(workId);
			if (selectedBranchId) void loadRecoverySnapshots(workId, selectedBranchId);
			else recoverySnapshots = [];
			void loadInternalReferenceBacklinks(workId);
		} else {
			revisions = [];
			recoverySnapshots = [];
			workLineage = null;
			internalReferenceBacklinks = [];
		}
	});

	onMount(() => {
		let cancelled = false;
		const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
			if (!autosave.hasUnsavedChanges()) return;
			event.preventDefault();
			event.returnValue = "";
		};
		const flushWhenHidden = () => {
			if (document.visibilityState === "hidden") {
				void autosave.flush().catch(() => {
					// The retained draft and failed status remain visible after returning.
				});
				void resumeAutosave.flush().catch(() => {
					// The latest position remains queued for a later flush.
				});
			}
		};
		const handleGlobalShortcut = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLocaleLowerCase() === "k") {
				event.preventDefault();
				if (commandPaletteOpen) void closeCommandPalette();
				else void openCommandPalette();
				return;
			}
			if (commandPaletteOpen && event.key === "Escape") {
				event.preventDefault();
				void closeCommandPalette();
				return;
			}
			if (event.defaultPrevented || isEditableTarget(event.target)) return;
			const shortcut = shortcutForKeyboardEvent(event);
			const binding = shortcuts.bindings.find((candidate) => candidate.shortcut === shortcut);
			if (!binding) return;
			event.preventDefault();
			void executeCommand(binding.commandId);
		};
		window.addEventListener("beforeunload", warnAboutUnsavedChanges);
		document.addEventListener("visibilitychange", flushWhenHidden);
		window.addEventListener("keydown", handleGlobalShortcut);
		async function monitorStartup(): Promise<void> {
			while (!cancelled) {
				try {
					startup = await api.getStartupStatus();
					if (startup.phase === "ready") {
						await load();
						aliases = await api.listSearchAliases();
						tags = await api.listTags();
						tagAliases = await api.listTagAliases();
						savedRuleQueries = await api.listSavedRuleQueries();
						return;
					}
				} catch (cause) {
					startup = { phase: "failed", message: "起動状態を取得できませんでした。", detail: errorMessage(cause) };
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}
		void monitorStartup();
		return () => {
			cancelled = true;
			window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
			document.removeEventListener("visibilitychange", flushWhenHidden);
			window.removeEventListener("keydown", handleGlobalShortcut);
			void autosave.flush().catch(() => {
				// beforeunload already warns while an unsaved draft exists.
			});
			void resumeAutosave.flush().catch(() => {
				// Resume persistence is best-effort during teardown.
			});
		};
	});

	async function retryStartup(): Promise<void> {
		startup = { phase: "starting", message: "再試行しています…", logPath: startup.logPath };
		startup = await api.retryStartup();
		if (startup.phase === "ready") await load();
	}

	async function load(focusId?: string): Promise<void> {
		try {
			error = "";
			const [next, nextGlobalLineage, nextBookmarks] = await Promise.all([
				api.listOutline(),
				api.listGlobalLineage(),
				api.listBookmarks(),
			]);
			const drafts = new Map(autosave.drafts().map((draft) => [draft.workId, draft.text]));
			next.items = next.items.map((item) => {
				const draft = drafts.get(item.workId);
				return draft === undefined ? item : { ...item, text: draft };
			});
			snapshot = next;
			internalReferenceCompletionRequest++;
			internalReferenceCompletion = null;
			browsing = reconcileBrowsingState(browsing, snapshot);
			selectedId = currentBrowsingLocation(browsing).selectedOccurrenceId;
			globalLineage = nextGlobalLineage;
			bookmarks = nextBookmarks;
			if (focusId) requestFocus(focusId);
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			loading = false;
		}
	}

	function buildVisibleRows(
		data: OutlineSnapshot,
		projection: ReturnType<typeof projectBrowsingOutline>,
	): VisibleRow[] {
		const stash = new Set(data.stashItemIds);
		const normalItems = projection.items.filter((item) => !stash.has(item.id));
		const normalIds = new Set(normalItems.map((item) => item.id));
		const children = new Map<string | null, OutlineItem[]>();
		for (const item of normalItems) {
			const parent = item.parentId && normalIds.has(item.parentId) ? item.parentId : null;
			const bucket = children.get(parent) ?? [];
			bucket.push(item);
			children.set(parent, bucket);
		}
		for (const bucket of children.values()) bucket.sort((a, b) => a.orderKey - b.orderKey);
		const rows: VisibleRow[] = [];
		const visit = (item: OutlineItem, depth: number) => {
			const descendants = item.referenceStub ? [] : children.get(item.id) ?? [];
			rows.push({ item, depth, hasChildren: descendants.length > 0, stash: false });
			if (!item.collapsed || transientExpandedIds.includes(item.id)) {
				descendants.forEach((child) => visit(child, depth + 1));
			}
		};
		projection.rootOccurrenceIds
			.map((id) => normalItems.find((item) => item.id === id))
			.filter((item): item is OutlineItem => Boolean(item))
			.forEach((root) => visit(root, 0));
		if (!browsingLocation.hoistOccurrenceId) {
			data.items.filter((item) => stash.has(item.id)).sort((a, b) => a.orderKey - b.orderKey)
				.forEach((item) => rows.push({ item, depth: 0, hasChildren: false, stash: true }));
		}
		return rows;
	}

	function selectOccurrence(id: string | null): void {
		selectedId = id;
		browsing = browseToOutlineOccurrence(browsing, snapshot, id);
	}

	function goBrowsingHistory(delta: -1 | 1): void {
		browsing = moveBrowsingHistory(browsing, delta);
		browsing = reconcileBrowsingState(browsing, snapshot);
		selectedId = currentBrowsingLocation(browsing).selectedOccurrenceId;
		transientExpandedIds = ancestorBreadcrumb(snapshot, selectedId).map((item) => item.id);
		if (selectedId) requestFocus(selectedId);
	}

	function hoistSelected(): void {
		if (!selectedId) return;
		transientExpandedIds = [...new Set([...transientExpandedIds, selectedId])];
		browsing = setBrowsingHoist(browsing, selectedId);
	}

	function clearHoist(): void {
		browsing = setBrowsingHoist(browsing, null);
	}

	function addBrowsingPane(): void {
		browsing = openBrowsingPane(browsing, `pane-${nextPaneNumber++}`);
	}

	function switchBrowsingPane(paneId: string): void {
		browsing = activateBrowsingPane(browsing, paneId);
		browsing = reconcileBrowsingState(browsing, snapshot);
		selectedId = currentBrowsingLocation(browsing).selectedOccurrenceId;
		transientExpandedIds = ancestorBreadcrumb(snapshot, selectedId).map((item) => item.id);
		if (selectedId) requestFocus(selectedId);
	}

	function openBreadcrumb(id: string): void {
		if (browsingLocation.hoistOccurrenceId) browsing = setBrowsingHoist(browsing, null);
		selectOccurrence(id);
	}

	async function createRoot(): Promise<void> {
		const roots = snapshot.items.filter((item) => item.parentId === null);
		const item = await api.createItem({
			text: "",
			parentId: null,
			afterId: roots.sort((a, b) => a.orderKey - b.orderKey).at(-1)?.id ?? null,
		});
		await load(item.id);
	}

	async function handleKeydown(
		event: KeyboardEvent,
		row: VisibleRow,
		textarea: HTMLTextAreaElement,
		compositionGuard = false,
	): Promise<void> {
		if (compositionGuard || event.isComposing || event.keyCode === 229) return;
		if (internalReferenceCompletion?.itemId === row.item.id) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const direction = event.key === "ArrowDown" ? 1 : -1;
				const count = internalReferenceCompletion.candidates.length;
				if (count) {
					internalReferenceCompletion.activeIndex =
						(internalReferenceCompletion.activeIndex + direction + count) % count;
				}
				return;
			}
			if ((event.key === "Enter" || event.key === "Tab") &&
				internalReferenceCompletion.candidates.length) {
				event.preventDefault();
				await applyInternalReferenceCompletion(
					row.item.id,
					internalReferenceCompletion.candidates[internalReferenceCompletion.activeIndex],
				);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				internalReferenceCompletion = null;
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			try {
				await autosave.flush(row.item.workId);
			} catch (cause) {
				error = errorMessage(cause);
				return;
			}
			const cursor = textarea.selectionStart;
			const left = row.item.text.slice(0, cursor);
			const right = row.item.text.slice(textarea.selectionEnd);
			await api.updateItemText(row.item.id, left);
			const created = await api.createItem({
				text: right,
				parentId: row.item.parentId,
				afterId: row.item.id,
			});
			await load(created.id);
			return;
		}
		if (event.key === "Tab") {
			event.preventDefault();
			if (event.shiftKey) await outdent(row.item);
			else await indent(row.item);
			return;
		}
		if (event.key === "Backspace" && row.item.text === "") {
			const siblings = siblingsOf(row.item).filter((item) => item.orderKey < row.item.orderKey);
			const previous = siblings.at(-1);
			if (previous) {
				event.preventDefault();
				try {
					await autosave.flush(row.item.workId);
				} catch (cause) {
					error = errorMessage(cause);
					return;
				}
				await api.deleteItem(row.item.id);
				await load(previous.id);
			}
			return;
		}
		if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
			event.preventDefault();
			await moveSibling(row.item, event.key === "ArrowUp" ? -1 : 1);
		}
	}

	function updateLocalText(id: string, textarea: HTMLTextAreaElement): void {
		const text = textarea.value;
		const item = snapshot.items.find((candidate) => candidate.id === id);
		if (!item) return;
		for (const placement of snapshot.items) {
			if (placement.workId === item.workId) placement.text = text;
		}
		autosave.queue(item.workId, id, text);
		resumeAutosave.queue(id, textarea.selectionStart);
		void updateInternalReferenceCompletion(id, textarea);
	}

	function updateEditorSelection(id: string, textarea: HTMLTextAreaElement): void {
		if (selectedId === id) resumeAutosave.queue(id, textarea.selectionStart);
	}

	async function updateInternalReferenceCompletion(
		itemId: string,
		textarea: HTMLTextAreaElement,
	): Promise<void> {
		const trigger = findInternalReferenceTrigger(
			textarea.value,
			textarea.selectionStart,
			textarea.selectionEnd,
		);
		if (!trigger) {
			internalReferenceCompletion = null;
			return;
		}
		const request = ++internalReferenceCompletionRequest;
		try {
			const candidates = await api.listInternalReferenceCompletions(trigger.query, 12);
			if (request !== internalReferenceCompletionRequest) return;
			internalReferenceCompletion = {
				itemId,
				range: trigger.range,
				candidates,
				activeIndex: 0,
			};
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function applyInternalReferenceCompletion(
		itemId: string,
		candidate: InternalReferenceCompletion,
	): Promise<void> {
		const state = internalReferenceCompletion;
		const item = snapshot.items.find((entry) => entry.id === itemId);
		if (!state || state.itemId !== itemId || !item) return;
		const textarea = document.querySelector<HTMLTextAreaElement>(
			`textarea[data-item-id="${CSS.escape(itemId)}"]`,
		);
		if (!textarea) return;
		internalReferenceCompletion = null;
		textarea.focus();
		textarea.setRangeText(
			candidate.canonicalMarkdown,
			state.range.start,
			state.range.end,
			"end",
		);
		textarea.dispatchEvent(new InputEvent("input", {
			bubbles: true,
			inputType: "insertReplacementText",
			data: candidate.canonicalMarkdown,
		}));
	}

	function referencesIn(text: string) {
		return parseMarkdownCandidates(text).internalReferences;
	}

	async function openInternalReference(
		markdown: string,
		scope: "work" | "revision",
		id: string,
		start?: number,
	): Promise<void> {
		try {
			const resolutions = await api.resolveInternalReferences(markdown);
			const resolution = resolutions.find((candidate) =>
				candidate.reference.scope === scope && candidate.reference.id === id &&
				(start === undefined || candidate.reference.range.start === start)
			);
			if (!resolution) {
				internalReferenceNotice = "参照を解析できませんでした。";
				return;
			}
			if (resolution.status !== "resolved" || !resolution.navigationTarget) {
				internalReferenceNotice = resolution.reason ?? "参照先へ移動できません。";
				return;
			}
			internalReferenceNotice = "";
			if (resolution.reference.scope === "revision" && resolution.revision) {
				if (resolution.navigationTarget.kind === "work") {
					internalReferenceNotice =
						`固定${vocabulary.revision}は存在しますが、所有${vocabulary.work}に表示可能な${vocabulary.occurrence}がありません。`;
					return;
				}
				await openNavigationTarget(resolution.navigationTarget);
				await loadRevisions(resolution.workId!);
				openRevisionComparison(resolution.revision.id);
				return;
			}
			await openNavigationTarget(resolution.navigationTarget);
		} catch (cause) {
			internalReferenceNotice = errorMessage(cause);
		}
	}

	async function openEditorInternalReference(destination: string): Promise<void> {
		const match = /^radiora:\/\/(work|revision)\/([^/?#\s]+)(?:#[^\s]*)?$/u.exec(destination);
		if (!match) return;
		await openInternalReference(
			`[ref](${destination})`,
			match[1] as "work" | "revision",
			match[2],
		);
	}

	async function loadInternalReferenceBacklinks(workId: string): Promise<void> {
		try {
			internalReferenceBacklinks = await api.listInternalReferenceBacklinks("work", workId);
		} catch (cause) {
			internalReferenceNotice = errorMessage(cause);
		}
	}

	async function openInternalReferenceBacklink(backlink: InternalReferenceBacklink): Promise<void> {
		const source = backlink.source;
		const markdown = source.scope === "work"
			? `[source](radiora://work/${source.workId})`
			: `[source](radiora://revision/${source.revisionId})`;
		await openInternalReference(
			markdown,
			source.scope,
			source.scope === "work" ? source.workId : source.revisionId,
		);
	}

	async function performQuickCapture(): Promise<void> {
		quickCaptureSubmitting = true;
		try {
			await api.quickCapture(quickCaptureText);
			quickCaptureText = "";
			await Promise.all([load(), loadUnplacedWorks()]);
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			quickCaptureSubmitting = false;
		}
	}

	async function loadUnplacedWorks(): Promise<void> {
		unplacedWorks = await api.listUnplacedWorks();
	}

	async function openUnplaced(): Promise<void> {
		try {
			await loadUnplacedWorks();
			viewMode = "unplaced";
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function updateUnplacedText(work: UnplacedWork, text: string): Promise<void> {
		try {
			await api.updateUnplacedWorkText(work.workId, text);
			await loadUnplacedWorks();
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function placeUnplaced(workId: string, parentId: string | null): Promise<void> {
		try {
			const created = await api.placeUnplacedWork({ workId, parentId });
			await Promise.all([load(created.id), loadUnplacedWorks()]);
			viewMode = "outline";
			selectOccurrence(created.id);
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function linkUnplaced(workId: string): Promise<void> {
		const targetId = unplacedLinkTargets[workId]?.trim();
		if (!targetId) return;
		try {
			const unplacedIsTarget = unplacedLinkDirections[workId] === "to";
			await api.createLink({
				fromId: unplacedIsTarget ? targetId : workId,
				toId: unplacedIsTarget ? workId : targetId,
				type: unplacedLinkType,
			});
			unplacedLinkTargets[workId] = "";
			await load();
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function openToday(): Promise<void> {
		const now = new Date();
		dateStart = localDateValue(now);
		dateEnd = localDateValue(addDays(now, 1));
		await loadDateProjection();
	}

	async function loadDateProjection(): Promise<void> {
		try {
			dateProjectionLoading = true;
			dateProjection = await api.projectDates(dateRangeFromInputs(dateStart, dateEnd));
			viewMode = "today";
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			dateProjectionLoading = false;
		}
	}

	async function moveDateRange(days: number): Promise<void> {
		const start = new Date(`${dateStart}T00:00:00`);
		const end = new Date(`${dateEnd}T00:00:00`);
		dateStart = localDateValue(addDays(start, days));
		dateEnd = localDateValue(addDays(end, days));
		await loadDateProjection();
	}

	async function showWeek(): Promise<void> {
		const today = new Date();
		const offset = (today.getDay() + 6) % 7;
		const monday = addDays(today, -offset);
		dateStart = localDateValue(monday);
		dateEnd = localDateValue(addDays(monday, 7));
		await loadDateProjection();
	}

	async function openDateEntry(entry: DateProjection["created"][number]): Promise<void> {
		const occurrence = entry.representative;
		if (!occurrence) {
			error = `この${vocabulary.work}には表示できる${vocabulary.occurrence}がありません。`;
			return;
		}
		const placement = entry.placements.find((candidate) => candidate.occurrence.id === occurrence.id);
		await openNavigationTarget({
			kind: "occurrence",
			workId: entry.work.id,
			occurrenceId: occurrence.id,
			ancestorOccurrenceIds: placement?.breadcrumb.map((item) => item.id) ?? [],
			fellBack: false,
		});
	}

	async function performAddBookmark(): Promise<void> {
		if (!selectedId) return;
		await api.createBookmark(selectedId);
		bookmarks = await api.listBookmarks();
	}

	async function removeBookmark(id: string): Promise<void> {
		await api.deleteBookmark(id);
		bookmarks = await api.listBookmarks();
	}

	async function openBookmark(id: string): Promise<void> {
		const resolved = await api.resolveBookmark(id);
		await openNavigationTarget(resolved.target);
	}

	async function resumeEditing(): Promise<void> {
		const resolved = await api.resolveResumePosition();
		if (!resolved) return;
		await openNavigationTarget(resolved.target, resolved.resolvedCaretOffset);
	}

	async function openNavigationTarget(target: NavigationTarget, caretOffset?: number): Promise<void> {
		viewMode = "outline";
		const state = navigationUiState(target, caretOffset);
		if (!state.selectedOccurrenceId) {
			selectOccurrence(null);
			error = `この${vocabulary.work}には表示できる${vocabulary.occurrence}がありません。`;
			return;
		}
		transientExpandedIds = state.temporaryExpandedOccurrenceIds;
		selectOccurrence(state.selectedOccurrenceId);
		await load();
		requestFocus(state.selectedOccurrenceId, state.caretOffset);
	}

	async function loadRevisions(workId: string): Promise<void> {
		const request = ++revisionLoadRequest;
		revisionsLoading = true;
		try {
			const next = await api.listRevisions(workId);
			if (request === revisionLoadRequest && selectedItem?.workId === workId) revisions = next;
		} catch (cause) {
			if (request === revisionLoadRequest) error = errorMessage(cause);
		} finally {
			if (request === revisionLoadRequest) revisionsLoading = false;
		}
	}

	async function loadRecoverySnapshots(workId: string, branchId: string): Promise<void> {
		try {
			recoverySnapshots = await api.listRecoverySnapshots(workId, branchId);
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function restoreRecoverySnapshot(snapshotId: string): Promise<void> {
		if (!selectedItem || !selectedBranchId) return;
		await autosave.flush();
		await api.restoreRecoverySnapshot(
			snapshotId,
			selectedItem.workId,
			selectedBranchId,
			"confirmed",
		);
		await load();
		await loadRecoverySnapshots(selectedItem.workId, selectedBranchId);
	}

	async function performPromoteRecoverySnapshot(snapshotId: string): Promise<void> {
		if (!selectedItem || !selectedBranchId) return;
		await api.promoteRecoverySnapshot(
			snapshotId,
			selectedItem.workId,
			selectedBranchId,
			"confirmed",
		);
		await Promise.all([
			loadRevisions(selectedItem.workId),
			loadWorkLineage(selectedItem.workId),
			loadRecoverySnapshots(selectedItem.workId, selectedBranchId),
		]);
	}

	async function loadWorkLineage(workId: string): Promise<void> {
		const request = ++workLineageLoadRequest;
		workLineageLoading = true;
		try {
			const next = await api.listWorkLineage(workId);
			if (request === workLineageLoadRequest && selectedItem?.workId === workId) {
				workLineage = next;
			}
		} catch (cause) {
			if (request === workLineageLoadRequest) error = errorMessage(cause);
		} finally {
			if (request === workLineageLoadRequest) workLineageLoading = false;
		}
	}

	function openRevisionComparison(revisionId: string): void {
		comparisonRequest++;
		linkComparison = null;
		workComparison = null;
		comparisonPreferredRevisionId = revisionId;
		viewMode = "comparison";
	}

	function openSelectedRevisionComparison(): void {
		openRevisionComparison(
			selectedItem?.revisionSelector.mode === "pinned"
				? selectedItem.revisionSelector.revisionId
				: "",
		);
	}

	async function openWorkComparison(
		scope: "branch" | "revision",
		id: string,
	): Promise<void> {
		if (!selectedItem) return;
		const requestedWorkId = selectedItem.workId;
		const request = ++comparisonRequest;
		linkComparison = null;
		workComparison = null;
		try {
			const result = await api.listWorkComparisonDocuments(requestedWorkId);
			if (request !== comparisonRequest || selectedItem?.workId !== requestedWorkId) return;
			const selected = result.documents.find((document) =>
				document.scope === scope &&
				(scope === "branch" ? document.branchId === id : document.revisionId === id)
			);
			if (!selected) throw new Error(`${vocabulary.comparisonPane}対象が見つかりません。`);
			const key = comparisonDocumentKey(selected);
			linkComparison = null;
			workComparison = {
				...result,
				...(scope === "revision" ? { preferredRightKey: key } : { preferredLeftKey: key }),
			};
			viewMode = "comparison";
		} catch (cause) {
			if (request !== comparisonRequest) return;
			linkComparison = null;
			workComparison = null;
			error = errorMessage(cause);
		}
	}

	async function openLinkComparison(linkId: string): Promise<void> {
		const request = ++comparisonRequest;
		linkComparison = null;
		workComparison = null;
		try {
			const result = await api.resolveLinkComparison(linkId);
			if (request !== comparisonRequest) return;
			linkComparison = result;
			viewMode = "comparison";
		} catch (cause) {
			if (request !== comparisonRequest) return;
			linkComparison = null;
			workComparison = null;
			error = errorMessage(cause);
		}
	}

	async function retryWorkingCopySave(): Promise<void> {
		try {
			await autosave.retry();
		} catch {
			// The coordinator retains the draft and exposes the failure detail.
		}
	}

	async function indent(item: OutlineItem): Promise<void> {
		const siblings = siblingsOf(item);
		const index = siblings.findIndex((candidate) => candidate.id === item.id);
		if (index <= 0) return;
		const parent = siblings[index - 1];
		const children = snapshot.items.filter((candidate) => candidate.parentId === parent.id)
			.sort((a, b) => a.orderKey - b.orderKey);
		await api.moveItem({ id: item.id, parentId: parent.id, afterId: children.at(-1)?.id ?? null });
		await load(item.id);
	}

	async function outdent(item: OutlineItem): Promise<void> {
		if (!item.parentId) return;
		const parent = itemById.get(item.parentId);
		if (!parent) return;
		await api.moveItem({ id: item.id, parentId: parent.parentId, afterId: parent.id });
		await load(item.id);
	}

	async function moveSibling(item: OutlineItem, direction: -1 | 1): Promise<void> {
		const siblings = siblingsOf(item);
		const index = siblings.findIndex((candidate) => candidate.id === item.id);
		const targetIndex = index + direction;
		if (targetIndex < 0 || targetIndex >= siblings.length) return;
		const afterId = direction < 0 ? (siblings[targetIndex - 1]?.id ?? null) : siblings[targetIndex].id;
		await api.moveItem({ id: item.id, parentId: item.parentId, afterId });
		await load(item.id);
	}

	function siblingsOf(item: OutlineItem): OutlineItem[] {
		return snapshot.items.filter((candidate) => candidate.parentId === item.parentId)
			.sort((a, b) => a.orderKey - b.orderKey);
	}

	async function toggle(row: VisibleRow): Promise<void> {
		await api.setCollapsed(row.item.id, !row.item.collapsed);
		await load();
	}

	async function remove(id: string): Promise<void> {
		const item = itemById.get(id);
		if (item) {
			try {
				await autosave.flush(item.workId);
			} catch (cause) {
				error = errorMessage(cause);
				return;
			}
		}
		await api.deleteItem(id);
		if (selectedId === id) selectOccurrence(null);
		await load();
	}

	async function dropOn(target: OutlineItem): Promise<void> {
		if (!draggedId || draggedId === target.id) return;
		await api.moveItem({ id: draggedId, parentId: target.parentId, afterId: target.id });
		const moved = draggedId;
		draggedId = null;
		await load(moved);
	}

	let suggestTimer: number | undefined;
	let searchTimer: number | undefined;
	let searchRequestId = 0;
	function queueSearch(): void {
		clearTimeout(suggestTimer);
		clearTimeout(searchTimer);
		const requestId = ++searchRequestId;
		searchActiveIndex = -1;
		if (!searchQuery.trim()) {
			suggestions = [];
			searchResults = [];
			return;
		}
		suggestTimer = window.setTimeout(async () => {
			try {
				const next = await api.suggestItems(searchQuery, 8);
				if (requestId === searchRequestId) suggestions = next;
			} catch (cause) {
				if (requestId === searchRequestId) error = errorMessage(cause);
			}
		}, 100);
		searchTimer = window.setTimeout(async () => {
			try {
				const next = await api.searchItems({ query: searchQuery, contextItemId: selectedId, limit: 20 });
				if (requestId === searchRequestId) searchResults = next;
			} catch (cause) {
				if (requestId === searchRequestId) error = errorMessage(cause);
			}
		}, 250);
	}

	function handleSearchKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			searchQuery = "";
			suggestions = [];
			searchResults = [];
			searchActiveIndex = -1;
			return;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const delta = event.key === "ArrowDown" ? 1 : -1;
			searchActiveIndex = Math.max(-1, Math.min(searchEntries.length - 1, searchActiveIndex + delta));
			return;
		}
		if (event.key === "Enter" && searchActiveIndex >= 0) {
			event.preventDefault();
			const entry = searchEntries[searchActiveIndex];
			if (entry.kind === "suggestion") void selectItem(entry.value.item, entry.value.ancestorIds);
			else void selectItem(entry.value.item, entry.value.ancestorIds);
		}
	}

	async function selectSearch(result: SearchResult): Promise<void> {
		await selectItem(result.item, result.ancestorIds);
	}

	async function selectItem(item: OutlineItem, ancestorIds: string[]): Promise<void> {
		transientExpandedIds = ancestorIds;
		searchQuery = "";
		suggestions = [];
		searchResults = [];
		searchActiveIndex = -1;
		selectOccurrence(item.id);
		await load(item.id);
	}

	async function loadEmergence(id: string): Promise<void> {
		emergenceLoading = true;
		try {
			emergenceSuggestions = await api.listEmergenceSuggestions(id, 10);
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			emergenceLoading = false;
		}
	}

	async function resolveEmergence(suggestion: EmergenceSuggestion, action: EmergenceAction): Promise<void> {
		await api.resolveEmergenceSuggestion(suggestion.id, action);
		if (action === "accept") await load();
		if (selectedId) await loadEmergence(selectedId);
	}

	async function saveAlias(): Promise<void> {
		try {
			await api.saveSearchAlias({
				canonical: aliasCanonical,
				variants: aliasVariants.split(/[,、\n]/).map((value) => value.trim()).filter(Boolean),
			});
			aliasCanonical = "";
			aliasVariants = "";
			aliases = await api.listSearchAliases();
		} catch (cause) {
			ruleError = errorMessage(cause);
		}
	}

	async function removeAlias(id: string): Promise<void> {
		await api.deleteSearchAlias(id);
		aliases = await api.listSearchAliases();
	}

	async function performExecuteRule(): Promise<void> {
		ruleError = "";
		ruleResult = null;
		try {
			ruleResult = await api.runRuleQuery(ruleSource, 500);
		} catch (cause) {
			ruleError = errorMessage(cause);
		}
	}

	async function performSaveRule(): Promise<void> {
		ruleError = "";
		try {
			await api.saveRuleQuery({ name: ruleName, source: ruleSource });
			savedRuleQueries = await api.listSavedRuleQueries();
			ruleName = "";
		} catch (cause) {
			ruleError = errorMessage(cause);
		}
	}

	async function removeRule(id: string): Promise<void> {
		await api.deleteRuleQuery(id);
		savedRuleQueries = await api.listSavedRuleQueries();
	}

	async function performAddLink(input: CreateLinkInput): Promise<void> {
		await api.createLink(input);
		await load();
	}

	async function removeLink(link: OutlineLink): Promise<void> {
		await api.deleteLink(link.fromId, link.toId, link.type);
		await load();
	}

	function requestFocus(id: string, caretOffset?: number): void {
		setTimeout(() => {
			const element = document.querySelector<HTMLTextAreaElement>(`[data-item-id="${id}"]`);
			element?.focus();
			const caret = Math.min(caretOffset ?? element?.value.length ?? 0, element?.value.length ?? 0);
			element?.setSelectionRange(caret, caret);
			element?.scrollIntoView({ block: "center" });
		}, 0);
	}

	function otherName(link: OutlineLink): string {
		const id = link.fromId === selectedItem?.workId ? link.toId : link.fromId;
		const item = itemByWorkId.get(id);
		return item ? titleFor(item) : `(空の${vocabulary.work})`;
	}

	function splitTagInput(value: string): string[] {
		return value.split(/[,、\s]+/).map((tag) => tag.trim()).filter(Boolean);
	}

	async function searchByTags(): Promise<void> {
		tagError = "";
		try {
			tagMatches = await api.searchTags({
				all: splitTagInput(tagAll),
				none: splitTagInput(tagNone),
				historyRevisionIds: splitTagInput(tagHistoryRevisionIds),
			});
		} catch (cause) {
			tagError = errorMessage(cause);
		}
	}

	async function renameTag(): Promise<void> {
		tagError = "";
		try {
			await api.renameTag(tagRenameFrom, tagRenameTo);
			tagRenameFrom = "";
			tagRenameTo = "";
			tags = await api.listTags();
			tagAliases = await api.listTagAliases();
			if (tagAll) await searchByTags();
		} catch (cause) {
			tagError = errorMessage(cause);
		}
	}

	async function mergeTags(): Promise<void> {
		tagError = "";
		try {
			await api.mergeTags(splitTagInput(tagMergeSources), tagMergeTarget);
			tagMergeSources = "";
			tagMergeTarget = "";
			tags = await api.listTags();
			tagAliases = await api.listTagAliases();
			if (tagAll) await searchByTags();
		} catch (cause) {
			tagError = errorMessage(cause);
		}
	}

	async function duplicateSelectedOccurrence(): Promise<void> {
		if (!selectedItem) return;
		try {
			await autosave.flush(selectedItem.workId);
		} catch (cause) {
			error = errorMessage(cause);
			return;
		}
		const created = await api.createOccurrence({
			workId: selectedItem.workId,
			parentId: selectedItem.parentId,
			afterId: selectedItem.id,
		});
		await load(created.id);
	}

	async function updateSelectedHeading(value: string): Promise<void> {
		if (!selectedItem) return;
		await api.setContextualHeading(selectedItem.id, value);
		await load(selectedItem.id);
	}

	async function trashSelectedWork(): Promise<void> {
		if (!selectedItem) return;
		const count = snapshot.items.filter((item) => item.workId === selectedItem.workId).length;
		await requestConfirmation({ action: "trash", occurrenceId: selectedItem.id, occurrenceCount: count });
	}

	async function openTrash(): Promise<void> {
		trashEntries = await api.listTrash();
		viewMode = "trash";
	}

	async function restoreTrash(workId: string): Promise<void> {
		await api.restoreWork(workId);
		trashEntries = await api.listTrash();
		await load();
	}

	async function executeCommand(
		id: CommandId,
		snapshotId?: string,
		linkInput?: CreateLinkInput,
	): Promise<void> {
		const executionContext: CommandContext = snapshotId
			? { ...commandContext, hasSelectedRecoverySnapshot: true }
			: linkInput
			? { ...commandContext, hasLinkTarget: true }
			: commandContext;
		const result = await dispatchCommand(id, executionContext, async (commandId) => {
			switch (commandId) {
				case "quickCapture": await performQuickCapture(); break;
				case "hoist": hoistSelected(); break;
				case "clearHoist": clearHoist(); break;
				case "addBookmark": await performAddBookmark(); break;
				case "createLink": if (linkInput) await performAddLink(linkInput); break;
				case "runQuery": await performExecuteRule(); break;
				case "saveQuery": await performSaveRule(); break;
				case "saveRevision": if (snapshotId) await performPromoteRecoverySnapshot(snapshotId); break;
				case "createBranch": break;
			}
		});
		if (!result.executed && result.reason) error = result.reason;
	}

	async function openCommandPalette(): Promise<void> {
		commandPaletteRestoreFocus = document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
		commandPaletteQuery = "";
		commandPaletteActiveIndex = 0;
		commandPaletteOpen = true;
		await tick();
		commandPaletteInput?.focus();
	}

	async function closeCommandPalette(): Promise<void> {
		commandPaletteOpen = false;
		await tick();
		commandPaletteRestoreFocus?.focus();
		commandPaletteRestoreFocus = null;
	}

	function handleCommandPaletteKeydown(event: KeyboardEvent): void {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			commandPaletteActiveIndex = nextCommandPaletteIndex(
				commandPaletteActiveIndex,
				event.key === "ArrowDown" ? 1 : -1,
				commandPaletteCommands.length,
			);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			if (activeCommandPaletteItem) executeCommandPaletteItem(activeCommandPaletteItem);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			void closeCommandPalette();
		}
	}

	function executeCommandPaletteItem(command: CommandPaletteItem): void {
		if (!command?.availability.enabled) return;
		void executeCommand(command.id);
		void closeCommandPalette();
	}

	function captureQuickText(): void { void executeCommand("quickCapture"); }
	function requestHoist(): void { void executeCommand("hoist"); }
	function requestClearHoist(): void { void executeCommand("clearHoist"); }
	function addBookmark(): void { void executeCommand("addBookmark"); }
	function executeRule(): void { void executeCommand("runQuery"); }
	function saveRule(): void { void executeCommand("saveQuery"); }
	function promoteRecoverySnapshot(snapshotId: string): Promise<void> {
		return executeCommand("saveRevision", snapshotId);
	}

	async function purgeTrash(entry: TrashEntry): Promise<void> {
		await requestConfirmation({
			action: "purge",
			workId: entry.work.id,
			occurrenceCount: entry.occurrenceCount,
			linkCount: entry.linkCount,
		});
	}

	async function requestConfirmation(confirmation: PendingConfirmation): Promise<void> {
		if (pendingConfirmation) return;
		pendingConfirmation = confirmation;
		await tick();
		if (!confirmationDialog.open) confirmationDialog.showModal();
	}

	function closeConfirmation(): void {
		if (!confirmationSubmitting) confirmationDialog.close();
	}

	function resetConfirmation(): void {
		if (!confirmationSubmitting) pendingConfirmation = null;
	}

	function preventCloseWhileSubmitting(event: Event): void {
		if (confirmationSubmitting) event.preventDefault();
	}

	async function confirmPendingAction(): Promise<void> {
		const confirmation = pendingConfirmation;
		if (!confirmation || confirmationSubmitting) return;
		confirmationSubmitting = true;
		try {
			await autosave.flush();
			if (confirmation.action === "trash") {
				await api.trashWork(confirmation.occurrenceId);
				selectOccurrence(null);
				await load();
			} else {
				await api.purgeWork(confirmation.workId);
				trashEntries = await api.listTrash();
				bookmarks = await api.listBookmarks();
			}
		} catch (cause) {
			error = errorMessage(cause);
			return;
		} finally {
			confirmationSubmitting = false;
		}
		pendingConfirmation = null;
		confirmationDialog.close();
	}

	function titleFor(item: OutlineItem): string {
		return item.contextualHeading ??
			item.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ??
			`(空の${vocabulary.work})`;
	}

	function titleForId(id: string): string {
		const item = itemById.get(id);
		return item ? titleFor(item) : id;
	}

	function bodyFor(item: OutlineItem): string {
		const lines = item.text.split(/\r?\n/);
		const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
		return firstContentIndex < 0 ? "" : lines.slice(firstContentIndex + 1).join("\n").trim();
	}

	function formatCreatedAt(value: string): string {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? "不明" : date.toLocaleDateString("ja-JP");
	}

	function localDateValue(date: Date): string {
		const offset = date.getTimezoneOffset() * 60_000;
		return new Date(date.getTime() - offset).toISOString().slice(0, 10);
	}

	function addDays(date: Date, days: number): Date {
		const copy = new Date(date);
		copy.setDate(copy.getDate() + days);
		return copy;
	}

	function dateRangeFromInputs(start: string, end: string): DateRange {
		const startDate = new Date(`${start}T00:00:00`);
		const endDate = new Date(`${end}T00:00:00`);
		if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
			throw new Error("開始日と終了日を入力してください。");
		}
		return { startInclusive: startDate.toISOString(), endExclusive: endDate.toISOString() };
	}

	function errorMessage(cause: unknown): string {
		if (typeof cause === "object" && cause && "message" in cause) return String(cause.message);
		return String(cause);
	}
</script>

<svelte:head><title>Radiora v2 PoC</title></svelte:head>

{#if commandPaletteOpen}
	<dialog
		open
		class="command-palette"
		aria-modal="true"
		aria-label={vocabulary.commandPalette}
	>
		<div class="command-palette__content">
			<input
				bind:this={commandPaletteInput}
				bind:value={commandPaletteQuery}
				aria-label={`${vocabulary.commandPalette}を検索`}
				aria-controls="command-palette-results"
				aria-activedescendant={activeCommandPaletteItem
					? `command-palette-${activeCommandPaletteItem.id}`
					: undefined}
				placeholder={`${vocabulary.commandPalette}を検索…`}
				onkeydown={handleCommandPaletteKeydown}
				autocomplete="off"
			/>
			<div id="command-palette-results" role="listbox" aria-label={vocabulary.commandPalette}>
				{#each commandPaletteCommands as command, index (command.id)}
					<button
						id={`command-palette-${command.id}`}
						class:active={index === commandPaletteActiveIndex}
						role="option"
						aria-selected={index === commandPaletteActiveIndex}
						disabled={!command.availability.enabled}
						title={command.availability.reason}
						onclick={() => executeCommandPaletteItem(command)}
					>
						<span>{command.label}</span>
						{#if command.shortcut}<small>{command.shortcut}</small>{/if}
					</button>
				{/each}
				{#if commandPaletteCommands.length === 0}<p>一致するコマンドはありません。</p>{/if}
			</div>
			{#if activeCommandPaletteItem && !activeCommandPaletteItem.availability.enabled}
				<p class="command-palette__reason" aria-live="polite">
					{activeCommandPaletteItem.availability.reason}
				</p>
			{/if}
		</div>
	</dialog>
{/if}

<div class="shell">
	<header>
		<div class="brand"><strong>Radiora</strong><span>v2</span></div>
		<nav class="view-switcher" aria-label="表示モード">
			<button class:active={viewMode === "outline"} aria-pressed={viewMode === "outline"}
				onclick={() => (viewMode = "outline")}>Outline</button>
			<button class:active={viewMode === "today"} aria-pressed={viewMode === "today"}
				onclick={openToday}>{vocabulary.today}</button>
			<button class:active={viewMode === "unplaced"} aria-pressed={viewMode === "unplaced"}
				onclick={openUnplaced}>{vocabulary.unplacedInbox}</button>
			<button class:active={viewMode === "globalLineage"} aria-pressed={viewMode === "globalLineage"}
				onclick={() => (viewMode = "globalLineage")}>{vocabulary.globalLineage}</button>
			<button class:active={viewMode === "workLineage"} aria-pressed={viewMode === "workLineage"}
				onclick={() => (viewMode = "workLineage")} disabled={!selectedItem}>{vocabulary.workLineage}</button>
			<button class:active={viewMode === "comparison"} aria-pressed={viewMode === "comparison"}
				onclick={openSelectedRevisionComparison} disabled={!selectedItem}>
				{vocabulary.revision}{vocabulary.comparisonPane}
			</button>
			<button class:active={viewMode === "trash"} aria-pressed={viewMode === "trash"}
				onclick={openTrash}>ゴミ箱</button>
		</nav>
		<form class="quick-capture" onsubmit={(event) => { event.preventDefault(); void captureQuickText(); }}>
			<input
				aria-label={vocabulary.quickCapture}
				placeholder={`${vocabulary.quickCapture}…`}
				bind:value={quickCaptureText}
				disabled={startup.phase !== "ready" || quickCaptureSubmitting}
			/>
			<button disabled={!commands.quickCapture.enabled} title={commands.quickCapture.reason}>
				{quickCaptureSubmitting ? "保存中…" : vocabulary.quickCapture}
			</button>
		</form>
		<button onclick={resumeEditing}>{vocabulary.resumePosition}から再開</button>
		{#each bookmarks as bookmark}
			<span class="bookmark-control">
				<button onclick={() => openBookmark(bookmark.id)}>{vocabulary.bookmark} {bookmark.id.slice(0, 4)}</button>
				<button aria-label={`${vocabulary.bookmark}を削除`} onclick={() => removeBookmark(bookmark.id)}>×</button>
			</span>
		{/each}
		<div class="search-wrap" class:disabled={startup.phase !== "ready"}>
			<input aria-label="思索を検索" placeholder="思索を検索…" bind:value={searchQuery}
				oninput={queueSearch} onkeydown={handleSearchKeydown} autocomplete="off"
				aria-expanded={searchEntries.length > 0} />
			{#if searchEntries.length}
				<div class="search-results" role="listbox" aria-label="検索候補">
					{#if suggestions.length}<p class="search-section">タイトル</p>{/if}
					{#each suggestions as suggestion, index}
						<button class:active={searchActiveIndex === index}
							onclick={() => selectItem(suggestion.item, suggestion.ancestorIds)}>
							<strong>{suggestion.title || `(空の${vocabulary.work})`}</strong>
							<small>先頭一致</small>
						</button>
					{/each}
					{#if searchResults.length}<p class="search-section">本文・関連</p>{/if}
					{#each searchResults as result, index}
						<button class:active={searchActiveIndex === suggestions.length + index}
							onclick={() => selectSearch(result)}>
							<strong>{titleFor(result.item)}</strong>
							<small>{result.reasons.map((reason) => reason.label).slice(0, 2).join(" · ")}</small>
						</button>
					{/each}
				</div>
			{/if}
		</div>
		{#if workingCopySaveStatus}
			<div
				class="working-copy-save-status"
				class:failed={workingCopySaveStatus.phase === "failed"}
				class:pending={workingCopySaveStatus.phase === "unsaved" ||
					workingCopySaveStatus.phase === "saving"}
				aria-live="polite"
				title={workingCopySaveStatus.error}
			>
				<span>
					{workingCopySaveStatus.phase === "failed"
						? `${vocabulary.workingCopy}を保存できませんでした`
						: workingCopySaveStatus.phase === "saving"
						? `${vocabulary.workingCopy}を保存中…`
						: workingCopySaveStatus.phase === "unsaved"
						? `未保存の${vocabulary.workingCopy}があります`
						: `${vocabulary.workingCopy}を保存しました`}
				</span>
				{#if workingCopySaveStatus.phase === "failed"}
					<button onclick={retryWorkingCopySave}>再試行</button>
				{/if}
			</div>
		{/if}
	</header>

	{#if error}<div class="error">{error}<button onclick={() => (error = "")}>×</button></div>{/if}

	{#if startup.phase !== "ready"}
		<main class="startup-main">
			<section class="startup-card" aria-live="polite">
				<div class:failed={startup.phase === "failed"} class="startup-indicator"></div>
				<p class="eyebrow">{startup.phase === "failed" ? "STARTUP FAILED" : "STARTING"}</p>
				<h1>{startup.message}</h1>
				{#if startup.detail}<p class="startup-detail">{startup.detail}</p>{/if}
				{#if startup.logPath}<p class="startup-log">診断ログ: <code>{startup.logPath}</code></p>{/if}
				{#if startup.phase === "failed"}<button class="retry" onclick={retryStartup}>再試行</button>{/if}
			</section>
		</main>
	{:else}
	<main>
		{#if viewMode === "outline"}
			<section class="outline-panel">
				<nav class="browsing-navigation" aria-label={vocabulary.browsingHistory}>
					<div class="history-controls">
						<button
							aria-label={`${vocabulary.browsingHistory}を戻る`}
							disabled={!canMoveBrowsingHistory(browsing, -1)}
							onclick={() => goBrowsingHistory(-1)}
						>←</button>
						<button
							aria-label={`${vocabulary.browsingHistory}を進む`}
							disabled={!canMoveBrowsingHistory(browsing, 1)}
							onclick={() => goBrowsingHistory(1)}
						>→</button>
						<button onclick={requestHoist} disabled={!commands.hoist.enabled} title={commands.hoist.reason}>{vocabulary.hoist}</button>
						{#if browsingLocation.hoistOccurrenceId}
							<button onclick={requestClearHoist} disabled={!commands.clearHoist.enabled} title={commands.clearHoist.reason}>{vocabulary.hoist}を解除</button>
						{/if}
					</div>
					<div class="pane-controls" aria-label={vocabulary.pane}>
						{#each browsing.panes as pane, index (pane.id)}
							<button
								class:active={pane.id === browsingPane.id}
								aria-pressed={pane.id === browsingPane.id}
								onclick={() => switchBrowsingPane(pane.id)}
							>{vocabulary.pane} {index + 1}</button>
						{/each}
						<button aria-label={`新しい${vocabulary.pane}`} onclick={addBrowsingPane}>＋</button>
					</div>
					{#if selectedBreadcrumb.length || selectedItem}
						<div class="breadcrumb" aria-label={vocabulary.breadcrumb}>
							{#each selectedBreadcrumb as ancestor (ancestor.id)}
								<button onclick={() => openBreadcrumb(ancestor.id)}>{titleFor(ancestor)}</button>
								<span aria-hidden="true">›</span>
							{/each}
							{#if selectedItem}<span aria-current="page">{titleFor(selectedItem)}</span>{/if}
						</div>
					{/if}
				</nav>
				<div class="section-title">
					<span>Outline</span>
					<button onclick={addBookmark} disabled={!commands.addBookmark.enabled} title={commands.addBookmark.reason}>☆ {vocabulary.bookmark}</button>
					<button onclick={createRoot}>＋ Root</button>
				</div>
				{#if loading}
					<p class="empty">Loading…</p>
				{:else if snapshot.items.length === 0}
					<button class="first-item" onclick={createRoot}>最初の{vocabulary.work}を作る</button>
				{:else}
					<div class="rows">
						{#each visibleRows.filter((row) => !row.stash) as row (row.item.id)}
							<div class:selected={selectedId === row.item.id} class="row" style={`--depth:${row.depth}`} role="treeitem"
								aria-selected={selectedId === row.item.id} tabindex="-1"
								draggable="true" ondragstart={() => draggedId = row.item.id}
								ondragover={(event) => event.preventDefault()} ondrop={() => dropOn(row.item)}>
								<button class="disclosure" class:hidden={!row.hasChildren} onclick={() => toggle(row)}>{row.item.collapsed ? "›" : "⌄"}</button>
								{#if row.item.referenceStub}<span class="reference-stub" title="再帰参照">↩</span>{/if}
								<button class="bullet" aria-label={`${vocabulary.work}を選択`} onclick={() => selectOccurrence(row.item.id)}>•</button>
								<div class="internal-reference-editor">
									<MarkdownEditor
										value={row.item.text}
										itemId={row.item.id}
										onFocus={() => selectOccurrence(row.item.id)}
										onChange={(_value, textarea) => updateLocalText(row.item.id, textarea)}
										onSelectionChange={(textarea) => updateEditorSelection(row.item.id, textarea)}
										onKeydown={(event, textarea, compositionGuard) =>
											handleKeydown(event, row, textarea, compositionGuard)}
										onInternalReference={openEditorInternalReference}
									/>
									{#if internalReferenceCompletion?.itemId === row.item.id}
										<div class="internal-reference-completions" role="listbox"
											aria-label={`${vocabulary.internalReference}候補`}>
											{#each internalReferenceCompletion.candidates as candidate, index (candidate.scope + candidate.id)}
												<button class:active={index === internalReferenceCompletion.activeIndex}
													role="option" aria-selected={index === internalReferenceCompletion.activeIndex}
													onmousedown={(event) => event.preventDefault()}
													onclick={() => applyInternalReferenceCompletion(row.item.id, candidate)}>
													<strong>{candidate.displayName}</strong>
													<span>{candidate.scopeLabel} · {candidate.shortId}</span>
												</button>
											{:else}
												<p>一致する候補はありません。</p>
											{/each}
										</div>
									{/if}
									{#if referencesIn(row.item.text).length}
										<div class="internal-reference-chips" aria-label={vocabulary.internalReference}>
											{#each referencesIn(row.item.text) as reference (reference.range.start)}
												<button onclick={() => openInternalReference(
													row.item.text,
													reference.scope,
													reference.id,
													reference.range.start,
												)}>
													{reference.scope === "work" ? vocabulary.work : vocabulary.revision}
													· {reference.id.slice(0, 8)}
												</button>
											{/each}
										</div>
									{/if}
								</div>
								<button class="delete" title={`この${vocabulary.occurrence}を外す`} onclick={() => remove(row.item.id)}>×</button>
							</div>
						{/each}
					</div>
				{/if}

				{#if snapshot.stashItemIds.length}
					<div class="section-title stash-title"><span>Stash / Knots</span><small>{snapshot.knots.length} knot</small></div>
					<div class="stash-list">
						{#each visibleRows.filter((row) => row.stash) as row (row.item.id)}
							<button class:selected={selectedId === row.item.id} onclick={() => selectOccurrence(row.item.id)}>
								<span>∞</span>{row.item.text || `(空の${vocabulary.work})`}
							</button>
						{/each}
					</div>
				{/if}
			</section>
		{:else if viewMode === "today"}
			<section class="outline-panel date-projection" aria-label={vocabulary.today}>
				<div class="section-title"><span>{vocabulary.today}</span></div>
				<div class="date-controls">
					<button onclick={() => moveDateRange(-1)}>前日</button>
					<button onclick={() => moveDateRange(1)}>翌日</button>
					<button onclick={showWeek}>週</button>
					<label>開始 <input type="date" bind:value={dateStart} /></label>
					<label>終了（含まない） <input type="date" bind:value={dateEnd} /></label>
					<button onclick={loadDateProjection}>表示</button>
				</div>
				{#if dateProjectionLoading}
					<p class="empty">読み込み中…</p>
				{:else if dateProjection}
					<section aria-label="この期間に作成">
						<h2>この期間に作成 <small>{dateProjection.created.length}件</small></h2>
						{#each dateProjection.created as entry (entry.work.id)}
							<button class="date-entry" onclick={() => openDateEntry(entry)} disabled={!entry.representative}>
								<strong>{entry.representative ? titleFor(entry.representative) : `(未配置の${vocabulary.work})`}</strong>
								<small>{formatCreatedAt(entry.work.createdAt)} · {entry.placements.length}件の{vocabulary.occurrence}</small>
							</button>
							{#if entry.placements.length > 1}
								<p class="hint">{entry.placements.map((placement) => placement.breadcrumb.map(titleFor).concat(titleFor(placement.occurrence)).join(" › ")).join(" / ")}</p>
							{/if}
						{:else}<p class="empty">この期間に作成した{vocabulary.work}はありません。</p>{/each}
					</section>
					<section aria-label="この期間に更新">
						<h2>この期間に更新 <small>{dateProjection.updated.length}件</small></h2>
						{#each dateProjection.updated as entry (entry.work.id)}
							<button class="date-entry" onclick={() => openDateEntry(entry)} disabled={!entry.representative}>
								<strong>{entry.representative ? titleFor(entry.representative) : `(未配置の${vocabulary.work})`}</strong>
								<small>{formatCreatedAt(entry.work.updatedAt)} · {entry.placements.length}件の{vocabulary.occurrence}</small>
							</button>
							{#if entry.placements.length > 1}
								<p class="hint">{entry.placements.map((placement) => placement.breadcrumb.map(titleFor).concat(titleFor(placement.occurrence)).join(" › ")).join(" / ")}</p>
							{/if}
						{:else}<p class="empty">この期間に更新した既存{vocabulary.work}はありません。</p>{/each}
					</section>
				{/if}
			</section>
		{:else if viewMode === "unplaced"}
			<section class="outline-panel unplaced-inbox" aria-label={vocabulary.unplacedInbox}>
				<div class="section-title">
					<span>{vocabulary.unplacedInbox}</span><small>{unplacedWorks.length}件</small>
				</div>
				<p class="hint">
					配置先を決めずに保存した{vocabulary.work}です。本文へ #タグ を入力するとタグ付けできます。
				</p>
				<div class="unplaced-list">
					{#each unplacedWorks as work (work.workId)}
						<article class="unplaced-entry">
							<textarea
								rows="3"
								aria-label={`${vocabulary.workingCopy}を編集`}
								value={work.text}
								onchange={(event) => updateUnplacedText(work, event.currentTarget.value)}
							></textarea>
							<small>{formatCreatedAt(work.createdAt)}</small>
							<div class="unplaced-actions">
								<button onclick={() => placeUnplaced(work.workId, null)}>Rootへ配置</button>
								<button
									onclick={() => placeUnplaced(work.workId, selectedId)}
									disabled={!selectedId}
								>選択中の{vocabulary.occurrence}の下へ配置</button>
							</div>
							<div class="unplaced-actions">
								<select
									aria-label={`${vocabulary.semanticLink}の方向`}
									value={unplacedLinkDirections[work.workId] ?? "from"}
									onchange={(event) =>
										unplacedLinkDirections[work.workId] =
											event.currentTarget.value as "from" | "to"}
								>
									<option value="from">この{vocabulary.work}から</option>
									<option value="to">この{vocabulary.work}へ</option>
								</select>
								<select
									aria-label={`${vocabulary.semanticLink}相手`}
									value={unplacedLinkTargets[work.workId] ?? ""}
									onchange={(event) =>
										unplacedLinkTargets[work.workId] = event.currentTarget.value}
								>
									<option value="">相手を選択…</option>
									{#each linkableWorks.filter((candidate) => candidate.workId !== work.workId) as target}
										<option value={target.workId}>{target.text.split("\n")[0] || `(空の${vocabulary.work})`}</option>
									{/each}
								</select>
								<select aria-label={`${vocabulary.semanticLink}種別`} bind:value={unplacedLinkType}>
									{#each LINK_TYPES as type}<option value={type}>{type}</option>{/each}
								</select>
								<button onclick={() => linkUnplaced(work.workId)}
								>{vocabulary.semanticLink}作成</button>
							</div>
						</article>
					{:else}
						<p class="empty">{vocabulary.unplacedInbox}は空です。</p>
					{/each}
				</div>
			</section>
		{:else if viewMode === "trash"}
			<section class="outline-panel">
				<div class="section-title"><span>ゴミ箱</span><small>{trashEntries.length}件</small></div>
				<div class="stash-list">
					{#each trashEntries as entry}
						<div>
							<span>{entry.work.id.slice(0, 8)} · {vocabulary.occurrence}{entry.occurrenceCount}件 · {vocabulary.semanticLink}{entry.linkCount}件</span>
							<button onclick={() => restoreTrash(entry.work.id)}>復元</button>
							<button class="delete" onclick={() => purgeTrash(entry)}>完全消去</button>
						</div>
					{:else}
						<p class="empty">ゴミ箱は空です</p>
					{/each}
				</div>
			</section>
		{:else if viewMode === "comparison"}
			{#if linkComparison}
				{#key linkComparison.linkId}
					<ComparisonPane
						documents={[linkComparison.left, linkComparison.right]}
						context={{
							kind: "semantic-link",
							type: linkComparison.type,
							direction: linkComparison.direction,
							createdAt: linkComparison.createdAt,
							reason: linkComparison.reason,
						}}
						preferredLeftKey={comparisonDocumentKey(linkComparison.left)}
						preferredRightKey={comparisonDocumentKey(linkComparison.right)}
						locked
					/>
				{/key}
			{:else if workComparison}
				{#key workComparison.workId}
					<ComparisonPane
						documents={workComparison.documents}
						context={{ kind: "branch" }}
						preferredLeftKey={workComparison.preferredLeftKey}
						preferredRightKey={workComparison.preferredRightKey}
					/>
				{/key}
			{:else if selectedItem}
				{#if revisionsLoading}
					<section class="revision-comparison"><p class="comparison-empty">版を読み込んでいます…</p></section>
				{:else}
					{#key selectedItem.workId}
						<RevisionComparison
							{revisions}
							preferredRevisionId={comparisonPreferredRevisionId ??
								(selectedItem.revisionSelector.mode === "pinned"
									? selectedItem.revisionSelector.revisionId
									: undefined)}
						/>
					{/key}
				{/if}
			{:else}
				<section class="revision-comparison"><p class="comparison-empty">{vocabulary.work}を選択してください。</p></section>
			{/if}
		{:else if viewMode === "workLineage"}
			{#if workLineageLoading}
				<section class="revision-comparison"><p class="comparison-empty">{vocabulary.workLineage}を読み込んでいます…</p></section>
			{:else if workLineage}
				{#key workLineage.work.id}
					<WorkLineage projection={workLineage} onCompare={openWorkComparison} />
					{#if selectedItem && selectedBranchId}
						<RecoverySnapshots
							snapshots={recoverySnapshots}
							loadPreview={(snapshotId) =>
								api.previewRecoverySnapshot(
									snapshotId,
									selectedItem.workId,
									selectedBranchId,
								)}
							onRestore={restoreRecoverySnapshot}
							onPromote={promoteRecoverySnapshot}
						/>
					{/if}
				{/key}
			{:else}
				<section class="revision-comparison"><p class="comparison-empty">{vocabulary.work}を選択してください。</p></section>
			{/if}
		{:else if globalLineage}
			<GlobalLineage
				projection={globalLineage}
				{selectedId}
				onSelect={(id) => selectOccurrence(id)}
			/>
		{:else}
			<section class="tree-panel"><p class="empty">{vocabulary.globalLineage}を読み込んでいます…</p></section>
		{/if}

		<aside>
			{#if selectedItem}
				<nav class="aside-tabs" aria-label="詳細表示">
					<button class:active={asideMode === "links"} onclick={() => (asideMode = "links")}>{vocabulary.semanticLink}</button>
					<button class:active={asideMode === "discover"} onclick={() => (asideMode = "discover")}>発見</button>
					<button class:active={asideMode === "tags"} onclick={() => (asideMode = "tags")}>{vocabulary.tag}</button>
					<button class:active={asideMode === "query"} onclick={() => (asideMode = "query")}>Query</button>
				</nav>
				<p class="eyebrow">SELECTED THOUGHT</p>
				<h2>{titleFor(selectedItem)}</h2>
				{#if asideMode === "links"}
					<label>
						{vocabulary.occurrence}固有の見出し
						<input value={selectedItem.contextualHeading ?? ""}
							onchange={(event) => updateSelectedHeading(event.currentTarget.value)}
							placeholder="未設定時は本文の先頭行" />
					</label>
					<section class="placements">
						<h3>すべての{vocabulary.occurrence}<small>{selectedPlacements.length}件</small></h3>
						<div>
							{#each selectedPlacements as placement (placement.id)}
								<button class:active={placement.id === selectedItem.id}
									onclick={() => {
										viewMode = "outline";
										selectOccurrence(placement.id);
										requestFocus(placement.id);
									}}>
									<strong>{titleFor(placement)}</strong>
									<span>{placement.parentId ? `親: ${titleForId(placement.parentId)}` : "ルート"}</span>
								</button>
							{/each}
						</div>
					</section>
					<div class="discovery-actions">
						<button onclick={duplicateSelectedOccurrence}>同じ{vocabulary.work}をもう一箇所へ配置</button>
						<button onclick={() => remove(selectedItem.id)}>この{vocabulary.occurrence}を外す</button>
						<button onclick={trashSelectedWork}>{vocabulary.work}をゴミ箱へ</button>
					</div>
				{/if}
				{#if asideMode === "links" && bodyFor(selectedItem)}
					<p class="thought-body">{bodyFor(selectedItem)}</p>
				{/if}
				{#if asideMode === "links" && viewMode === "outline"}
					<p class="hint">Enter: 兄弟　Shift+Enter: 改行<br />Tab / Shift+Tab: 階層　Alt+↑↓: 移動</p>
				{:else if asideMode === "links"}
					<div class="thought-meta"><span>作成日</span><time datetime={selectedItem.createdAt}>{formatCreatedAt(selectedItem.createdAt)}</time></div>
				{/if}
				{#if asideMode === "links"}
					<AdvancedLinkEditor
						selectedWorkId={selectedItem.workId}
						selectedDisplayName={titleFor(selectedItem)}
						onConfirm={(input) => executeCommand("createLink", undefined, input)}
					/>
					<div class="links">
						{#each selectedLinks as link}
							<div>
								<span class={`tag ${link.type.toLowerCase()}`}>{link.type}</span>
								<span>{link.fromId === selectedItem.workId ? "→" : "←"} {otherName(link)}</span>
								{#if isComparableLinkType(link.type)}
									<button onclick={() => openLinkComparison(link.id)}>{vocabulary.comparisonPane}</button>
								{/if}
								<button onclick={() => removeLink(link)}>×</button>
							</div>
						{:else}<p class="empty">任意の{vocabulary.semanticLink}はありません</p>{/each}
					</div>
				{:else if asideMode === "discover"}
					<div class="discoveries">
						{#if emergenceLoading}<p class="empty">関係を探索中…</p>{/if}
						{#each emergenceSuggestions as suggestion}
							<article class:pinned={suggestion.status === "pinned"}>
								<div class="discovery-title"><span>{suggestion.title}</span><small>{Math.round(suggestion.score * 100)}%</small></div>
								<strong>{titleForId(suggestion.targetItemId)}</strong>
								<p>{suggestion.explanation}</p>
								<ol>{#each suggestion.evidence as step}<li>{step.relation}: {titleForId(step.fromId)} → {titleForId(step.toId)}</li>{/each}</ol>
								<div class="discovery-actions">
									{#if suggestion.proposedLinkType}<button onclick={() => resolveEmergence(suggestion, "accept")}>採用</button>{/if}
									<button onclick={() => resolveEmergence(suggestion, "pin")}>ピン</button>
									<button onclick={() => resolveEmergence(suggestion, "dismiss")}>却下</button>
								</div>
							</article>
						{:else}
							{#if !emergenceLoading}<p class="empty">新しい関係候補はありません</p>{/if}
						{/each}
					</div>
				{:else if asideMode === "tags"}
					<div class="query-panel">
						<datalist id="tag-candidates">
							{#each tags as tag}<option value={`#${tag.name}`}>{tag.count}件</option>{/each}
						</datalist>
						<h3>{vocabulary.tag}検索</h3>
						<label>すべて含む（AND）
							<input bind:value={tagAll} list="tag-candidates" placeholder="#tag1, #tag2" />
						</label>
						<label>除外
							<input bind:value={tagNone} list="tag-candidates" placeholder="#除外tag" />
						</label>
						<label>履歴も検索する{vocabulary.revision} ID（任意）
							<input bind:value={tagHistoryRevisionIds} placeholder="IDをカンマ区切り" />
						</label>
						<button onclick={searchByTags}>検索</button>
						{#if tagError}<p class="query-error">{tagError}</p>{/if}
						<div class="alias-list">
							{#each tagMatches as match}
								<div>
									<span>{titleForId(match.scope.workId)} · {match.scope.kind === "revision" ? `${vocabulary.revision} ${match.scope.revisionId}` : `${vocabulary.branch} ${match.scope.branchId}`} · {match.tags.map((tag) => `#${tag}`).join(" ")}</span>
								</div>
							{/each}
						</div>
						<h3>{vocabulary.tag}一覧</h3>
						<div class="alias-list">{#each tags as tag}<div><span>#{tag.name}</span><small>{tag.count}件</small></div>{/each}</div>
						<h3>名前変更</h3>
						<input bind:value={tagRenameFrom} list="tag-candidates" placeholder="変更前" />
						<input bind:value={tagRenameTo} placeholder="変更後" />
						<button onclick={renameTag}>名前変更</button>
						<h3>統合</h3>
						<input bind:value={tagMergeSources} list="tag-candidates" placeholder="統合元をカンマ区切り" />
						<input bind:value={tagMergeTarget} placeholder="統合先" />
						<button onclick={mergeTags}>統合</button>
						<div class="alias-list">{#each tagAliases as alias}<div><span>#{alias.variants.join(", #")} → #{alias.canonicalName}</span></div>{/each}</div>
						<p class="hint">名前変更・統合は表示と検索の正準名だけを変更し、{vocabulary.workingCopy}と過去の{vocabulary.revision}本文は書き換えません。</p>
					</div>
					<section class="internal-reference-backlinks">
						<h3>{vocabulary.backlink}<small>{internalReferenceBacklinks.length}件</small></h3>
						{#each internalReferenceBacklinks as backlink (JSON.stringify(backlink.source))}
							<button onclick={() => openInternalReferenceBacklink(backlink)}>
								<strong>{backlink.displayName}</strong>
								<span>
									{backlink.source.scope === "work" ? vocabulary.workingCopy : `固定${vocabulary.revision}`}
									· {backlink.count}箇所
								</span>
							</button>
						{:else}
							<p class="empty">{vocabulary.backlink}はありません</p>
						{/each}
					</section>
					{#if internalReferenceNotice}
						<p class="internal-reference-notice" role="status">{internalReferenceNotice}</p>
					{/if}
				{:else}
					<div class="query-panel">
						<label for="rule-source">読み取り専用Datalog</label>
						<textarea id="rule-source" rows="6" bind:value={ruleSource} spellcheck="false"></textarea>
						<div class="query-actions"><button onclick={executeRule} disabled={!commands.runQuery.enabled} title={commands.runQuery.reason}>実行</button><input placeholder="保存名" bind:value={ruleName} /><button onclick={saveRule} disabled={!commands.saveQuery.enabled} title={commands.saveQuery.reason}>保存</button></div>
						{#if ruleError}<p class="query-error">{ruleError}</p>{/if}
						{#if ruleResult}
							<p class="query-meta">{ruleResult.rows.length}件・{ruleResult.elapsedMs.toFixed(1)}ms</p>
							<div class="query-table"><table><thead><tr>{#each ruleResult.columns as column}<th>{column}</th>{/each}</tr></thead>
								<tbody>{#each ruleResult.rows as row}<tr>{#each row as value}<td>{titleForId(value)}</td>{/each}</tr>{/each}</tbody>
							</table></div>
						{/if}
						<div class="saved-queries">{#each savedRuleQueries as saved}<button onclick={() => { ruleSource = saved.source; ruleName = saved.name; }}>{saved.name}</button><button class="remove-saved" onclick={() => removeRule(saved.id)}>×</button>{/each}</div>
						<h3>検索別名</h3>
						<input placeholder="基準語" bind:value={aliasCanonical} />
						<textarea rows="2" placeholder="別名（カンマ区切り）" bind:value={aliasVariants}></textarea>
						<button onclick={saveAlias}>別名を追加</button>
						<div class="alias-list">{#each aliases as alias}<div><span>{alias.canonical} ↔ {alias.variants.join(", ")}</span><button onclick={() => removeAlias(alias.id)}>×</button></div>{/each}</div>
					</div>
				{/if}
			{:else}
				<div class="aside-empty"><span>•</span><p>{vocabulary.work}を選択すると<br />関連{vocabulary.semanticLink}を編集できます</p></div>
			{/if}
		</aside>
	</main>
	{/if}
</div>

<dialog
	bind:this={confirmationDialog}
	class="confirmation-dialog"
	aria-labelledby="confirmation-title"
	aria-describedby="confirmation-description"
	aria-modal="true"
	oncancel={preventCloseWhileSubmitting}
	onclose={resetConfirmation}
>
	{#if pendingConfirmation}
		<div class="confirmation-dialog__content">
			<p class="eyebrow">CONFIRM ACTION</p>
			<h2 id="confirmation-title">
				{pendingConfirmation.action === "trash" ? `${vocabulary.work}をゴミ箱へ移しますか？` : "完全消去しますか？"}
			</h2>
			<p id="confirmation-description">
				{#if pendingConfirmation.action === "trash"}
					{pendingConfirmation.occurrenceCount}件の{vocabulary.occurrence}と{vocabulary.semanticLink}は保持されます。
				{:else}
					{vocabulary.occurrence}{pendingConfirmation.occurrenceCount}件、{vocabulary.semanticLink}{pendingConfirmation.linkCount}件と本文を復元できなくなります。
				{/if}
			</p>
			<div class="confirmation-dialog__actions">
				<button onclick={closeConfirmation} disabled={confirmationSubmitting}>キャンセル</button>
				<button class="delete" onclick={confirmPendingAction} disabled={confirmationSubmitting}>
					{confirmationSubmitting ? "処理中…" : pendingConfirmation.action === "trash" ? "ゴミ箱へ移す" : "完全消去"}
				</button>
			</div>
		</div>
	{/if}
</dialog>
