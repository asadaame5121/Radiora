<script lang="ts">
	import { onMount, tick } from "svelte";
	import GlobalLineage from "./GlobalLineage.svelte";
	import RevisionComparison from "./RevisionComparison.svelte";
	import ComparisonPane from "./ComparisonPane.svelte";
	import RecoverySnapshots from "./RecoverySnapshots.svelte";
	import WorkLineage from "./WorkLineage.svelte";
	import LinkEditor from "./LinkEditor.svelte";
	import MarkdownEditor from "./MarkdownEditor.svelte";
	import SparseOutlineView from "./SparseOutlineView.svelte";
	import DuplicateCandidatesPanel from "./DuplicateCandidatesPanel.svelte";
	import { createRpcAdapter } from "./rpc_adapter";
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
		Revision,
		RecoverySnapshot,
		Suggestion,
		TrashEntry,
		TransientProjectionNode,
		UnplacedWork,
	} from "../domain/models";
	import { isSymmetricLinkType, LINK_TYPES } from "../domain/models";
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
		type MarkdownExportReferenceMode,
		renderOutlineSnapshotMarkdown,
		rewriteMarkdownExportReferences,
	} from "../services/markdown_export";
	import {
		activateBrowsingPane,
		activeBrowsingPane,
		ancestorBreadcrumb,
		browseToOutlineOccurrence,
		createBrowsingNavigationState,
		currentBrowsingLocation,
		openBrowsingPane,
		projectBrowsingOutline,
		reconcileBrowsingState,
		setBrowsingHoist,
	} from "../services/browsing_navigation_state";
	import { useUiVocabulary } from "./ui_vocabulary_context";
	import { navigationUiState } from "./navigation_state";
	import { buildVisibleRows, type VisibleRow } from "./outline_view_model";
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
	import {
		findInternalReferenceTrigger,
	} from "../services/internal_reference";
	import {
		findInlineLinkTrigger,
		replaceInlineLinkTrigger,
	} from "../services/inline_link";
	import { parseMarkdownCandidates } from "../services/markdown_parser";
	import type {
		InternalReferenceBacklink,
		InternalReferenceCompletion,
		InternalReferenceResolution,
	} from "../services/internal_reference_service";
	import {
		comparisonDocumentKey,
		type LinkComparisonProjection,
		type WorkComparisonDocuments,
	} from "../services/comparison_service";
	import { previewDirection } from "../services/advanced_link_resolver";
	import type { StubListEntry } from "../services/stub_service";
	import type { DuplicateCandidate } from "../services/duplicate_candidates";
	import type { WorkMergePreview } from "../services/work_merge_service";
	import {
		EMPTY_OUTLINE_FILTER,
		matchesOutlineFilter,
		type OutlineFilter,
	} from "../services/outline_filter";
	import {
		parseInlineSemanticLinks,
		type InlineSemanticLinkCandidate,
	} from "../services/inline_semantic_link";
	import {
		projectSemanticLinkAnnotations,
		type SemanticLinkAnnotation,
	} from "../services/semantic_link_annotations";

	const api = createRpcAdapter<RadioraBindings>();

	type ViewMode =
		| "outline"
		| "today"
		| "unplaced"
		| "stubs"
		| "duplicates"
		| "tags"
		| "globalLineage"
		| "workLineage"
		| "comparison"
		| "trash";
	type AsideMode = "overview" | "relation" | "history" | "query";
	type PendingConfirmation =
		| { action: "trash"; occurrenceId: string; occurrenceCount: number }
		| { action: "purge"; workId: string; occurrenceCount: number; linkCount: number }
		| {
			action: "rewrite";
			occurrenceId: string;
			workId: string;
			sourceBranchId: string;
		}
		| { action: "merge-duplicate"; preview: WorkMergePreview }
		| { action: "cancel-longform"; pendingAction: () => Promise<void> };
	type InternalReferenceCompletionState = {
		itemId: string;
		range: { start: number; end: number };
		candidates: InternalReferenceCompletion[];
		activeIndex: number;
	};
	type InlineLinkCompletionPhase = "candidate" | "type" | "direction";
	type InlineLinkDirection = "forward" | "reverse";
	type InlineLinkCompletionState = {
		itemId: string;
		query: string;
		range: { start: number; end: number };
		candidates: InternalReferenceCompletion[];
		activeIndex: number;
		phase: InlineLinkCompletionPhase;
		selectedCandidate?: InternalReferenceCompletion;
		selectedType?: LinkType;
		direction: InlineLinkDirection;
	};
	type TagCloudEntry = {
		name: string;
		workIds: readonly string[];
	};

	const vocabulary = useUiVocabulary();
	let snapshot = $state<OutlineSnapshot>({ items: [], links: [], knots: [], stashItemIds: [] });
	let loading = $state(true);
	let startup = $state<StartupStatus>({ phase: "starting", message: "Radioraを起動しています…" });
	let error = $state("");
	let quickCaptureText = $state("");
	let quickCaptureSubmitting = $state(false);
	let unplacedWorks = $state<UnplacedWork[]>([]);
	let stubEntries = $state<StubListEntry[]>([]);
	let outlineFilter = $state<OutlineFilter>({ ...EMPTY_OUTLINE_FILTER });
	let longForm = $state({
		active: false,
		text: "",
		dirty: false,
		preview: false,
	});
	let duplicateCandidates = $state<DuplicateCandidate[]>([]);
	let excludedDuplicateCandidateKeys = $state<string[]>([]);
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
	let suggestions = $state<Suggestion[]>([]);
	let searchResults = $state<SearchResult[]>([]);
	let searchActiveIndex = $state(-1);
	let asideMode = $state<AsideMode>("overview");
	let emergenceSuggestions = $state<EmergenceSuggestion[]>([]);
	let emergenceResolutionReasons = $state<Record<string, string>>({});
	let emergenceLoading = $state(false);
	let aliases = $state<SearchAlias[]>([]);
	let aliasCanonical = $state("");
	let aliasVariants = $state("");
	let tagScopes = $state<ScopedTagSet[]>([]);
	let tagAliases = $state<TagAlias[]>([]);
	let selectedTag = $state<string | null>(null);
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
	let sparseOutlineNodes = $state<TransientProjectionNode[]>([]);
	let sparseOutlineQueryName = $state("");
	let showSparseOutline = $state(false);
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
	let rewriteBranchName = $state("");
	let rewriteBranchNameInput = $state<HTMLInputElement | null>(null);
	let commandPaletteOpen = $state(false);
	let commandPaletteQuery = $state("");
	let commandPaletteActiveIndex = $state(-1);
	let commandPaletteInput = $state<HTMLInputElement | null>(null);
	let commandPaletteRestoreFocus: HTMLElement | null = null;
	let inspectorElement = $state<HTMLElement | null>(null);
	let workingCopySaveStatuses = $state<WorkingCopySaveStatus[]>([]);
	let internalReferenceCompletion = $state<InternalReferenceCompletionState | null>(null);
	let inlineLinkCompletion = $state<InlineLinkCompletionState | null>(null);
	let internalReferenceBacklinks = $state<InternalReferenceBacklink[]>([]);
	let internalReferenceNotice = $state("");
	let inlineSemanticLinkNotice = $state("");
	let markdownExportNotice = $state("");
	let markdownExportReferenceMode = $state<MarkdownExportReferenceMode>("radiora");
	let opmlNotice = $state("");
	let jsonBackupNotice = $state("");
	let opmlFileInput: HTMLInputElement;
	let jsonBackupFileInput: HTMLInputElement;
	let inspectorWidth = $state(320);
	let inspectorCollapsed = $state(false);
	let navCollapsed = $state(false);
	let internalReferenceCompletionRequest = 0;
	let inlineLinkCompletionRequest = 0;
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
	const tagCloud = $derived.by(() => {
		const workIdsByTag = new Map<string, Set<string>>();
		for (const scope of tagScopes) {
			for (const tag of scope.tags) {
				const workIds = workIdsByTag.get(tag) ?? new Set<string>();
				workIds.add(scope.scope.workId);
				workIdsByTag.set(tag, workIds);
			}
		}
		return [...workIdsByTag].map(([name, workIds]) => ({
			name,
			workIds: [...workIds].sort(),
		}) satisfies TagCloudEntry).sort((left, right) =>
			right.workIds.length - left.workIds.length || left.name.localeCompare(right.name)
		);
	});
	const selectedTagNodeIds = $derived(
		selectedTag ? tagCloud.find((tag) => tag.name === selectedTag)?.workIds ?? [] : [],
	);
	const selectedItem = $derived(selectedId ? itemById.get(selectedId) ?? null : null);
	const browsingLocation = $derived(currentBrowsingLocation(browsing));
	const browsingPane = $derived(activeBrowsingPane(browsing));
	const browsingProjection = $derived(projectBrowsingOutline(
		snapshot,
		browsingLocation.hoistOccurrenceId,
	));
	const selectedBreadcrumb = $derived(ancestorBreadcrumb(snapshot, selectedId));
	const outlineContextBreadcrumbItems = $derived(
		browsingLocation.hoistOccurrenceId ? browsingProjection.breadcrumb : selectedBreadcrumb,
	);
	const outlineContextBreadcrumb = $derived(
		outlineContextBreadcrumbItems.map(titleFor).join(" › "),
	);
	const outlineContextTitle = $derived(
		browsingLocation.hoistOccurrenceId
			? titleForId(browsingLocation.hoistOccurrenceId)
			: "ルート",
	);
	const recentEditedItems = $derived.by(() => {
		const stashedIds = new Set(snapshot.stashItemIds);
		const seenWorkIds = new Set<string>();
		return [...snapshot.items]
			.filter((item) => !stashedIds.has(item.id))
			.sort((left, right) => {
				const leftTime = Date.parse(left.updatedAt);
				const rightTime = Date.parse(right.updatedAt);
				return (Number.isNaN(rightTime) ? 0 : rightTime) -
					(Number.isNaN(leftTime) ? 0 : leftTime) ||
					left.id.localeCompare(right.id);
			})
			.filter((item) => {
				if (seenWorkIds.has(item.workId)) return false;
				seenWorkIds.add(item.workId);
				return true;
			})
			.slice(0, 6);
	});
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
	const semanticLinkAnnotations = $derived(projectSemanticLinkAnnotations(snapshot.items, snapshot.links));
	const linkableWorks = $derived([
		...new Map([
			...snapshot.items.map((item) => [item.workId, { workId: item.workId, text: item.text }] as const),
			...unplacedWorks.map((work) => [
				work.workId,
				{ workId: work.workId, text: work.text },
			] as const),
		]).values(),
	]);
	const visibleRows = $derived.by(() => buildVisibleRows(
		snapshot,
		browsingProjection,
		transientExpandedIds,
		!browsingLocation.hoistOccurrenceId,
	));
	const searchEntries = $derived([
		...suggestions.map((suggestion) => ({ kind: "suggestion" as const, value: suggestion })),
		...searchResults.map((result) => ({ kind: "result" as const, value: result })),
	]);
	const omniEntryCount = $derived(searchEntries.length + (quickCaptureText.trim() ? 1 : 0));
	const dedicatedView = $derived(
		viewMode === "globalLineage" || viewMode === "workLineage" || viewMode === "comparison" ||
			viewMode === "tags",
	);
	const viewModeLabel = $derived(
		viewMode === "outline"
			? "アウトライン"
			: viewMode === "today"
			? vocabulary.today
			: viewMode === "unplaced"
			? vocabulary.unplacedInbox
			: viewMode === "stubs"
			? vocabulary.stubList
			: viewMode === "duplicates"
			? vocabulary.duplicateCandidates
			: viewMode === "tags"
			? vocabulary.tag
			: viewMode === "globalLineage"
			? vocabulary.globalLineage
			: viewMode === "workLineage"
			? vocabulary.workLineage
			: viewMode === "comparison"
			? `${vocabulary.revision}${vocabulary.comparisonPane}`
			: "ゴミ箱",
	);
	const inspectorColumn = $derived(inspectorCollapsed ? "0px" : `${inspectorWidth}px`);
	const workingCopySaveStatus = $derived.by(() => {
		const failed = workingCopySaveStatuses.find((status) => status.phase === "failed");
		if (failed) return failed;
		const saving = workingCopySaveStatuses.find((status) => status.phase === "saving");
		if (saving) return saving;
		const unsaved = workingCopySaveStatuses.find((status) => status.phase === "unsaved");
		if (unsaved) return unsaved;
		return workingCopySaveStatuses[0];
	});
	const filteredTodayCreated = $derived.by(() => filterDateEntries(dateProjection?.created ?? []));
	const filteredTodayUpdated = $derived.by(() => filterDateEntries(dateProjection?.updated ?? []));
	const filteredUnplacedWorks = $derived(
		unplacedWorks.filter((work) =>
			matchesOutlineFilter(work.text, outlineFilter)
		),
	);

	function filterDateEntries<T extends { representative: { text: string } | null }>(entries: T[]): T[] {
		return entries.filter((entry) => {
			const text = entry.representative ? entry.representative.text : "";
			return matchesOutlineFilter(text, outlineFilter);
		});
	}
	const commandContext = $derived<CommandContext>({
		startupReady: startup.phase === "ready",
		selectedOccurrenceId: selectedId,
		hasSelectedBranch: Boolean(selectedBranchId),
		hasSelectedRecoverySnapshot: false,
		canOpenLinkEditor: Boolean(selectedItem),
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
		if (viewMode !== "today" && viewMode !== "unplaced") {
			outlineFilter = { ...EMPTY_OUTLINE_FILTER };
		}
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
			if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLocaleLowerCase() === "k") {
				event.preventDefault();
				if (commandPaletteOpen) void closeCommandPalette();
				else void openCommandPalette();
				return;
			}
			if (event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLocaleLowerCase() === "l") {
				event.preventDefault();
				void executeCommand("createLink");
				return;
			}
			if (event.defaultPrevented) return;
			if (commandPaletteOpen && event.key === "Escape") {
				event.preventDefault();
				void closeCommandPalette();
				return;
			}
			if (isEditableTarget(event.target)) return;
			if (
				event.key === " " &&
				!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey &&
				!(event.target instanceof HTMLElement && event.target.closest("button, a, [role='button']"))
			) {
				event.preventDefault();
				viewMode = viewMode === "globalLineage" ? "outline" : "globalLineage";
				return;
			}
			const shortcut = shortcutForKeyboardEvent(event);
			const binding = shortcuts.bindings.find((candidate) => candidate.shortcut === shortcut);
			if (!binding) return;
			event.preventDefault();
			void executeCommand(binding.commandId);
		};
		window.addEventListener("beforeunload", warnAboutUnsavedChanges);
		document.addEventListener("visibilitychange", flushWhenHidden);
		// Capture before editor libraries so Ctrl+K cannot be consumed as a
		// Markdown link-formatting shortcut while the textarea has focus.
		window.addEventListener("keydown", handleGlobalShortcut, true);
		async function monitorStartup(): Promise<void> {
			while (!cancelled) {
				try {
					startup = await api.getStartupStatus();
					if (startup.phase === "ready") {
						await load();
						aliases = await api.listSearchAliases();
						await loadTagBrowser();
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
			window.removeEventListener("keydown", handleGlobalShortcut, true);
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
			inlineLinkCompletionRequest++;
			inlineLinkCompletion = null;
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

	function selectOccurrence(id: string | null): void {
		selectedId = id;
		browsing = browseToOutlineOccurrence(browsing, snapshot, id);
	}

	function hoistSelected(): void {
		if (!selectedId) return;
		transientExpandedIds = [...new Set([...transientExpandedIds, selectedId])];
		browsing = setBrowsingHoist(browsing, selectedId);
	}

	function hoistOccurrence(id: string): void {
		selectOccurrence(id);
		void executeCommand("hoist");
	}

	function clearHoist(): void {
		browsing = setBrowsingHoist(browsing, null);
	}

	async function revealInspector(): Promise<void> {
		inspectorCollapsed = false;
		asideMode = "overview";
		await tick();
		inspectorElement?.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	function startInspectorResize(event: PointerEvent): void {
		if (event.button !== 0 || inspectorCollapsed) return;
		event.preventDefault();
		const move = (next: PointerEvent) => {
			const width = window.innerWidth - next.clientX;
			inspectorWidth = Math.max(240, Math.min(560, width));
		};
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop, { once: true });
	}

	async function openInspectorTool(mode: Extract<AsideMode, "query">): Promise<void> {
		asideMode = mode;
		if (dedicatedView) viewMode = "outline";
		await tick();
		inspectorElement?.scrollIntoView({ behavior: "smooth", block: "start" });
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
		if (inlineLinkCompletion?.itemId === row.item.id) {
			const completion = inlineLinkCompletion;
			if (completion.phase === "candidate") {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					const count = completion.candidates.length;
					if (count) {
						completion.activeIndex =
							(completion.activeIndex + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
					}
					return;
				}
				if ((event.key === "Enter" || event.key === "Tab") && completion.candidates.length) {
					event.preventDefault();
					selectInlineLinkCandidate(
						row.item.id,
						completion.candidates[completion.activeIndex],
					);
					return;
				}
			} else if (completion.phase === "type") {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					const current = completion.selectedType
						? LINK_TYPES.indexOf(completion.selectedType)
						: 0;
					const next = (current + (event.key === "ArrowDown" ? 1 : -1) + LINK_TYPES.length) %
						LINK_TYPES.length;
					completion.selectedType = LINK_TYPES[next];
					return;
				}
				if (event.key === "Enter" || event.key === "Tab") {
					event.preventDefault();
					chooseInlineLinkType(row.item.id);
					return;
				}
			} else if (completion.phase === "direction") {
				if (event.key === "ArrowLeft" || event.key === "ArrowRight" ||
					event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					completion.direction = event.key === "ArrowLeft" || event.key === "ArrowUp"
						? "reverse"
						: "forward";
					return;
				}
				if (event.key === "Enter" || event.key === "Tab") {
					event.preventDefault();
					void commitInlineLink(row.item.id);
					return;
				}
			}
			if (event.key === "Escape") {
				event.preventDefault();
				inlineLinkCompletionRequest++;
				inlineLinkCompletion = null;
				return;
			}
		}
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
			if (!row.item.text.trim()) {
				event.preventDefault();
				return;
			}
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
		if (event.key === "Backspace" && !row.item.text.trim()) {
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
		const updatedAt = new Date().toISOString();
		for (const placement of snapshot.items) {
			if (placement.workId === item.workId) {
				placement.text = text;
				placement.updatedAt = updatedAt;
			}
		}
		autosave.queue(item.workId, id, text);
		resumeAutosave.queue(id, textarea.selectionStart);
		void updateInternalReferenceCompletion(id, textarea);
		void updateInlineLinkCompletion(id, textarea);
	}

	function updateEditorSelection(id: string, textarea: HTMLTextAreaElement): void {
		if (selectedId === id) resumeAutosave.queue(id, textarea.selectionStart);
		void updateInlineLinkCompletion(id, textarea);
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

	async function updateInlineLinkCompletion(
		itemId: string,
		textarea: HTMLTextAreaElement,
	): Promise<void> {
		const trigger = findInlineLinkTrigger(
			textarea.value,
			textarea.selectionStart,
			textarea.selectionEnd,
		);
		if (!trigger) {
			inlineLinkCompletionRequest++;
			inlineLinkCompletion = null;
			return;
		}
		const request = ++inlineLinkCompletionRequest;
		try {
			const candidates = (await api.listInternalReferenceCompletions(trigger.query, 16))
				.filter((candidate) => candidate.scope === "work")
				.filter((candidate) => snapshot.items.find((item) => item.id === itemId)?.workId !== candidate.workId);
			if (request !== inlineLinkCompletionRequest) return;
			inlineLinkCompletion = {
				itemId,
				query: trigger.query,
				range: trigger.range,
				candidates,
				activeIndex: 0,
				phase: "candidate",
				direction: "forward",
			};
		} catch (cause) {
			if (request === inlineLinkCompletionRequest) error = errorMessage(cause);
		}
	}

	function selectInlineLinkCandidate(
		itemId: string,
		candidate: InternalReferenceCompletion,
	): void {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || candidate.scope !== "work") return;
		inlineLinkCompletion = {
			...state,
			phase: "type",
			selectedCandidate: candidate,
			selectedType: "RELATED",
			direction: "forward",
		};
	}

	function chooseInlineLinkType(itemId: string): void {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || !state.selectedCandidate || !state.selectedType) return;
		if (isSymmetricLinkType(state.selectedType)) {
			void commitInlineLink(itemId);
			return;
		}
		inlineLinkCompletion = { ...state, phase: "direction" };
	}

	function selectInlineLinkType(itemId: string, type: LinkType): void {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || state.phase !== "type") return;
		state.selectedType = type;
		chooseInlineLinkType(itemId);
	}

	function setInlineLinkDirection(itemId: string, direction: InlineLinkDirection): void {
		const state = inlineLinkCompletion;
		if (!state || state.itemId !== itemId || state.phase !== "direction") return;
		state.direction = direction;
	}

	async function commitInlineLink(itemId: string): Promise<void> {
		const state = inlineLinkCompletion;
		const item = snapshot.items.find((entry) => entry.id === itemId);
		const candidate = state?.selectedCandidate;
		const type = state?.selectedType;
		if (!state || state.itemId !== itemId || !item || !candidate || !type || candidate.scope !== "work") return;
		if (item.workId === candidate.workId) {
			error = `同じNode自身には${vocabulary.semanticLink}できません。`;
			return;
		}
		const textarea = document.querySelector<HTMLTextAreaElement>(
			`textarea[data-item-id="${CSS.escape(itemId)}"]`,
		);
		const currentTrigger = textarea
			? findInlineLinkTrigger(textarea.value, state.range.end, state.range.end)
			: null;
		if (
			!textarea || !currentTrigger || currentTrigger.range.start !== state.range.start ||
			currentTrigger.range.end !== state.range.end || currentTrigger.query !== state.query
		) {
			error = `入力が変更されたため、@${vocabulary.semanticLink}を確定できませんでした。`;
			inlineLinkCompletionRequest++;
			inlineLinkCompletion = null;
			return;
		}

		const fromId = state.direction === "forward" ? item.workId : candidate.workId;
		const toId = state.direction === "forward" ? candidate.workId : item.workId;
		try {
			await api.createLink({ fromId, toId, type, origin: "human", status: "asserted" });
			// @ search is an input gesture for creating a Semantic Relation.
			// It must not implicitly create a Markdown Internal Reference in the body.
			const replacement = replaceInlineLinkTrigger(textarea.value, state.range, "");
			inlineLinkCompletionRequest++;
			inlineLinkCompletion = null;
			textarea.focus();
			textarea.setRangeText("", state.range.start, state.range.end, "end");
			textarea.dispatchEvent(new InputEvent("input", {
				bubbles: true,
				inputType: "insertReplacementText",
				data: "",
			}));
			await load(item.id);
			requestFocus(item.id, replacement.caretOffset);
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
			clearOmniwindow();
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

	async function loadStubs(): Promise<void> {
		stubEntries = await api.listStubs();
	}

	async function openStubs(): Promise<void> {
		try {
			await loadStubs();
			viewMode = "stubs";
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function loadDuplicates(): Promise<void> {
		const candidates = await api.listDuplicateCandidates();
		duplicateCandidates = candidates.filter((candidate) =>
			!excludedDuplicateCandidateKeys.includes(duplicateCandidateKey(candidate))
		);
	}

	async function openDuplicates(): Promise<void> {
		try {
			await loadDuplicates();
			viewMode = "duplicates";
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function createStubFromList(): Promise<void> {
		try {
			await api.createStub("stub-list");
			await loadStubs();
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function updateStubText(entry: StubListEntry, text: string): Promise<void> {
		if (!text.trim() || text === entry.text) return;
		try {
			await api.updateUnplacedWorkText(entry.workId, text);
			await loadStubs();
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function resolveStubEntry(workId: string): Promise<void> {
		try {
			await api.resolveStub(workId);
			await Promise.all([loadStubs(), loadUnplacedWorks()]);
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	function stubCreatedViaLabel(entry: StubListEntry): string {
		return entry.createdVia === "stub-list" ? vocabulary.stubList : vocabulary.advancedLinkEditor;
	}

	function formatStubInstant(value: string): string {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
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

	function duplicateCandidateKey(candidate: DuplicateCandidate): string {
		return [candidate.workA.workId, candidate.workB.workId].sort().join(":");
	}

	function excludeDuplicateCandidate(candidate: DuplicateCandidate): void {
		const key = duplicateCandidateKey(candidate);
		if (!excludedDuplicateCandidateKeys.includes(key)) {
			excludedDuplicateCandidateKeys = [...excludedDuplicateCandidateKeys, key];
		}
		duplicateCandidates = duplicateCandidates.filter((entry) =>
			duplicateCandidateKey(entry) !== key
		);
	}

	function duplicateCandidateReason(candidate: DuplicateCandidate): string {
		return candidate.reasons.map((reason) => reason.label).join(" / ");
	}

	async function createDuplicateCandidateLink(
		candidate: DuplicateCandidate,
		type: "LIKE" | "RELATED",
	): Promise<void> {
		try {
			await api.createLink({
				fromId: candidate.workA.workId,
				toId: candidate.workB.workId,
				type,
				origin: "human",
				status: "asserted",
				reason: duplicateCandidateReason(candidate),
			});
			excludeDuplicateCandidate(candidate);
			await load();
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function requestDuplicateMerge(
		sourceWorkId: string,
		survivorWorkId: string,
	): Promise<void> {
		try {
			const preview = await api.previewWorkMerge(sourceWorkId, survivorWorkId);
			await requestConfirmation({ action: "merge-duplicate", preview });
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

	function startLongFormEditing(): void {
		if (!selectedItem) return;
		longForm = { active: true, text: selectedItem.text, dirty: false, preview: false };
	}

	async function saveLongFormEditing(): Promise<void> {
		if (!selectedItem) return;
		try {
			await api.updateItemText(selectedItem.id, longForm.text);
			longForm = { active: false, text: "", dirty: false, preview: false };
			await load(selectedItem.id);
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function cancelLongFormEditing(): Promise<void> {
		if (!longForm.dirty) {
			longForm = { active: false, text: "", dirty: false, preview: false };
			return;
		}
		pendingConfirmation = {
			action: "cancel-longform",
			pendingAction: async () => {
				longForm = { active: false, text: "", dirty: false, preview: false };
				pendingConfirmation = null;
			},
		};
	}

	function handleLongFormInput(value: string): void {
		longForm.text = value;
		longForm.dirty = true;
	}

	function renderMarkdownPreview(text: string): string {
		return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function clearOutlineFilter(): void {
		outlineFilter = { ...EMPTY_OUTLINE_FILTER };
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
		if (!quickCaptureText.trim()) {
			suggestions = [];
			searchResults = [];
			return;
		}
		suggestTimer = window.setTimeout(async () => {
			try {
				const next = await api.suggestItems(quickCaptureText, 8);
				if (requestId === searchRequestId) suggestions = next;
			} catch (cause) {
				if (requestId === searchRequestId) error = errorMessage(cause);
			}
		}, 100);
		searchTimer = window.setTimeout(async () => {
			try {
				const next = await api.searchItems({ query: quickCaptureText, contextItemId: selectedId, limit: 20 });
				if (requestId === searchRequestId) searchResults = next;
			} catch (cause) {
				if (requestId === searchRequestId) error = errorMessage(cause);
			}
		}, 250);
	}

	function clearOmniwindow(): void {
		quickCaptureText = "";
		searchRequestId++;
		clearTimeout(suggestTimer);
		clearTimeout(searchTimer);
		suggestions = [];
		searchResults = [];
		searchActiveIndex = -1;
	}

	function handleSearchKeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if (event.key === "Escape") {
			clearOmniwindow();
			return;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const delta = event.key === "ArrowDown" ? 1 : -1;
			searchActiveIndex = Math.max(-1, Math.min(omniEntryCount - 1, searchActiveIndex + delta));
			return;
		}
		if (event.key === "Enter" && event.shiftKey && quickCaptureText.trim()) {
			event.preventDefault();
			void executeCommand("quickCapture");
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const exactMatchIndex = searchEntries.findIndex((entry) =>
				titleFor(entry.value.item).trim() === quickCaptureText.trim()
			);
			const index = searchActiveIndex >= 0
				? searchActiveIndex
				: exactMatchIndex >= 0 ? exactMatchIndex : searchEntries.length > 0 ? 0 : -1;
			if (index === searchEntries.length && quickCaptureText.trim()) {
				void executeCommand("quickCapture");
				return;
			}
			const entry = searchEntries[index];
			if (entry) void selectItem(entry.value.item, entry.value.ancestorIds);
		}
	}

	async function selectSearch(result: SearchResult): Promise<void> {
		await selectItem(result.item, result.ancestorIds);
	}

	async function selectItem(item: OutlineItem, ancestorIds: string[]): Promise<void> {
		transientExpandedIds = ancestorIds;
		clearOmniwindow();
		selectOccurrence(item.id);
		await load(item.id);
	}

	async function openRecentItem(item: OutlineItem): Promise<void> {
		viewMode = "outline";
		await selectItem(item, ancestorBreadcrumb(snapshot, item.id).map((ancestor) => ancestor.id));
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
		const reason = emergenceResolutionReasons[suggestion.id]?.trim();
		await api.resolveEmergenceSuggestion(suggestion.id, action, reason || undefined);
		const { [suggestion.id]: _resolved, ...remainingReasons } = emergenceResolutionReasons;
		emergenceResolutionReasons = remainingReasons;
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
		sparseOutlineNodes = [];
		try {
			ruleResult = await api.runRuleQuery(ruleSource, 500);
		} catch (cause) {
			ruleError = errorMessage(cause);
		}
	}

	async function loadSparseOutlineForQuery(query: SavedRuleQuery): Promise<void> {
		ruleError = "";
		sparseOutlineNodes = [];
		sparseOutlineQueryName = query.name;
		ruleSource = query.source;
		ruleName = query.name;
		showSparseOutline = true;
		try {
			const projection = await api.buildQueryProjectionNodes(query.id, 500);
			sparseOutlineNodes = projection.nodes;
			ruleResult = projection.result;
		} catch (cause) {
			ruleError = errorMessage(cause);
		}
	}

	async function handleSparseOutlineSelect(node: TransientProjectionNode): Promise<void> {
		const ancestorIds = node.breadcrumb ?? [];
		transientExpandedIds = ancestorIds;
		const occurrenceId = node.occurrenceId;
		if (occurrenceId && itemById.has(occurrenceId)) {
			selectOccurrence(occurrenceId);
			await load(occurrenceId);
			viewMode = "outline";
		} else {
			error = `この${vocabulary.work}には表示できる${vocabulary.occurrence}がありません。`;
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

	async function reverseLink(link: OutlineLink): Promise<void> {
		if (isSymmetricLinkType(link.type)) return;
		await api.deleteLink(link.fromId, link.toId, link.type);
		await api.createLink({
			fromId: link.toId,
			toId: link.fromId,
			fromEndpoint: link.to,
			toEndpoint: link.from,
			type: link.type,
			status: link.status,
			origin: link.origin,
			reason: link.reason,
		});
		await load();
	}
	function splitTagInput(value: string): string[] {
		return value.split(/[,、\s]+/).map((tag) => tag.trim()).filter(Boolean);
	}

	async function loadTagBrowser(): Promise<void> {
		tagError = "";
		try {
			const [scopes, aliases, unplaced] = await Promise.all([
				api.listScopedTags(),
				api.listTagAliases(),
				api.listUnplacedWorks(),
			]);
			tagScopes = scopes;
			tagAliases = aliases;
			unplacedWorks = unplaced;
			if (selectedTag && !scopes.some((scope) => scope.tags.includes(selectedTag!))) {
				selectedTag = null;
			}
		} catch (cause) {
			tagError = errorMessage(cause);
		}
	}

	async function openTags(): Promise<void> {
		await loadTagBrowser();
		viewMode = "tags";
	}

	function selectTag(tag: string): void {
		selectedTag = tag;
	}

	function tagCloudFontSize(count: number): string {
		return `${Math.min(22, 12 + Math.max(0, count - 1) * 2)}px`;
	}

	function openTagNode(workId: string): void {
		const item = itemByWorkId.get(workId);
		if (item) {
			viewMode = "outline";
			selectOccurrence(item.id);
			requestFocus(item.id);
			return;
		}
		if (unplacedWorks.some((work) => work.workId === workId)) {
			void openUnplaced();
			return;
		}
		error = `この${vocabulary.work}には表示できる${vocabulary.occurrence}がありません。`;
	}

	async function renameTag(): Promise<void> {
		tagError = "";
		try {
			await api.renameTag(tagRenameFrom, tagRenameTo);
			tagRenameFrom = "";
			tagRenameTo = "";
			await loadTagBrowser();
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
			await loadTagBrowser();
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
			: commandContext;
		const result = await dispatchCommand(id, executionContext, async (commandId) => {
			switch (commandId) {
				case "quickCapture": await performQuickCapture(); break;
				case "hoist": hoistSelected(); break;
				case "clearHoist": clearHoist(); break;
				case "exportMarkdown": await performMarkdownExport(); break;
				case "addBookmark": await performAddBookmark(); break;
				case "createLink":
					if (linkInput) await performAddLink(linkInput);
					else await openLinkEditor();
					break;
				case "runQuery": await performExecuteRule(); break;
				case "saveQuery": await performSaveRule(); break;
			case "saveRevision": if (snapshotId) await performPromoteRecoverySnapshot(snapshotId); break;
				case "createBranch": await requestRewriteAsNewBranch(); break;
				case "startLongFormEditing": startLongFormEditing(); break;
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

	function handleCommandPaletteBackdropClick(event: MouseEvent): void {
		if (event.target !== event.currentTarget) return;
		void closeCommandPalette();
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

	async function executeCommandPaletteItem(command: CommandPaletteItem): Promise<void> {
		if (!command?.availability.enabled) return;
		await closeCommandPalette();
		await executeCommand(command.id);
	}

	async function openLinkEditor(): Promise<void> {
		if (!selectedItem) return;
		asideMode = "relation";
		await tick();
		const input = document.querySelector<HTMLInputElement>(
			".link-editor input[type=search]",
		);
		input?.focus();
	}

	function inlineSemanticLinksFor(text: string) {
		return parseInlineSemanticLinks(text);
	}

	function semanticLinkAnnotationsFor(occurrenceId: string): SemanticLinkAnnotation[] {
		return semanticLinkAnnotations.filter((annotation) => annotation.occurrenceId === occurrenceId);
	}

	function annotationDirection(annotation: SemanticLinkAnnotation): string {
		return annotation.direction === "symmetric"
			? "↔"
			: annotation.direction === "outgoing" ? "→" : "←";
	}

	async function inspectInlineSemanticLink(candidate: InlineSemanticLinkCandidate): Promise<void> {
		const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
		const reason = candidate.reason === undefined
			? ""
			: `(\"${candidate.reason.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}\")`;
		const advancedInput = `${quote(candidate.source)} :: ${candidate.type}${reason} :: ${quote(candidate.target)}`;
		try {
			const resolution = await api.resolveAdvancedLink(advancedInput);
			asideMode = "relation";
			inlineSemanticLinkNotice = resolution.source.status === "resolved" && resolution.target.status === "resolved"
				? `候補を解決しました: ${candidate.type} · ${candidate.source} → ${candidate.target}`
				: `未確定の候補です: ${resolution.source.reason ?? resolution.target.reason ?? "対象を選択してください。"}`;
		} catch (cause) {
			inlineSemanticLinkNotice = `構文を確認できませんでした: ${errorMessage(cause)}`;
		}
	}

	async function requestRewriteAsNewBranch(): Promise<void> {
		if (!selectedItem || !selectedBranchId) return;
		rewriteBranchName = "";
		await requestConfirmation({
			action: "rewrite",
			occurrenceId: selectedItem.id,
			workId: selectedItem.workId,
			sourceBranchId: selectedBranchId,
		});
	}

	function captureQuickText(): void { void executeCommand("quickCapture"); }
	function requestClearHoist(): void { void executeCommand("clearHoist"); }
	function exportMarkdown(): void { void executeCommand("exportMarkdown"); }
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

	async function performMarkdownExport(): Promise<void> {
		markdownExportNotice = "";
		try {
			await autosave.flush();
			const rendered = renderOutlineSnapshotMarkdown(snapshot);
			const resolutions = markdownExportReferenceMode === "obsidian"
				? await api.resolveInternalReferences(rendered)
				: [];
			const markdown = rewriteMarkdownExportReferences(
				rendered,
				markdownExportReferenceMode,
				resolutions,
			);
			const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `radiora-${localDateValue(new Date())}.md`;
			anchor.hidden = true;
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
			markdownExportNotice = "Markdownをエクスポートしました。";
		} catch (cause) {
			error = `Markdownをエクスポートできませんでした: ${errorMessage(cause)}`;
		}
	}

	async function performOpmlExport(): Promise<void> {
		opmlNotice = "";
		try {
			await autosave.flush();
			const source = await api.exportOpml();
			const blob = new Blob([source], { type: "text/x-opml;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `radiora-${localDateValue(new Date())}.opml`;
			anchor.hidden = true;
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
			opmlNotice = `${vocabulary.opmlExportSuccess}。`;
		} catch (cause) {
			error = `${vocabulary.opmlExport}ことができませんでした: ${errorMessage(cause)}`;
		}
	}

	async function importOpmlFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		opmlNotice = "";
		try {
			await autosave.flush();
			const result = await api.importOpml(await file.text());
			await load();
			opmlNotice = `${vocabulary.opmlImportSuccess}: ${result.importedCount}件。`;
		} catch (cause) {
			error = `${vocabulary.opmlImport}ことができませんでした: ${errorMessage(cause)}`;
		}
	}

	async function performJsonBackupExport(): Promise<void> {
		jsonBackupNotice = "";
		try {
			await autosave.flush();
			const source = await api.exportJsonBackup();
			const blob = new Blob([source], { type: "application/json;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `radiora-backup-${localDateValue(new Date())}.json`;
			anchor.hidden = true;
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
			jsonBackupNotice = `${vocabulary.jsonBackupExportSuccess}。`;
		} catch (cause) {
			error = `${vocabulary.jsonBackupExport}ことができませんでした: ${errorMessage(cause)}`;
		}
	}

	async function restoreJsonBackupFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		jsonBackupNotice = "";
		try {
			await autosave.flush();
			const result = await api.restoreJsonBackup(await file.text());
			await load();
			jsonBackupNotice =
				`${vocabulary.jsonBackupRestoreSuccess}: ${result.workCount}件の${vocabulary.work}。`;
		} catch (cause) {
			error =
				`${vocabulary.jsonBackupRestore}に失敗しました: ${errorMessage(cause)} ${vocabulary.jsonBackupRestoreFailureRecovery}`;
		}
	}

	async function requestConfirmation(confirmation: PendingConfirmation): Promise<void> {
		if (pendingConfirmation) return;
		pendingConfirmation = confirmation;
		await tick();
		if (!confirmationDialog.open) confirmationDialog.showModal();
		if (confirmation.action === "rewrite") {
			await tick();
			rewriteBranchNameInput?.focus();
		}
	}

	function closeConfirmation(): void {
		if (!confirmationSubmitting) confirmationDialog.close();
	}

	function resetConfirmation(): void {
		if (!confirmationSubmitting) {
			pendingConfirmation = null;
			rewriteBranchName = "";
		}
	}

	function preventCloseWhileSubmitting(event: Event): void {
		if (confirmationSubmitting) event.preventDefault();
	}

	async function confirmPendingAction(): Promise<void> {
		const confirmation = pendingConfirmation;
		if (!confirmation || confirmationSubmitting) return;
		if (confirmation.action === "rewrite" && !rewriteBranchName.trim()) return;
		confirmationSubmitting = true;
		try {
			await autosave.flush();
			if (confirmation.action === "trash") {
				await api.trashWork(confirmation.occurrenceId);
				selectOccurrence(null);
				await load();
			} else if (confirmation.action === "purge") {
				await api.purgeWork(confirmation.workId);
				trashEntries = await api.listTrash();
				bookmarks = await api.listBookmarks();
			} else if (confirmation.action === "rewrite") {
				const result = await api.rewriteAsNewBranch(
					confirmation.sourceBranchId,
					rewriteBranchName,
					"confirmed",
				);
				if (result.status === "created") {
					await load(confirmation.occurrenceId);
					await Promise.all([
						loadRevisions(confirmation.workId),
						loadWorkLineage(confirmation.workId),
					]);
					viewMode = "workLineage";
				}
			} else if (confirmation.action === "merge-duplicate") {
				await api.mergeWorks(confirmation.preview);
				await Promise.all([load(), loadDuplicates()]);
			} else if (confirmation.action === "cancel-longform") {
				await confirmation.pendingAction();
				pendingConfirmation = null;
				confirmationDialog.close();
				return;
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

	function titleForWorkId(id: string): string {
		const item = itemByWorkId.get(id);
		if (item) return titleFor(item);
		const unplaced = unplacedWorks.find((work) => work.workId === id);
		return unplaced
			? unplaced.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ??
				`(空の${vocabulary.work})`
			: id;
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

	function formatRecentEditAt(value: string): string {
		const date = new Date(value);
		return Number.isNaN(date.getTime())
			? "更新日時不明"
			: date.toLocaleString("ja-JP", {
				month: "numeric",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
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
		onclick={handleCommandPaletteBackdropClick}
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

<div class="shell" class:nav-collapsed={navCollapsed}>
	<nav class="primary-nav" class:nav-collapsed={navCollapsed} aria-label="主な画面">
		<button
			class="nav-collapse-toggle"
			type="button"
			aria-label={navCollapsed ? "ナビゲーションを開く" : "ナビゲーションを閉じる"}
			aria-expanded={!navCollapsed}
			title={navCollapsed ? "ナビゲーションを開く" : "ナビゲーションを閉じる"}
			onclick={() => (navCollapsed = !navCollapsed)}
		>{navCollapsed ? "»" : "«"}</button>
		<div class="brand"><strong>Radiora</strong><span>v2</span></div>
		<section>
			<p>作業</p>
			<button class:active={viewMode === "today"} aria-pressed={viewMode === "today"}
				onclick={openToday}>{vocabulary.today}</button>
			<button class:active={viewMode === "unplaced"} aria-pressed={viewMode === "unplaced"}
				onclick={openUnplaced}>{vocabulary.unplacedInbox}</button>
			<button class:active={viewMode === "stubs"} aria-pressed={viewMode === "stubs"}
				onclick={openStubs}>{vocabulary.stubList}</button>
		</section>
		<section class="recent-edits" aria-labelledby="recent-edits-heading">
			<p id="recent-edits-heading">最近編集した{vocabulary.work}</p>
			{#each recentEditedItems as item (item.workId)}
				<button
					class:active={viewMode === "outline" && selectedId === item.id}
					onclick={() => void openRecentItem(item)}
				>
					<strong>{titleFor(item)}</strong>
					<small>{item.parentId ? titleForId(item.parentId) : "ルート"} · {formatRecentEditAt(item.updatedAt)}</small>
				</button>
			{:else}
				<span class="nav-empty">編集した{vocabulary.work}はありません</span>
			{/each}
		</section>
		<section>
			<p>探索</p>
			<button class:active={viewMode === "duplicates"} aria-pressed={viewMode === "duplicates"}
				onclick={openDuplicates}>{vocabulary.duplicateCandidates}</button>
		</section>
		<section>
			<p>管理</p>
			<button class:active={viewMode === "trash"} aria-pressed={viewMode === "trash"}
				onclick={openTrash}>ゴミ箱</button>
		</section>
		<section class="nav-tools">
			<p>ツール</p>
			<button class:active={viewMode === "tags"} onclick={openTags}>{vocabulary.tag}管理</button>
			<button class:active={asideMode === "query"} onclick={() => openInspectorTool("query")}
				disabled={!selectedItem}>Query・検索別名</button>
		</section>
	</nav>

	<header class="top-bar">
		<div class="current-location">
			<div class="view-switcher" role="group" aria-label="アウトラインとツリー">
				<button class:active={viewMode === "outline"} aria-pressed={viewMode === "outline"}
					onclick={() => (viewMode = "outline")}>アウトライン</button>
				<button class:active={viewMode === "globalLineage"} aria-pressed={viewMode === "globalLineage"}
					onclick={() => (viewMode = "globalLineage")}>ツリー</button>
			</div>
			{#if viewMode !== "outline" && viewMode !== "globalLineage"}
				<small class="current-location__status">表示中: {viewModeLabel}</small>
			{/if}
		</div>
		<form class="omniwindow" onsubmit={(event) => event.preventDefault()}>
			<input
				aria-label={`${vocabulary.quickCapture}・思索を検索`}
				placeholder="思索を検索、Shift+Enterで未配置箱へ作成…"
				bind:value={quickCaptureText}
				oninput={queueSearch}
				onkeydown={handleSearchKeydown}
				autocomplete="off"
				disabled={startup.phase !== "ready" || quickCaptureSubmitting}
				aria-expanded={Boolean(quickCaptureText.trim())}
			/>
			{#if quickCaptureText.trim()}
				<div class="search-results" role="listbox" aria-label="検索と新規作成の候補">
					{#if suggestions.length}<p class="search-section">タイトル</p>{/if}
					{#each suggestions as suggestion, index}
						<button type="button" class:active={searchActiveIndex === index}
							onclick={() => selectItem(suggestion.item, suggestion.ancestorIds)}>
							<strong>{suggestion.title || `(空の${vocabulary.work})`}</strong>
							<small>先頭一致</small>
						</button>
					{/each}
					{#if searchResults.length}<p class="search-section">本文・関連</p>{/if}
					{#each searchResults as result, index}
						<button type="button" class:active={searchActiveIndex === suggestions.length + index}
							onclick={() => selectSearch(result)}>
							<strong>{titleFor(result.item)}</strong>
							<small>{result.reasons.map((reason) => reason.label).slice(0, 2).join(" · ")}</small>
						</button>
					{/each}
					<p class="search-section">新規作成</p>
					<button type="button" class="create-candidate"
						class:active={searchActiveIndex === searchEntries.length}
						disabled={!commands.quickCapture.enabled}
						title={commands.quickCapture.reason}
						onclick={() => executeCommand("quickCapture")}>
						<strong>「{quickCaptureText.trim()}」を未配置箱へ作成</strong>
						<small>Shift+Enter</small>
					</button>
				</div>
			{/if}
		</form>
		<div class="top-actions">
			<div class="toolbar-group toolbar-nav" aria-label="ナビゲーション">
				<button onclick={resumeEditing}>{vocabulary.resumePosition}から再開</button>
			</div>
			<details class="toolbar-menu">
				<summary>書き出し／データ</summary>
				<div class="toolbar-menu__content">
			<input
				class="sr-only"
				type="file"
				accept=".opml,.xml,text/x-opml,application/xml,text/xml"
				aria-label={vocabulary.opmlImport}
				bind:this={opmlFileInput}
				onchange={importOpmlFile}
			/>
			<button
				onclick={() => opmlFileInput.click()}
				disabled={startup.phase !== "ready"}
			>{vocabulary.opmlImport}</button>
			<button
				onclick={performOpmlExport}
				disabled={startup.phase !== "ready"}
			>{vocabulary.opmlExport}</button>
			{#if opmlNotice}
				<small class="opml-notice" role="status">{opmlNotice}</small>
			{/if}
			<button
				onclick={performJsonBackupExport}
				disabled={startup.phase !== "ready"}
			>{vocabulary.jsonBackupExport}</button>
			<input
				class="sr-only"
				type="file"
				accept=".json,application/json"
				aria-label={vocabulary.jsonBackupRestore}
				bind:this={jsonBackupFileInput}
				onchange={restoreJsonBackupFile}
			/>
			<button
				onclick={() => jsonBackupFileInput.click()}
				disabled={startup.phase !== "ready"}
			>{vocabulary.jsonBackupRestore}</button>
			{#if jsonBackupNotice}
				<small class="json-backup-notice" role="status">{jsonBackupNotice}</small>
			{/if}
			<label>
				<span class="sr-only">{vocabulary.markdownExportMode}</span>
				<select
					bind:value={markdownExportReferenceMode}
					aria-label={vocabulary.markdownExportMode}
				>
					<option value="radiora">{vocabulary.markdownExportRadiora}</option>
					<option value="portable">{vocabulary.markdownExportPortable}</option>
					<option value="obsidian">{vocabulary.markdownExportObsidian}</option>
				</select>
			</label>
			<button
				onclick={exportMarkdown}
				disabled={!commands.exportMarkdown.enabled}
				title={commands.exportMarkdown.reason}
			>Markdownでエクスポート</button>
			{#if markdownExportNotice}
				<small class="markdown-export-notice" role="status">{markdownExportNotice}</small>
			{/if}
				</div>
			</details>
			{#each bookmarks as bookmark}
				<span class="bookmark-control">
					<button onclick={() => openBookmark(bookmark.id)}>{vocabulary.bookmark} {bookmark.id.slice(0, 4)}</button>
					<button aria-label={`${vocabulary.bookmark}を削除`} onclick={() => removeBookmark(bookmark.id)}>×</button>
				</span>
			{/each}
			<button class="inspector-jump" onclick={revealInspector}>詳細</button>
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
		<main class="app-main startup-main">
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
	<main
		class="app-main"
		class:full-workspace={dedicatedView}
		class:inspector-collapsed={inspectorCollapsed}
		style={`--inspector-width:${inspectorColumn}`}
	>
		{#if viewMode === "outline"}
			<section class="outline-panel">
				<!-- browsing.panes remains an internal extension point; vocabulary.pane is intentionally not rendered. -->
				{#if longForm.active}
					{#if selectedItem}
						<div class="section-title"><span>Outline · 長文編集</span></div>
						<div class="long-form-editor">
							<div class="long-form-breadcrumb">
								{#each selectedBreadcrumb as ancestor (ancestor.id)}
									<span>{titleFor(ancestor)} › </span>
								{/each}
								<span class="long-form-title">{titleFor(selectedItem)}</span>
							</div>
							<div class="long-form-toolbar">
								<button
									class:active={!longForm.preview}
									onclick={() => (longForm.preview = false)}
								>編集</button>
								<button
									class:active={longForm.preview}
									onclick={() => (longForm.preview = true)}
								>プレビュー</button>
							</div>
							{#if longForm.preview}
								<div class="long-form-preview">{@html renderMarkdownPreview(longForm.text)}</div>
							{:else}
								<textarea
									class="long-form-textarea"
									value={longForm.text}
									oninput={(event) => handleLongFormInput(event.currentTarget.value)}
								></textarea>
							{/if}
							<div class="long-form-actions">
								<button
									onclick={saveLongFormEditing}
									disabled={!longForm.dirty}
								>保存</button>
								<button onclick={cancelLongFormEditing}>キャンセル</button>
							</div>
						</div>
					{/if}
			{:else}
				<div class="outline-context">
					<div>
						{#if outlineContextBreadcrumb}
							<nav class="outline-context__breadcrumb" aria-label={vocabulary.breadcrumb}>
								{#each outlineContextBreadcrumbItems as ancestor (ancestor.id)}
									<button onclick={() => openBreadcrumb(ancestor.id)}>{titleFor(ancestor)}</button>
									<span aria-hidden="true">›</span>
								{/each}
							</nav>
						{/if}
						<h1>{outlineContextTitle}</h1>
						<p class="outline-context__meta">
							{visibleRows.filter((row) => !row.stash).length}件の{vocabulary.work} · 行をそのまま編集できます
						</p>
					</div>
					<div class="section-title outline-actions">
						{#if browsingLocation.hoistOccurrenceId}
							<button onclick={requestClearHoist} disabled={!commands.clearHoist.enabled} title={commands.clearHoist.reason}>{vocabulary.hoist}を解除</button>
						{/if}
						<button onclick={createRoot}>＋ ルートに追加</button>
					</div>
				</div>
				{#if loading}
					<p class="empty">Loading…</p>
				{:else if snapshot.items.length === 0}
					<button class="first-item" onclick={createRoot}>最初の{vocabulary.work}を作る</button>
				{:else}
					<div class="rows">
						{#each visibleRows.filter((row) => !row.stash) as row (row.item.id)}
							{@const inlineLinks = inlineSemanticLinksFor(row.item.text)}
							{@const annotations = semanticLinkAnnotationsFor(row.item.id)}
							{@const rowBody = bodyFor(row.item)}
							<div class:selected={selectedId === row.item.id} class:dragging={draggedId === row.item.id} class="row" style={`--depth:${row.depth}`} role="treeitem"
								aria-selected={selectedId === row.item.id} tabindex="-1"
								draggable="true" ondragstart={() => draggedId = row.item.id} ondragend={() => draggedId = null}
								ondragover={(event) => event.preventDefault()} ondrop={() => dropOn(row.item)}>
								<button class="disclosure" class:hidden={!row.hasChildren} onclick={() => toggle(row)}>{row.item.collapsed ? "›" : "⌄"}</button>
								{#if row.item.referenceStub}<span class="reference-stub" title="再帰参照">↩</span>{/if}
								<button class="bullet" aria-label={`${vocabulary.work}を選択`} title={`ダブルクリックでこの${vocabulary.work}へZoom`}
									onclick={() => selectOccurrence(row.item.id)} ondblclick={() => hoistOccurrence(row.item.id)}>•</button>
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
									{#if rowBody && selectedId !== row.item.id}
										<p class="row-body-preview">{rowBody.replace(/\s+/gu, " ").trim()}</p>
									{/if}
					{#if inlineLinkCompletion?.itemId === row.item.id}
						<div class="inline-link-completions" role="listbox" aria-label={`@${vocabulary.semanticLink}候補`}>
							{#if inlineLinkCompletion.phase === "candidate"}
								<p class="inline-link-completions__hint">@{vocabulary.semanticLink}先を検索</p>
								{#each inlineLinkCompletion.candidates as candidate, index (candidate.scope + candidate.id)}
									<button
										class:active={index === inlineLinkCompletion.activeIndex}
										role="option"
										aria-selected={index === inlineLinkCompletion.activeIndex}
										onmousedown={(event) => event.preventDefault()}
										onclick={() => selectInlineLinkCandidate(row.item.id, candidate)}
									>
										<strong>{candidate.displayName}</strong>
										<span>{candidate.scopeLabel} · {candidate.shortId}</span>
									</button>
								{:else}
									<p>一致する候補はありません。</p>
								{/each}
							{:else}
								{#if inlineLinkCompletion.selectedCandidate}
									<div class="inline-link-completions__target">
										<strong>@{inlineLinkCompletion.selectedCandidate.displayName}</strong>
										<span>{vocabulary.linkType}を選択</span>
									</div>
									{#if inlineLinkCompletion.phase === "type"}
										<div class="inline-link-types" aria-label={vocabulary.linkType}>
											{#each LINK_TYPES as type}
												<button
													class:active={inlineLinkCompletion.selectedType === type}
													onmousedown={(event) => event.preventDefault()}
													onclick={() => {
																	selectInlineLinkType(row.item.id, type);
													}}
												>{type}</button>
											{/each}
										</div>
									{:else}
										<div class="inline-link-direction" aria-label={`${vocabulary.semanticLink}方向`}>
											<button
												class:active={inlineLinkCompletion.direction === "forward"}
												onmousedown={(event) => event.preventDefault()}
												onclick={() => setInlineLinkDirection(row.item.id, "forward")}
											>{titleFor(row.item)} → {inlineLinkCompletion.selectedCandidate.displayName}</button>
											<button
												class:active={inlineLinkCompletion.direction === "reverse"}
												onmousedown={(event) => event.preventDefault()}
												onclick={() => setInlineLinkDirection(row.item.id, "reverse")}
											>{inlineLinkCompletion.selectedCandidate.displayName} → {titleFor(row.item)}</button>
										</div>
										<p class="inline-link-preview" role="status">
											{inlineLinkCompletion.direction === "forward"
												? previewDirection(titleFor(row.item), inlineLinkCompletion.selectedType ?? "RELATED", inlineLinkCompletion.selectedCandidate.displayName)
												: previewDirection(inlineLinkCompletion.selectedCandidate.displayName, inlineLinkCompletion.selectedType ?? "RELATED", titleFor(row.item))}
										</p>
										<button type="button" onclick={() => void commitInlineLink(row.item.id)}>この方向で{vocabulary.semanticLink}</button>
									{/if}
								{/if}
							{/if}
						</div>
					{/if}
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
									{#if inlineLinks.candidates.length || inlineLinks.diagnostics.length}
										<div class="inline-semantic-links" aria-label="本文中の関係候補">
											{#each inlineLinks.candidates as candidate (candidate.start)}
												<button type="button" onclick={() => void inspectInlineSemanticLink(candidate)}>
													<span>{candidate.source} · {candidate.type} · {candidate.target}</span>
													{#if candidate.reason}<small>「{candidate.reason}」</small>{/if}
												</button>
											{/each}
											{#each inlineLinks.diagnostics as diagnostic (diagnostic.start)}
												<p class="inline-semantic-link-error" role="status">{diagnostic.message}</p>
											{/each}
										</div>
									{/if}
									{#if annotations.length}
										<div class="semantic-link-annotations" aria-label="関係注釈">
											{#each annotations as annotation (annotation.linkId)}
												<p>
													<span aria-hidden="true">┄ {annotationDirection(annotation)}</span>
													<strong>{annotation.type}</strong>
													<span>{annotation.otherDisplayName}</span>
													<small>「{annotation.reason}」</small>
												</p>
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
				<p class="filter-hint">自由語は部分一致 · タグはすべて含む（AND） · NOTタグは除外 · この表示だけに適用</p>
				<div class="filter-bar">
					<input
						class="filter-input"
						aria-label="テキストで絞り込み"
						placeholder="テキストで絞り込み…"
						bind:value={outlineFilter.freeText}
					/>
					<input
						class="filter-input"
						aria-label="タグ AND"
						placeholder="#タグ AND"
						bind:value={outlineFilter.tagsAll}
					/>
					<input
						class="filter-input"
						aria-label="タグ NOT"
						placeholder="#除外 NOT"
						bind:value={outlineFilter.tagsNone}
					/>
					<button onclick={clearOutlineFilter} disabled={!outlineFilter.freeText && !outlineFilter.tagsAll && !outlineFilter.tagsNone}>解除</button>
				</div>
				{#if dateProjectionLoading}
					<p class="empty">読み込み中…</p>
				{:else if dateProjection}
					<section aria-label="この期間に作成">
						<h2>この期間に作成 <small>{filteredTodayCreated.length}件{#if filteredTodayCreated.length !== dateProjection.created.length} / {dateProjection.created.length}件{/if}</small></h2>
						{#each filteredTodayCreated as entry (entry.work.id)}
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
						<h2>この期間に更新 <small>{filteredTodayUpdated.length}件{#if filteredTodayUpdated.length !== dateProjection.updated.length} / {dateProjection.updated.length}件{/if}</small></h2>
						{#each filteredTodayUpdated as entry (entry.work.id)}
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
					<span>{vocabulary.unplacedInbox}</span><small>{filteredUnplacedWorks.length}件{#if filteredUnplacedWorks.length !== unplacedWorks.length} / {unplacedWorks.length}件{/if}</small>
				</div>
				<p class="hint">
				配置先を決めずに保存した、本文のある{vocabulary.work}です。本文へ #タグ を入力するとタグ付けできます。
				本文未記入の{vocabulary.stub}は{vocabulary.stubList}で管理します。
				</p>
				<p class="filter-hint">自由語は部分一致 · タグはすべて含む（AND） · NOTタグは除外 · この表示だけに適用</p>
				<div class="filter-bar">
					<input
						class="filter-input"
						aria-label="テキストで絞り込み"
						placeholder="テキストで絞り込み…"
						bind:value={outlineFilter.freeText}
					/>
					<input
						class="filter-input"
						aria-label="タグ AND"
						placeholder="#タグ AND"
						bind:value={outlineFilter.tagsAll}
					/>
					<input
						class="filter-input"
						aria-label="タグ NOT"
						placeholder="#除外 NOT"
						bind:value={outlineFilter.tagsNone}
					/>
					<button onclick={clearOutlineFilter} disabled={!outlineFilter.freeText && !outlineFilter.tagsAll && !outlineFilter.tagsNone}>解除</button>
				</div>
				<div class="unplaced-list">
					{#each filteredUnplacedWorks as work (work.workId)}
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
		{:else if viewMode === "stubs"}
			<section class="outline-panel stub-list" aria-label={vocabulary.stubList}>
				<div class="section-title">
					<span>{vocabulary.stubList}</span><small>{stubEntries.length}件</small>
				</div>
				<p class="hint">
					{vocabulary.stub}は本文をこれから書くために明示作成された未配置の{vocabulary.work}です。
					本文を書き足してから明示的に解除してください。
				</p>
				<button type="button" onclick={createStubFromList}>新規{vocabulary.stub}を作成</button>
				<div class="unplaced-list">
					{#each stubEntries as entry (entry.workId)}
						<article class="unplaced-entry stub-entry">
							<small>
								{formatStubInstant(entry.createdAt)} · {stubCreatedViaLabel(entry)}
								{#if entry.context} · {vocabulary.stubContext}: {entry.context}{/if}
							</small>
							<textarea
								rows="3"
								aria-label={`${vocabulary.stub}の${vocabulary.workingCopy}を編集`}
								placeholder={`${vocabulary.workingCopy}をここに書き足す`}
								value={entry.text}
								onchange={(event) => updateStubText(entry, event.currentTarget.value)}
							></textarea>
							{#if entry.backlinks.length}
								<div class="stub-backlinks" aria-label={vocabulary.backlink}>
									{#each entry.backlinks as backlink, index (index)}
										<small>
											{vocabulary.backlink}: {backlink.displayName || `(空の${vocabulary.work})`}
											× {backlink.count}
										</small>
									{/each}
								</div>
							{/if}
							<div class="unplaced-actions">
								<button
									onclick={() => resolveStubEntry(entry.workId)}
									disabled={!entry.hasText}
								>{vocabulary.stub}を解除</button>
							</div>
						</article>
					{:else}
						<p class="empty">{vocabulary.stubList}は空です。</p>
					{/each}
				</div>
			</section>
		{:else if viewMode === "duplicates"}
			<DuplicateCandidatesPanel
				candidates={duplicateCandidates}
				{vocabulary}
				onRequestMerge={requestDuplicateMerge}
				onCreateLink={createDuplicateCandidateLink}
				onDismiss={excludeDuplicateCandidate}
			/>
		{:else if viewMode === "tags"}
			<section class="outline-panel tag-browser" aria-label={vocabulary.tag}>
				<div class="tag-browser__heading">
					<div>
						<p class="eyebrow">知識の入口</p>
						<h1>{vocabulary.tag}</h1>
						<p>タグを選ぶと、付いている{vocabulary.work}を表示します。</p>
					</div>
				</div>
				{#if tagError}<p class="query-error">{tagError}</p>{/if}
				<section class="tag-browser__cloud" aria-label={`${vocabulary.tag}クラウド`}>
					{#each tagCloud as tag (tag.name)}
						<button
							class:active={selectedTag === tag.name}
							aria-pressed={selectedTag === tag.name}
							style={`font-size:${tagCloudFontSize(tag.workIds.length)}`}
							onclick={() => selectTag(tag.name)}
						>
							<span>#{tag.name}</span>
							<small>{tag.workIds.length}{vocabulary.work}</small>
						</button>
					{:else}
						<p class="empty">{vocabulary.tag}はまだありません。</p>
					{/each}
				</section>
				{#if selectedTag}
					<section class="tag-browser__results" aria-live="polite">
						<div class="section-title">
							<span>#{selectedTag}</span>
							<small>{selectedTagNodeIds.length}{vocabulary.work}</small>
						</div>
						<div>
							{#each selectedTagNodeIds as workId (workId)}
								<button onclick={() => openTagNode(workId)}>
									<strong>{titleForWorkId(workId)}</strong>
									<span>{itemByWorkId.has(workId) ? "アウトラインで開く" : vocabulary.unplacedInbox}</span>
								</button>
							{/each}
						</div>
					</section>
				{:else}
					<p class="tag-browser__prompt">{vocabulary.tag}を選ぶと{vocabulary.work}一覧を表示します。</p>
				{/if}
				<details class="tag-browser__maintenance">
					<summary>{vocabulary.tag}を整理</summary>
					<datalist id="tag-candidates">
						{#each tagCloud as tag}<option value={`#${tag.name}`}>{tag.workIds.length}{vocabulary.work}</option>{/each}
					</datalist>
					<div class="tag-browser__maintenance-grid">
						<label>名前変更
							<input bind:value={tagRenameFrom} list="tag-candidates" placeholder="変更前" />
							<input bind:value={tagRenameTo} placeholder="変更後" />
							<button onclick={renameTag}>名前変更</button>
						</label>
						<label>統合
							<input bind:value={tagMergeSources} list="tag-candidates" placeholder="統合元をカンマ区切り" />
							<input bind:value={tagMergeTarget} placeholder="統合先" />
							<button onclick={mergeTags}>統合</button>
						</label>
					</div>
					{#if tagAliases.length}
						<p class="tag-browser__aliases">{tagAliases.map((alias) => `#${alias.variants.join(", #")} → #${alias.canonicalName}`).join(" · ")}</p>
					{/if}
				</details>
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
					<div class="work-lineage-workspace">
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
					</div>
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

		{#if !dedicatedView}
			<aside bind:this={inspectorElement} class="inspector">
			<button
				class="inspector-resize-handle"
				type="button"
				aria-label="右ペインの幅を変更"
				onpointerdown={startInspectorResize}
				title="ドラッグして幅を変更"
			></button>
			{#if selectedItem}
				<nav class="aside-tabs" aria-label="詳細表示">
					<button class:active={asideMode === "overview"} onclick={() => (asideMode = "overview")}>概要</button>
					<button class:active={asideMode === "relation"} onclick={() => (asideMode = "relation")}>関係</button>
					<button class:active={asideMode === "history"} onclick={() => (asideMode = "history")}>履歴</button>
				</nav>
				<p class="eyebrow">選択中</p>
				<div class="inspector-heading">
					<h2>{titleFor(selectedItem)}</h2>
					<div class="inspector-heading-actions">
						<button class="inspector-action" onclick={addBookmark} disabled={!commands.addBookmark.enabled} title={commands.addBookmark.reason}>☆ {vocabulary.bookmark}</button>
						<button class="clear-selection" onclick={() => selectOccurrence(null)}>選択解除</button>
						<button class="clear-selection" onclick={() => (inspectorCollapsed = true)}>閉じる</button>
					</div>
				</div>
				{#if asideMode === "overview"}
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
						<button onclick={startLongFormEditing} disabled={!commands.startLongFormEditing.enabled} title={commands.startLongFormEditing.reason}>長文編集</button>
						<button onclick={duplicateSelectedOccurrence}>同じ{vocabulary.work}をもう一箇所へ配置</button>
						<button onclick={() => remove(selectedItem.id)}>この{vocabulary.occurrence}を外す</button>
						<button onclick={trashSelectedWork}>{vocabulary.work}をゴミ箱へ</button>
					</div>
					<div class="thought-meta">
						<div><span class="meta-label">作成日</span><time datetime={selectedItem.createdAt}>{formatCreatedAt(selectedItem.createdAt)}</time></div>
						<div><span class="meta-label">更新日</span><time datetime={selectedItem.updatedAt}>{formatCreatedAt(selectedItem.updatedAt)}</time></div>
						{#if selectedItem.parentId}
							<div><span class="meta-label">親</span><span>{titleForId(selectedItem.parentId)}</span></div>
						{/if}
					</div>
					{#if viewMode === "outline"}
						<p class="hint">Enter: 兄弟　Shift+Enter: 改行<br />Tab / Shift+Tab: 階層　Alt+↑↓: 移動</p>
					{/if}
				{:else if asideMode === "relation"}
					<LinkEditor
						selectedWorkId={selectedItem.workId}
						selectedDisplayName={titleFor(selectedItem)}
						links={selectedLinks}
						titleForWork={titleForWorkId}
						onConfirm={(input) => executeCommand("createLink", undefined, input)}
						onDelete={removeLink}
						onReverse={reverseLink}
						onCompare={(link) => openLinkComparison(link.id)}
					/>
					{#if inlineSemanticLinkNotice}
						<p class="inline-semantic-link-notice" role="status">{inlineSemanticLinkNotice}</p>
					{/if}
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
					<div class="discoveries">
						{#if emergenceLoading}<p class="empty">{vocabulary.emergenceLoading}</p>{/if}
						{#each emergenceSuggestions as suggestion}
							<article class:pinned={suggestion.status === "pinned"}>
								<div class="discovery-title"><span>{suggestion.title}</span><small>{Math.round(suggestion.score * 100)}%</small></div>
								<strong>{titleForId(suggestion.targetItemId)}</strong>
								<p>{suggestion.explanation}</p>
								<ol>{#each suggestion.evidence as step}<li>{step.relation}: {titleForId(step.fromId)} → {titleForId(step.toId)}</li>{/each}</ol>
								<input
									aria-label={vocabulary.emergenceResolutionReason}
									placeholder={vocabulary.emergenceResolutionReason}
									value={emergenceResolutionReasons[suggestion.id] ?? ""}
									oninput={(event) =>
										(emergenceResolutionReasons = {
											...emergenceResolutionReasons,
											[suggestion.id]: event.currentTarget.value,
										})}
								/>
								<div class="discovery-actions">
									{#if suggestion.proposedLinkType}<button onclick={() => resolveEmergence(suggestion, "accept")}>{vocabulary.emergenceAccept}</button>{/if}
									<button onclick={() => resolveEmergence(suggestion, "pin")}>{vocabulary.emergenceHold}</button>
									<button
										onclick={() => resolveEmergence(suggestion, "dismiss")}
										disabled={!emergenceResolutionReasons[suggestion.id]?.trim()}
									>{vocabulary.emergenceDismiss}</button>
								</div>
							</article>
						{:else}
							{#if !emergenceLoading}<p class="empty">{vocabulary.noEmergenceSuggestion}</p>{/if}
						{/each}
					</div>
				{:else if asideMode === "history"}
					<div class="history-panel">
						<p class="hint">選択中の{vocabulary.work}に従属する履歴です。</p>
						<button onclick={() => (viewMode = "workLineage")} disabled={!selectedItem}>
							{vocabulary.workLineage}を開く
						</button>
						<button onclick={openSelectedRevisionComparison} disabled={!selectedItem}>
							{vocabulary.revision}{vocabulary.comparisonPane}を開く
						</button>
						{#if selectedBranchId}
							<button onclick={() => (viewMode = "workLineage")}>
								Recovery snapshotsを開く
							</button>
							<small>{recoverySnapshots.length}件のRecovery snapshot</small>
						{:else}
							<small>Recoveryは{vocabulary.branch}を選択すると利用できます。</small>
						{/if}
					</div>
				{:else}
					<div class="query-panel">
						<label for="rule-source">読み取り専用Datalog</label>
						<textarea id="rule-source" rows="6" bind:value={ruleSource} spellcheck="false"></textarea>
						<div class="query-actions"><button onclick={executeRule} disabled={!commands.runQuery.enabled} title={commands.runQuery.reason}>実行</button><input placeholder="保存名" bind:value={ruleName} /><button onclick={saveRule} disabled={!commands.saveQuery.enabled} title={commands.saveQuery.reason}>保存</button></div>
						{#if ruleError}<p class="query-error">{ruleError}</p>{/if}
						{#if ruleResult}
							<p class="query-meta">{ruleResult.rows.length}件・{ruleResult.elapsedMs.toFixed(1)}ms</p>
							{#if sparseOutlineNodes.length}
								<div class="sparse-outline-section">
									<div class="sparse-outline-header">
										<h3>{vocabulary.sparseOutline}<small>{sparseOutlineQueryName}</small></h3>
										<button class="sparse-toggle" onclick={() => (showSparseOutline = !showSparseOutline)}>
											{showSparseOutline ? "テーブル表示" : "投影表示"}
										</button>
									</div>
									{#if showSparseOutline}
										<SparseOutlineView nodes={sparseOutlineNodes} onSelectNode={handleSparseOutlineSelect} />
									{:else}
										<div class="query-table"><table><thead><tr>{#each ruleResult.columns as column}<th>{column}</th>{/each}</tr></thead>
											<tbody>{#each ruleResult.rows as row}<tr>{#each row as value}<td>{titleForId(value)}</td>{/each}</tr>{/each}</tbody>
										</table></div>
									{/if}
								</div>
							{:else}
								<div class="query-table"><table><thead><tr>{#each ruleResult.columns as column}<th>{column}</th>{/each}</tr></thead>
									<tbody>{#each ruleResult.rows as row}<tr>{#each row as value}<td>{titleForId(value)}</td>{/each}</tr>{/each}</tbody>
								</table></div>
							{/if}
						{/if}
						<div class="saved-queries">
							{#each savedRuleQueries as saved}
								<button onclick={() => void loadSparseOutlineForQuery(saved)}>{saved.name}</button>
								<button class="remove-saved" onclick={() => removeRule(saved.id)}>×</button>
							{/each}
						</div>
						<h3>検索別名</h3>
						<input placeholder="基準語" bind:value={aliasCanonical} />
						<textarea rows="2" placeholder="別名（カンマ区切り）" bind:value={aliasVariants}></textarea>
						<button onclick={saveAlias}>別名を追加</button>
						<div class="alias-list">{#each aliases as alias}<div><span>{alias.canonical} ↔ {alias.variants.join(", ")}</span><button onclick={() => removeAlias(alias.id)}>×</button></div>{/each}</div>
					</div>
				{/if}
			{:else}
				<div class="aside-empty">
					<button class="inspector-close" type="button" onclick={() => (inspectorCollapsed = true)}>閉じる</button>
					<span>•</span><p>{vocabulary.work}を選択すると<br />関連{vocabulary.semanticLink}を編集できます</p>
				</div>
			{/if}
		</aside>
		{/if}
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
				{pendingConfirmation.action === "trash"
					? `${vocabulary.work}をゴミ箱へ移しますか？`
					: pendingConfirmation.action === "rewrite"
					? `新しい${vocabulary.branch}として書き直しますか？`
				: pendingConfirmation.action === "merge-duplicate"
					? vocabulary.duplicateMergeConfirm
					: pendingConfirmation.action === "cancel-longform"
					? "長文編集をキャンセルしますか？"
					: "完全消去しますか？"}
			</h2>
			<p id="confirmation-description">
				{#if pendingConfirmation.action === "trash"}
					{pendingConfirmation.occurrenceCount}件の{vocabulary.occurrence}と{vocabulary.semanticLink}は保持されます。
				{:else if pendingConfirmation.action === "rewrite"}
					現在の{vocabulary.workingCopy}を分岐点として保存し、元の{vocabulary.branch}を残したまま
					独立した{vocabulary.workingCopy}を作ります。
			{:else if pendingConfirmation.action === "merge-duplicate"}
					{pendingConfirmation.preview.sourceTitle || `(空の${vocabulary.work})`}
					→ {pendingConfirmation.preview.survivorTitle || `(空の${vocabulary.work})`}
					<br />
					{vocabulary.occurrence}: {pendingConfirmation.preview.occurrenceIds.length} /
					{vocabulary.semanticLink}: {pendingConfirmation.preview.links.length}
				{:else if pendingConfirmation.action === "cancel-longform"}
					保存されていない編集内容は失われます。
				{:else}
					{vocabulary.occurrence}{pendingConfirmation.occurrenceCount}件、{vocabulary.semanticLink}{pendingConfirmation.linkCount}件と本文を復元できなくなります。
				{/if}
			</p>
			{#if pendingConfirmation.action === "rewrite"}
				<label>
					{vocabulary.branch}名
					<input
						bind:this={rewriteBranchNameInput}
						bind:value={rewriteBranchName}
						autocomplete="off"
						onkeydown={(event) => {
							if (event.key === "Enter" && rewriteBranchName.trim()) {
								event.preventDefault();
								void confirmPendingAction();
							}
						}}
					/>
				</label>
			{/if}
			<div class="confirmation-dialog__actions">
				<button onclick={closeConfirmation} disabled={confirmationSubmitting}>キャンセル</button>
				<button
					class:delete={pendingConfirmation.action !== "rewrite"}
					onclick={confirmPendingAction}
					disabled={confirmationSubmitting ||
						(pendingConfirmation.action === "rewrite" && !rewriteBranchName.trim())}
				>
					{confirmationSubmitting
						? "処理中…"
						: pendingConfirmation.action === "trash"
						? "ゴミ箱へ移す"
						: pendingConfirmation.action === "rewrite"
						? `新しい${vocabulary.branch}を作る`
						: pendingConfirmation.action === "merge-duplicate"
						? vocabulary.duplicateMerge
						: pendingConfirmation.action === "cancel-longform"
						? "編集を破棄"
						: "完全消去"}
				</button>
			</div>
		</div>
	{/if}
</dialog>
