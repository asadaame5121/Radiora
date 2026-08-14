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
	import InAppHelp from "./InAppHelp.svelte";
	import ContextMenu from "./ContextMenu.svelte";
	import TodayView from "./TodayView.svelte";
	import StubListView from "./StubListView.svelte";
	import UnplacedInboxView from "./UnplacedInboxView.svelte";
	import TagBrowserView from "./TagBrowserView.svelte";
	import TrashView from "./TrashView.svelte";
	import OptionsView from "./OptionsView.svelte";
	import WorkingCopySaveStatus from "./WorkingCopySaveStatus.svelte";
	import StartupCacheStatus from "./StartupCacheStatus.svelte";
	import StartupView from "./StartupView.svelte";
	import PrimaryNavigation, {
		type RecentNavigationItem,
	} from "./PrimaryNavigation.svelte";
	import ConfirmationDialog from "./ConfirmationDialog.svelte";
	import Toast from "./Toast.svelte";
	import CommandPaletteDialog from "./CommandPaletteDialog.svelte";
	import LicensesDialog, {
		type LicenseEntry,
		type LicenseIndex,
	} from "./LicensesDialog.svelte";
	import {
		createConfirmationController,
		type PendingConfirmation,
	} from "./confirmation_controller.svelte.ts";
	import { createEditorController } from "./editor_controller.svelte.ts";
	import { createEmergenceController } from "./emergence_controller.svelte.ts";
	import { createNavigationController } from "./navigation_controller.svelte.ts";
	import { createWorkController } from "./work_controller.svelte.ts";
	import type { ContextMenuItem } from "./context_menu";
	import { createRpcAdapter } from "./rpc_adapter";
	import type {
		Bookmark,
		CreateLinkInput,
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
		TransientProjectionNode,
	} from "../domain/models";
	import { isSymmetricLinkType, LINK_TYPES } from "../domain/models";
	import type { RadioraBindings, StartupStatus } from "../shared/bindings";
	import type {
		GlobalLineageProjection,
	WorkLineageProjection,
	} from "../services/branch_service";
	import type { DateProjection, DateRange } from "../services/date_projection";
	import {
		renderOutlineSnapshotMarkdown,
		rewriteMarkdownExportReferences,
		selectMarkdownExportSnapshot,
	} from "../services/markdown_export";
	import {
		loadMarkdownExportPreference,
		saveMarkdownExportPreference,
	} from "./markdown_export_preference";
	import {
		loadQuickCapturePreference,
		saveQuickCapturePreference,
	} from "./quick_capture_preference";
	import {
		clampInspectorWidth,
		loadUiLayoutPreference,
		saveUiLayoutPreference,
	} from "./ui_layout_preference";
	import {
		loadTreeProjectionPreference,
		saveTreeProjectionPreference,
	} from "./tree_projection_preference";
	import {
		loadTreeFilterPreference,
		saveTreeFilterPreference,
	} from "./tree_filter_preference";
	import type { GlobalLineageFilter } from "../services/global_lineage_filter";
	import type { TreeProjection } from "./tree_layout";
	import {
		ancestorBreadcrumb,
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
	import { EDITOR_BINDINGS } from "../shared/editor_bindings.ts";
	import {
	commandPaletteItems,
	type CommandPaletteItem,
	} from "./command_palette.ts";
	import {
		comparisonDocumentKey,
		type LinkComparisonProjection,
		type WorkComparisonDocuments,
	} from "../services/comparison_service";
	import { previewDirection } from "../services/advanced_link_resolver";
	import {
		EMPTY_OUTLINE_FILTER,
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
	import type { ViewMode } from "./app_view_mode.ts";

	const api = createRpcAdapter<RadioraBindings>();

	type AsideMode = "overview" | "relation" | "history" | "query";
	type OccurrenceContextMenuState = {
		targetId: string;
		source: "outline" | "tree";
		x: number;
		y: number;
		triggerElement: HTMLElement | SVGElement | null;
	};

	const vocabulary = useUiVocabulary();
	let snapshot = $state<OutlineSnapshot>({ items: [], links: [], knots: [], stashItemIds: [] });
	let loading = $state(true);
	let startupCacheActive = $state(false);
	let startupDataLoaded = false;
	let startup = $state<StartupStatus>({ phase: "starting", message: "Radioraを起動しています…" });
	let error = $state("");
	let outlineFilter = $state<OutlineFilter>({ ...EMPTY_OUTLINE_FILTER });
	let longForm = $state({
		active: false,
		text: "",
		dirty: false,
		preview: false,
	});
	let viewMode = $state<ViewMode>("outline");
	let dateStart = $state(localDateValue(new Date()));
	let dateEnd = $state(localDateValue(addDays(new Date(), 1)));
	let dateProjection = $state<DateProjection | null>(null);
	let dateProjectionLoading = $state(false);
	let selectedId = $state<string | null>(null);
	const navigationController = createNavigationController({
		searchPort: {
			suggestItems: (prefix, limit) => api.suggestItems(prefix, limit),
			searchItems: (request) => api.searchItems(request),
			getSelectedId: () => selectedId,
			reportError: (cause) => error = errorMessage(cause),
		},
	});
	let bookmarks = $state<Bookmark[]>([]);
	let transientExpandedIds = $state<string[]>([]);
	let asideMode = $state<AsideMode>("overview");
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
	const confirmationController = createConfirmationController();
	let confirmationDialog: ConfirmationDialog;
	let licensesDialog = $state<HTMLDialogElement>();
	let licenseIndex = $state<LicenseIndex | null>(null);
	let licenseDetail = $state<{ name: string; text: string } | null>(null);
	let licenseError = $state("");
	let licenseLoading = $state(false);
	let commandPaletteRestoreFocus: HTMLElement | null = null;
	let inspectorElement = $state<HTMLElement | null>(null);
	let inlineSemanticLinkNotice = $state("");
	let markdownExportNotice = $state("");
	let markdownExportPreference = $state(loadMarkdownExportPreference());
	let quickCapturePreference = $state(loadQuickCapturePreference());
	let opmlNotice = $state("");
	let jsonBackupNotice = $state("");
	const initialUiLayoutPreference = loadUiLayoutPreference();
	let inspectorWidth = $state(initialUiLayoutPreference.inspectorWidth);
	let inspectorCollapsed = $state(initialUiLayoutPreference.inspectorCollapsed);
	let navCollapsed = $state(initialUiLayoutPreference.navCollapsed);
	let occurrenceContextMenu = $state<OccurrenceContextMenuState | null>(null);
	let treeProjectionPreference = $state<TreeProjection>(loadTreeProjectionPreference());
	let treeFilter = $state<GlobalLineageFilter>(loadTreeFilterPreference());
	let globalLineageRequest = 0;
	const workController = createWorkController({
		api,
		getSnapshot: () => snapshot,
		reload: load,
		openView: (view) => viewMode = view,
		selectOccurrence,
		requestConfirmation,
		reportError: (cause) => error = errorMessage(cause),
		clearQuickCaptureInput: () => navigationController.clearOmniwindow(),
		reloadBookmarks: async () => {
			bookmarks = await api.listBookmarks();
		},
	});
	const emergenceController = createEmergenceController({
		api,
		getSelectedId: () => selectedId,
		titleForId,
		reloadOutline: load,
		reportError: (cause) => error = errorMessage(cause),
	});
	const editorController = createEditorController({
		api,
		getSnapshot: () => snapshot,
		getSelectedId: () => selectedId,
		reload: load,
		loadUnplacedWorks: () => workController.loadUnplacedWorks(),
		openNavigationTarget,
		loadRevisions,
		openRevisionComparison,
		requestFocus,
		findTextarea: (itemId) => document.querySelector<HTMLTextAreaElement>(
			`textarea[data-item-id="${CSS.escape(itemId)}"]`,
		),
		reportError: (cause) => error = errorMessage(cause),
		errorMessage,
		persistSnapshotCache: persistStartupSnapshotCache,
		vocabulary,
	});

	const itemById = $derived(new Map(snapshot.items.map((item) => [item.id, item])));
	const itemByWorkId = $derived(new Map(snapshot.items.map((item) => [item.workId, item])));
	const quickCaptureSubmitting = $derived(workController.quickCaptureSubmitting);
	const unplacedWorks = $derived(workController.unplacedWorks);
	const stubEntries = $derived(workController.stubEntries);
	const duplicateCandidates = $derived(workController.duplicateCandidates);
	const trashEntries = $derived(workController.trashEntries);
	const emergenceSuggestions = $derived(emergenceController.suggestions);
	const emergenceResolutionReasons = $derived(emergenceController.resolutionReasons);
	const emergenceLoading = $derived(emergenceController.loading);
	const emergenceToast = $derived(emergenceController.toast);
	const selectedItem = $derived(selectedId ? itemById.get(selectedId) ?? null : null);
	const markdownExportSelectionRequired = $derived(
		markdownExportPreference.scope === "selected" && !selectedItem,
	);
	const browsing = $derived(navigationController.browsing);
	const browsingLocation = $derived(navigationController.browsingLocation);
	const browsingPane = $derived(navigationController.browsingPane);
	const browsingProjection = $derived(navigationController.projectBrowsing(snapshot));
	const commandPaletteOpen = $derived(navigationController.commandPaletteOpen);
	const quickCaptureText = $derived(navigationController.quickCaptureText);
	const suggestions = $derived(navigationController.suggestions);
	const searchResults = $derived(navigationController.searchResults);
	const searchActiveIndex = $derived(navigationController.searchActiveIndex);
	const searchEntries = $derived(navigationController.searchEntries);
	const omniEntryCount = $derived(navigationController.omniEntryCount);
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
	const primaryNavigationRecentItems = $derived<RecentNavigationItem[]>(
		recentEditedItems.map((item) => ({
			workId: item.workId,
			id: item.id,
			title: titleFor(item),
			parentLabel: item.parentId ? titleForId(item.parentId) : "ルート",
			editedAtLabel: formatRecentEditAt(item.updatedAt),
		})),
	);
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
	const dedicatedView = $derived(
		viewMode === "globalLineage" || viewMode === "workLineage" || viewMode === "comparison" ||
			viewMode === "tags" || viewMode === "options" || viewMode === "help",
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
			: viewMode === "options"
			? "Option"
			: viewMode === "help"
			? "ヘルプ"
			: "ゴミ箱",
	);
	const quickCaptureDestinationLabel = $derived(
		quickCapturePreference.destination === "root"
			? vocabulary.quickCaptureDestinationRoot
			: vocabulary.quickCaptureDestinationUnplaced,
	);
	const inspectorColumn = $derived(inspectorCollapsed ? "0px" : `${inspectorWidth}px`);
	const workingCopySaveStatus = $derived(editorController.workingCopySaveStatus);
	const internalReferenceCompletion = $derived(editorController.internalReferenceCompletion);
	const inlineLinkCompletion = $derived(editorController.inlineLinkCompletion);
	const internalReferenceBacklinks = $derived(editorController.internalReferenceBacklinks);
	const internalReferenceNotice = $derived(editorController.internalReferenceNotice);
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
	const occurrenceContextMenuItems = $derived.by((): readonly ContextMenuItem[] => {
		const bookmarked = Boolean(
			selectedId && (bookmarks ?? []).some((bookmark) => bookmark.occurrenceId === selectedId),
		);
		return [
			{ id: "open-outline", label: "アウトラインで開く" },
			{ id: "zoom", label: `この${vocabulary.occurrence}へZoom` },
			{
				id: "long-form",
				label: "長文編集",
				disabled: !commands.startLongFormEditing.enabled,
				reason: commands.startLongFormEditing.reason,
			},
			{
				id: "bookmark",
				label: bookmarked ? `${vocabulary.bookmark}を解除` : `${vocabulary.bookmark}に追加`,
				separatorBefore: true,
				disabled: !bookmarked && !commands.addBookmark.enabled,
				reason: commands.addBookmark.reason,
			},
			{ id: "duplicate", label: `同じ${vocabulary.work}を別の場所へ配置` },
			{
				id: "create-link",
				label: `${vocabulary.semanticLink}を追加`,
				disabled: !commands.createLink.enabled,
				reason: commands.createLink.reason,
			},
			{
				id: "create-branch",
				label: `新しい${vocabulary.branch}を作る`,
				separatorBefore: true,
				disabled: !commands.createBranch.enabled,
				reason: commands.createBranch.reason,
			},
			{ id: "work-lineage", label: `${vocabulary.workLineage}を開く` },
			{ id: "revision-comparison", label: `${vocabulary.revision}${vocabulary.comparisonPane}を開く` },
			{ id: "export-selected", label: `この${vocabulary.occurrence}を起点にMarkdown書き出し`, separatorBefore: true },
			{ id: "remove-occurrence", label: `この${vocabulary.occurrence}を外す`, separatorBefore: true, danger: true },
			{ id: "trash-work", label: `${vocabulary.work}をゴミ箱へ`, danger: true },
		];
	});
	const commandPaletteCommands = $derived(commandPaletteItems(
		navigationController.commandPaletteQuery,
		commandContext,
		vocabulary,
	));
	const shortcuts = validateShortcuts(COMMAND_DEFINITIONS.flatMap((command) =>
		command.shortcut ? [{ commandId: command.id, shortcut: command.shortcut }] : []
	));
	const helpShortcuts = shortcuts.bindings.map(({ commandId, shortcut }) => ({
		label: COMMAND_DEFINITIONS.find((command) => command.id === commandId)?.label(vocabulary) ?? commandId,
		shortcut,
	}));
	const helpEditorShortcuts = EDITOR_BINDINGS.map(({ label, keys }) => ({ label, shortcut: keys }));

	$effect(() => {
		const id = selectedId;
		if (id && startup.phase === "ready") void loadEmergence(id);
		else emergenceController.clear();
	});

	$effect(() => {
		if (viewMode !== "today" && viewMode !== "unplaced") {
			outlineFilter = { ...EMPTY_OUTLINE_FILTER };
		}
	});

	$effect(() => {
		navigationController.reconcileCommandPaletteRange(commandPaletteCommands.length);
	});

	$effect(() => {
		const workId = selectedItem?.workId;
		if (workId && startup.phase === "ready") {
			void loadRevisions(workId);
			void loadWorkLineage(workId);
			if (selectedBranchId) void loadRecoverySnapshots(workId, selectedBranchId);
			else recoverySnapshots = [];
			void editorController.loadInternalReferenceBacklinks(workId);
		} else {
			revisions = [];
			recoverySnapshots = [];
			workLineage = null;
			editorController.clearBacklinks();
		}
	});

	onMount(() => {
		let cancelled = false;
		async function restoreStartupSnapshotCache(): Promise<void> {
			try {
				const cache = await api.loadStartupSnapshotCache();
				if (cancelled || startupDataLoaded || !cache) return;
				snapshot = cache.snapshot;
				selectedId = navigationController.resetBrowsing("pane-1", cache.location)
					.selectedOccurrenceId;
				loading = false;
				startupCacheActive = true;
			// biome-ignore lint/plugin/noSwallowedRejection: The startup cache is optional and normal startup remains available.
			} catch {
				// The startup cache is optional; continue with the normal startup screen.
			}
		}
		const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
			persistStartupSnapshotCache();
			if (!editorController.hasUnsavedChanges()) return;
			event.preventDefault();
			event.returnValue = "";
		};
		const flushWhenHidden = () => {
			if (document.visibilityState === "hidden") {
				// biome-ignore lint/plugin/noSwallowedRejection: The retained draft and failed status provide the retry path after visibility changes.
				void editorController.flushAutosave().catch(() => {
					// The retained draft and failed status remain visible after returning.
				});
				// biome-ignore lint/plugin/noSwallowedRejection: Resume position remains queued and will retry on the next flush.
				void editorController.flushResume().catch(() => {
					// The latest position remains queued for a later flush.
				});
			}
		};
		const handleGlobalShortcut = (event: KeyboardEvent) => {
			const openHelpPanel = () => {
				event.preventDefault();
				if (commandPaletteOpen) void closeCommandPalette();
				openHelp();
			};
			if (
				event.key === "F1" &&
				!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
			) {
				openHelpPanel();
				return;
			}
			if (
				event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey &&
				(event.key === "/" || event.key === "?")
			) {
				openHelpPanel();
				return;
			}
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
						await loadStartupData();
						return;
					}
				} catch (cause) {
					startup = { phase: "failed", message: "起動状態を取得できませんでした。", detail: errorMessage(cause) };
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}
		void restoreStartupSnapshotCache();
		void monitorStartup();
		return () => {
			cancelled = true;
			persistStartupSnapshotCache();
			window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
			document.removeEventListener("visibilitychange", flushWhenHidden);
			window.removeEventListener("keydown", handleGlobalShortcut, true);
			// biome-ignore lint/plugin/noSwallowedRejection: Teardown cannot await; the retained draft and unload warning preserve recovery.
			void editorController.flushAutosave().catch(() => {
				// beforeunload already warns while an unsaved draft exists.
			});
			// biome-ignore lint/plugin/noSwallowedRejection: Resume persistence is best-effort during synchronous teardown.
			void editorController.flushResume().catch(() => {
				// Resume persistence is best-effort during teardown.
			});
		};
	});

	async function retryStartup(): Promise<void> {
		startup = { phase: "starting", message: "再試行しています…", logPath: startup.logPath };
		startup = await api.retryStartup();
		if (startup.phase === "ready") await loadStartupData();
	}

	async function reloadCachedStartupData(): Promise<void> {
		await loadStartupData();
	}

	async function loadStartupData(): Promise<void> {
		const loaded = await load();
		if (!loaded) return;
		startupDataLoaded = true;
		startupCacheActive = false;
		persistStartupSnapshotCache();
		aliases = await api.listSearchAliases();
		await loadTagBrowser();
		savedRuleQueries = await api.listSavedRuleQueries();
	}

	async function load(focusId?: string): Promise<boolean> {
		const request = ++globalLineageRequest;
		try {
			error = "";
			const [next, nextGlobalLineage, nextBookmarks] = await Promise.all([
				api.listOutline(),
				api.listGlobalLineage(activeGlobalLineageFilter),
				api.listBookmarks(),
			]);
			const snapshotForStartupCache: OutlineSnapshot = {
				items: next.items,
				links: next.links,
				knots: next.knots,
				stashItemIds: next.stashItemIds,
			};
			const drafts = new Map(editorController.drafts().map((draft) => [draft.workId, draft.text]));
			next.items = next.items.map((item) => {
				const draft = drafts.get(item.workId);
				return draft === undefined ? item : { ...item, text: draft };
			});
			snapshot = next;
			editorController.clearCompletions();
			selectedId = navigationController.reconcileBrowsing(snapshot).selectedOccurrenceId;
			if (request === globalLineageRequest) {
				globalLineage = nextGlobalLineage;
				lastLoadedGlobalLineageFilterKey = globalLineageFilterKey();
			}
			bookmarks = nextBookmarks;
			if (focusId) {
				selectOccurrence(focusId);
				await tick();
				requestFocus(focusId);
			}
			persistStartupSnapshotCache(snapshotForStartupCache, navigationController.browsingLocation);
			return true;
		} catch (cause) {
			error = errorMessage(cause);
			return false;
		} finally {
			loading = false;
		}
	}

	function persistStartupSnapshotCache(
		snapshotToCache: OutlineSnapshot = snapshot,
		location = navigationController.browsingLocation,
	): void {
		if (startupCacheActive || startup.phase !== "ready" || editorController.hasUnsavedChanges()) return;
		// biome-ignore lint/plugin/noSwallowedRejection: Startup acceleration is optional and must not interrupt editing.
		void api.saveStartupSnapshotCache(snapshotToCache, location).catch(() => {
			// Startup acceleration must not interrupt editing when the cache cannot be written.
		});
	}

	function selectOccurrence(id: string | null): void {
		selectedId = id;
		navigationController.browseToOccurrence(snapshot, id);
	}

	/** The selected Work joins the filter as a transient, non-persisted exception. */
	const activeGlobalLineageFilter = $derived<GlobalLineageFilter>({
		...treeFilter,
		includeWorkIds: selectedItem ? [selectedItem.workId] : [],
	});
	let lastLoadedGlobalLineageFilterKey = "";

	function releaseEditorFocus(): void {
		const active = document.activeElement;
		if (active instanceof HTMLTextAreaElement && active.dataset.itemId !== undefined) {
			active.blur();
		}
	}

	function deselectFromBlank(event: MouseEvent): void {
		if (event.button !== 0 || draggedId) return;
		releaseEditorFocus();
		selectOccurrence(null);
	}

	function openOccurrenceContextMenu(
		id: string,
		source: "outline" | "tree",
		event: MouseEvent | KeyboardEvent,
	): void {
		if (!itemById.has(id)) return;
		if (source === "outline" && isEditableTarget(event.target)) return;
		event.preventDefault();
		selectOccurrence(id);
		const triggerElement = event.currentTarget instanceof HTMLElement || event.currentTarget instanceof SVGElement
			? event.currentTarget
			: null;
		const rect = triggerElement?.getBoundingClientRect();
		occurrenceContextMenu = {
			targetId: id,
			source,
			x: event instanceof MouseEvent ? event.clientX : rect?.left ?? 8,
			y: event instanceof MouseEvent ? event.clientY : rect?.bottom ?? 8,
			triggerElement,
		};
	}

	function handleOccurrenceContextMenuKeydown(
		id: string,
		source: "outline" | "tree",
		event: KeyboardEvent,
	): void {
		if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
		openOccurrenceContextMenu(id, source, event);
	}

	async function executeOccurrenceContextMenuAction(id: string): Promise<void> {
		const targetId = occurrenceContextMenu?.targetId ?? selectedId;
		if (!targetId || !itemById.has(targetId)) return;
		selectOccurrence(targetId);
		switch (id) {
			case "open-outline":
				await openTreeOccurrence(targetId);
				break;
			case "zoom":
				viewMode = "outline";
				transientExpandedIds = ancestorBreadcrumb(snapshot, targetId).map((item) => item.id);
				navigationController.setHoist(targetId);
				break;
			case "long-form":
				await executeCommand("startLongFormEditing");
				break;
			case "bookmark": {
				const bookmark = (bookmarks ?? []).find((candidate) => candidate.occurrenceId === targetId);
				if (bookmark) await removeBookmark(bookmark.id);
				else await executeCommand("addBookmark");
				break;
			}
			case "duplicate":
				await duplicateSelectedOccurrence();
				break;
			case "create-link":
				await executeCommand("createLink");
				break;
			case "create-branch":
				await executeCommand("createBranch");
				break;
			case "work-lineage":
				viewMode = "workLineage";
				break;
			case "revision-comparison":
				openSelectedRevisionComparison();
				break;
			case "export-selected":
				await performMarkdownExport(targetId);
				break;
			case "remove-occurrence":
				await remove(targetId);
				break;
			case "trash-work":
				await trashSelectedWork();
				break;
		}
	}

	async function openTreeOccurrence(id: string): Promise<void> {
		if (!itemById.has(id)) return;
		transientExpandedIds = ancestorBreadcrumb(snapshot, id).map((item) => item.id);
		viewMode = "outline";
		selectOccurrence(id);
		await tick();
		requestFocus(id);
	}
	function hoistSelected(): void {
		if (!selectedId) return;
		transientExpandedIds = [...new Set([...transientExpandedIds, selectedId])];
		navigationController.setHoist(selectedId);
	}

	function hoistOccurrence(id: string): void {
		selectOccurrence(id);
		void executeCommand("hoist");
	}

	function clearHoist(): void {
		navigationController.clearHoist();
	}

	async function revealInspector(): Promise<void> {
		inspectorCollapsed = false;
		persistUiLayoutPreference();
		asideMode = "overview";
		await tick();
		inspectorElement?.scrollIntoView({ behavior: "smooth", block: "start" });
	}

	async function toggleInspector(): Promise<void> {
		if (inspectorCollapsed) {
			await revealInspector();
			return;
		}
		inspectorCollapsed = true;
		persistUiLayoutPreference();
	}

	function toggleNavigation(): void {
		navCollapsed = !navCollapsed;
		persistUiLayoutPreference();
	}

	function setNavigationCollapsed(next: boolean): void {
		navCollapsed = next;
		persistUiLayoutPreference();
	}

	function setInspectorCollapsed(next: boolean): void {
		inspectorCollapsed = next;
		persistUiLayoutPreference();
	}

	function setInspectorWidth(next: number): void {
		inspectorWidth = clampInspectorWidth(next);
		persistUiLayoutPreference();
	}

	function persistUiLayoutPreference(): void {
		saveUiLayoutPreference({ navCollapsed, inspectorCollapsed, inspectorWidth });
	}

	function setTreeProjectionPreference(next: TreeProjection): void {
		treeProjectionPreference = next;
		saveTreeProjectionPreference(next);
	}

	function startInspectorResize(event: PointerEvent): void {
		if (event.button !== 0 || inspectorCollapsed) return;
		event.preventDefault();
		const move = (next: PointerEvent) => {
			const width = window.innerWidth - next.clientX;
			inspectorWidth = clampInspectorWidth(width);
		};
		const stop = () => {
			persistUiLayoutPreference();
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
			const host = document.querySelector<HTMLElement>(
				`.markdown-editor-host[data-editor-item-id="${CSS.escape(id)}"]`,
			);
			host?.dispatchEvent(new CustomEvent("radiora:focus-editor", {
				detail: { caretOffset },
			}));
		}, 0);
	}

	function addBrowsingPane(): void {
		navigationController.addBrowsingPane();
	}

	function switchBrowsingPane(paneId: string): void {
		selectedId = navigationController.activateBrowsingPane(paneId, snapshot).selectedOccurrenceId;
		transientExpandedIds = ancestorBreadcrumb(snapshot, selectedId).map((item) => item.id);
		if (selectedId) requestFocus(selectedId);
	}

	function openBreadcrumb(id: string): void {
		if (browsingLocation.hoistOccurrenceId) navigationController.clearHoist();
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

	async function loadGlobalLineage(): Promise<void> {
		const request = ++globalLineageRequest;
		try {
			const next = await api.listGlobalLineage(activeGlobalLineageFilter);
			if (request !== globalLineageRequest) return;
			globalLineage = next;
			lastLoadedGlobalLineageFilterKey = globalLineageFilterKey();
		} catch (cause) {
			if (request !== globalLineageRequest) return;
			error = errorMessage(cause);
		}
	}

	function globalLineageFilterKey(): string {
		const filter = activeGlobalLineageFilter;
		return [
			filter.includeIsolated,
			[...filter.linkTypes].sort().join(","),
			[...filter.includeWorkIds].sort().join(","),
		].join(":");
	}

	$effect(() => {
		// The selected Work is a transient exception to the isolation filter, so
		// any selection change must refresh the projection while the tree view
		// is open; otherwise a previously selected Work would stay visible.
		if (viewMode !== "globalLineage") return;
		const key = globalLineageFilterKey();
		if (key === lastLoadedGlobalLineageFilterKey) return;
		void loadGlobalLineage();
	});

	function handleGlobalLineageFilterChange(next: GlobalLineageFilter): void {
		treeFilter = {
			includeIsolated: next.includeIsolated,
			linkTypes: next.linkTypes,
			includeWorkIds: [],
		};
		saveTreeFilterPreference(treeFilter);
	}

	async function handleKeydown(
		event: KeyboardEvent,
		row: VisibleRow,
		textarea: HTMLTextAreaElement,
		compositionGuard = false,
	): Promise<void> {
		if (compositionGuard || event.isComposing || event.keyCode === 229) return;


		if (inlineLinkCompletion?.itemId === row.item.id) {
			const handledKeys = new Set([
				"ArrowDown",
				"ArrowUp",
				"ArrowLeft",
				"ArrowRight",
				"Enter",
				"Tab",
				"Escape",
			]);
			if (handledKeys.has(event.key)) {
				editorController.handleInlineLinkOmniKeydown(event, row.item.id);
				if (event.defaultPrevented) return;
			}
		}
		if (internalReferenceCompletion?.itemId === row.item.id) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				editorController.moveInternalReferenceActiveIndex(event.key === "ArrowDown" ? 1 : -1);
				return;
			}
			if ((event.key === "Enter" || event.key === "Tab") &&
				internalReferenceCompletion.candidates.length) {
				event.preventDefault();
				editorController.applyInternalReferenceCompletion(
					row.item.id,
					internalReferenceCompletion.candidates[internalReferenceCompletion.activeIndex],
				);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				editorController.cancelInternalReferenceCompletion();
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
				await editorController.flushAutosave(row.item.workId);
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
					await editorController.flushAutosave(row.item.workId);
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

	const updateLocalText = editorController.updateLocalText;
	const updateEditorSelection = editorController.updateEditorSelection;
	const updateInlineLinkSearch = editorController.updateInlineLinkSearch;
	const handleInlineLinkOmniKeydown = editorController.handleInlineLinkOmniKeydown;
	const createInlineLinkTarget = editorController.createInlineLinkTarget;
	const selectInlineLinkCandidate = editorController.selectInlineLinkCandidate;
	const selectInlineLinkType = editorController.selectInlineLinkType;
	const setInlineLinkDirection = editorController.setInlineLinkDirection;
	const commitInlineLink = editorController.commitInlineLink;
	const applyInternalReferenceCompletion = editorController.applyInternalReferenceCompletion;
	const referencesIn = editorController.referencesIn;
	const openInternalReference = editorController.openInternalReference;
	const openEditorInternalReference = editorController.openEditorInternalReference;
	const openInternalReferenceBacklink = editorController.openInternalReferenceBacklink;
	function performQuickCapture(): Promise<void> {
		return workController.performQuickCapture(quickCaptureText, quickCapturePreference.destination);
	}
	const loadUnplacedWorks = workController.loadUnplacedWorks;
	const openUnplaced = workController.openUnplaced;
	const updateUnplacedText = workController.updateUnplacedText;
	const loadStubs = workController.loadStubs;
	const openStubs = workController.openStubs;
	const loadDuplicates = workController.loadDuplicates;
	const openDuplicates = workController.openDuplicates;
	const createStubFromList = workController.createStubFromList;
	const updateStubText = workController.updateStubText;
	const resolveStubEntry = workController.resolveStubEntry;
	const placeUnplaced = workController.placeUnplaced;
	const excludeDuplicateCandidate = workController.excludeDuplicateCandidate;
	const createDuplicateCandidateLink = workController.createDuplicateCandidateLink;
	const requestDuplicateMerge = workController.requestDuplicateMerge;
	const linkUnplaced = workController.linkUnplaced;
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
		await editorController.flushAutosave();
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
			await editorController.retryAutosave();
		// biome-ignore lint/plugin/noSwallowedRejection: The coordinator retains the draft and exposes the failed status for another retry.
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
		await requestConfirmation({
			action: "cancel-longform",
			pendingAction: async () => {
				longForm = { active: false, text: "", dirty: false, preview: false };
			},
		});
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
				await editorController.flushAutosave(item.workId);
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

	function handleSearchKeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if (event.key === "Escape") {
			navigationController.clearOmniwindow();
			return;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const delta = event.key === "ArrowDown" ? 1 : -1;
			navigationController.moveSearchActiveIndex(delta);
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
		navigationController.clearOmniwindow();
		selectOccurrence(item.id);
		await load(item.id);
	}

	async function openRecentItem(item: OutlineItem): Promise<void> {
		viewMode = "outline";
		await selectItem(item, ancestorBreadcrumb(snapshot, item.id).map((ancestor) => ancestor.id));
	}

	function openRecentNavigationItem(item: RecentNavigationItem): void {
		const outlineItem = itemById.get(item.id);
		if (outlineItem) void openRecentItem(outlineItem);
	}

	function openHelp(): void {
		viewMode = "help";
	}

	async function loadEmergence(id: string): Promise<void> {
		await emergenceController.load(id);
	}

	async function resolveEmergence(
		suggestion: EmergenceSuggestion,
		action: "accept" | "dismiss" | "pin",
	): Promise<void> {
		await emergenceController.resolve(suggestion, action);
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
			const [scopes, aliases] = await Promise.all([
				api.listScopedTags(),
				api.listTagAliases(),
				workController.loadUnplacedWorks(),
			]);
			tagScopes = scopes;
			tagAliases = aliases;
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
			await editorController.flushAutosave(selectedItem.workId);
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
		await workController.trashOccurrence(selectedItem.id);
	}

	const openTrash = workController.openTrash;
	const restoreTrash = workController.restoreTrash;

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
		navigationController.openCommandPalette();
	}

	async function closeCommandPalette(): Promise<void> {
		navigationController.closeCommandPalette();
		await tick();
		commandPaletteRestoreFocus?.focus();
		commandPaletteRestoreFocus = null;
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
			: `("${candidate.reason.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")`;
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
		confirmationController.rewriteBranchName = "";
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

	const purgeTrash = workController.purgeTrash;

	async function performMarkdownExport(selectedOccurrenceId?: string): Promise<void> {
		markdownExportNotice = "";
		try {
			await editorController.flushAutosave();
			const exportSnapshot = selectMarkdownExportSnapshot(snapshot, {
				...markdownExportPreference,
				scope: selectedOccurrenceId ? "selected" : markdownExportPreference.scope,
				selectedOccurrenceId: selectedOccurrenceId ?? selectedId,
			});
			const rendered = renderOutlineSnapshotMarkdown(exportSnapshot);
			const resolutions = markdownExportPreference.referenceMode === "obsidian"
				? await api.resolveInternalReferences(rendered)
				: [];
			const markdown = rewriteMarkdownExportReferences(
				rendered,
				markdownExportPreference.referenceMode,
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

	function persistMarkdownExportPreference(): void {
		saveMarkdownExportPreference({ ...markdownExportPreference });
	}

	function persistQuickCapturePreference(): void {
		saveQuickCapturePreference({ ...quickCapturePreference });
	}

	async function performOpmlExport(): Promise<void> {
		opmlNotice = "";
		try {
			await editorController.flushAutosave();
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

	async function importOpmlFile(file: File): Promise<void> {
		opmlNotice = "";
		try {
			await editorController.flushAutosave();
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
			await editorController.flushAutosave();
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

	async function restoreJsonBackupFile(file: File): Promise<void> {
		jsonBackupNotice = "";
		try {
			await editorController.flushAutosave();
			const result = await api.restoreJsonBackup(await file.text());
			await load();
			jsonBackupNotice =
				`${vocabulary.jsonBackupRestoreSuccess}: ${result.workCount}件の${vocabulary.work}。`;
		} catch (cause) {
			error =
				`${vocabulary.jsonBackupRestore}に失敗しました: ${errorMessage(cause)} ${vocabulary.jsonBackupRestoreFailureRecovery}`;
		}
	}

	async function openLicenses(): Promise<void> {
		licenseError = "";
		licenseDetail = null;
		licenseLoading = true;
		try {
			const response = await fetch("/licenses/index.json");
			if (!response.ok) {
				throw new Error(`ライセンス情報を読み込めませんでした (${response.status})`);
			}
			licenseIndex = await response.json();
		} catch (cause) {
			licenseError = errorMessage(cause);
		} finally {
			licenseLoading = false;
		}
		licensesDialog?.showModal();
	}

	async function selectLicense(entry: LicenseEntry): Promise<void> {
		if (!entry.file) return;
		licenseDetail = { name: `${entry.name} ${entry.version}`, text: "ライセンス全文を読み込んでいます…" };
		try {
			const response = await fetch(`/licenses/${entry.file}`);
			licenseDetail = {
				name: `${entry.name} ${entry.version}`,
				text: response.ok
					? await response.text()
					: `ライセンス全文を読み込めませんでした (${response.status})。`,
			};
		} catch (cause) {
			licenseDetail = { name: `${entry.name} ${entry.version}`, text: errorMessage(cause) };
		}
	}


	async function requestConfirmation(confirmation: PendingConfirmation): Promise<void> {
		if (!confirmationController.request(confirmation)) return;
		await tick();
		await confirmationDialog.show(confirmation.action === "rewrite");
	}

	async function confirmPendingAction(): Promise<void> {
		const confirmation = confirmationController.beginSubmission();
		if (!confirmation) return;
		try {
			await editorController.flushAutosave();
			if (confirmation.action === "trash") {
				await workController.confirmTrash(confirmation.occurrenceId);
			} else if (confirmation.action === "purge") {
				await workController.confirmPurge(confirmation.workId);
			} else if (confirmation.action === "rewrite") {
				const source = snapshot.items.find((item) => item.id === confirmation.occurrenceId);
				if (!source) {
					throw new Error(`別稿の配置元が見つかりません: ${confirmation.occurrenceId}`);
				}
				const result = await api.rewriteAsNewBranch(
					confirmation.sourceBranchId,
					confirmationController.rewriteBranchName,
					"confirmed",
				);
				if (result.status === "created") {
					const placement = await api.createOccurrence({
						workId: confirmation.workId,
						branchId: result.branch.id,
						parentId: source.parentId,
						afterId: source.id,
						contextualHeading: result.branch.name,
					});
					await load(placement.id);
					await Promise.all([
						loadRevisions(confirmation.workId),
						loadWorkLineage(confirmation.workId),
					]);
					viewMode = "outline";
				}
			} else if (confirmation.action === "merge-duplicate") {
				await workController.confirmDuplicateMerge(confirmation.preview);
			} else if (confirmation.action === "cancel-longform") {
				await confirmation.pendingAction();
			}
		} catch (cause) {
			error = errorMessage(cause);
			confirmationController.finishSubmission(false);
			return;
		}
		confirmationController.finishSubmission(true);
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

<CommandPaletteDialog
	open={commandPaletteOpen}
	commands={commandPaletteCommands}
	{vocabulary}
	bind:query={navigationController.commandPaletteQuery}
	bind:activeIndex={navigationController.commandPaletteActiveIndex}
	onClose={closeCommandPalette}
	onExecute={executeCommandPaletteItem}
/>

{#if occurrenceContextMenu}
	<ContextMenu
		items={occurrenceContextMenuItems}
		x={occurrenceContextMenu.x}
		y={occurrenceContextMenu.y}
		triggerElement={occurrenceContextMenu.triggerElement}
		onSelect={(id) => void executeOccurrenceContextMenuAction(id)}
		onClose={() => (occurrenceContextMenu = null)}
	/>
{/if}

{#if startupCacheActive}
	<StartupCacheStatus
		startup={startup}
		onRetry={() => void retryStartup()}
		onReload={() => void reloadCachedStartupData()}
	/>
{/if}

<div class="shell" class:nav-collapsed={navCollapsed} inert={startupCacheActive} aria-busy={startupCacheActive}>
	<PrimaryNavigation
		collapsed={navCollapsed}
		activeView={viewMode}
		queryActive={asideMode === "query"}
		queryAvailable={Boolean(selectedItem)}
		recentItems={primaryNavigationRecentItems}
		selectedId={selectedId}
		onToggleCollapse={toggleNavigation}
		onOpenToday={() => void openToday()}
		onOpenUnplaced={() => void openUnplaced()}
		onOpenStubs={() => void openStubs()}
		onOpenDuplicates={() => void openDuplicates()}
		onOpenTrash={() => void openTrash()}
		onOpenOptions={() => (viewMode = "options")}
		onOpenTags={() => void openTags()}
		onOpenQuery={() => void openInspectorTool("query")}
		onOpenHelp={openHelp}
		onOpenRecentItem={(item) => void openRecentNavigationItem(item)}
	/>
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
				aria-label={`検索・${vocabulary.quickCapture}`}
				placeholder={`思索を検索、Shift+Enterで${quickCaptureDestinationLabel}へ作成…`}
				bind:value={navigationController.quickCaptureText}
				oninput={() => navigationController.queueSearch()}
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
						<strong>「{quickCaptureText.trim()}」を{quickCaptureDestinationLabel}へ作成</strong>
						<small>Shift+Enter</small>
					</button>
				</div>
			{/if}
		</form>
		<div class="top-actions">
			<div class="toolbar-group toolbar-nav" aria-label="ナビゲーション">
				<button onclick={resumeEditing}>{vocabulary.resumePosition}から再開</button>
			</div>
			<button
				onclick={exportMarkdown}
				disabled={!commands.exportMarkdown.enabled || markdownExportSelectionRequired}
				title={markdownExportSelectionRequired
					? vocabulary.markdownExportSelectionRequired
					: commands.exportMarkdown.reason}
			>{vocabulary.markdownExportAction}</button>
			<button class:active={viewMode === "help"} onclick={openHelp} title="F1でヘルプを開く">ヘルプ</button>
			<button class:active={viewMode === "options"} onclick={() => (viewMode = "options")}>Option</button>
			{#each bookmarks as bookmark}
				<span class="bookmark-control">
					<button onclick={() => openBookmark(bookmark.id)}>{vocabulary.bookmark} {bookmark.id.slice(0, 4)}</button>
					<button aria-label={`${vocabulary.bookmark}を削除`} onclick={() => removeBookmark(bookmark.id)}>×</button>
				</span>
			{/each}
			<button
				class="inspector-jump"
				type="button"
				aria-expanded={!inspectorCollapsed}
				aria-label={inspectorCollapsed ? "インスペクターペインを開く" : "インスペクターペインを閉じる"}
				title={inspectorCollapsed ? "インスペクターペインを開く" : "インスペクターペインを閉じる"}
				onclick={toggleInspector}
			>詳細</button>
		</div>
		{#if workingCopySaveStatus}
			<WorkingCopySaveStatus status={workingCopySaveStatus} onRetry={retryWorkingCopySave} />
		{/if}
	</header>

	{#if error}<div class="error">{error}<button onclick={() => (error = "")}>×</button></div>{/if}

	{#if startup.phase !== "ready" && !startupCacheActive}
		<StartupView startup={startup} onRetry={retryStartup} />
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
			<!-- nosemgrep: radiora.no-dangerous-html -- renderMarkdownPreview escapes raw HTML before adding controlled markup. -->
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
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="rows"
						onmousedown={(event) => {
							if (event.target === event.currentTarget) deselectFromBlank(event);
						}}>
						{#each visibleRows.filter((row) => !row.stash) as row (row.item.id)}
							{@const inlineLinks = inlineSemanticLinksFor(row.item.text)}
							{@const annotations = semanticLinkAnnotationsFor(row.item.id)}
							{@const rowBody = bodyFor(row.item)}
							<div class:selected={selectedId === row.item.id} class:dragging={draggedId === row.item.id} class="row" style={`--depth:${row.depth}`} role="treeitem"
								aria-selected={selectedId === row.item.id} tabindex="-1"
								oncontextmenu={(event) => openOccurrenceContextMenu(row.item.id, "outline", event)}
								onkeydown={(event) => handleOccurrenceContextMenuKeydown(row.item.id, "outline", event)}
								draggable="true" ondragstart={() => draggedId = row.item.id} ondragend={() => draggedId = null}
								onmousedown={(event) => {
									if (event.target === event.currentTarget) deselectFromBlank(event);
								}}
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
						<div class="inline-link-completions inline-link-omniwindow" role="dialog"
							aria-label={`@${vocabulary.semanticLink}先を検索`}>
							<div class="inline-link-omniwindow__search">
								<span aria-hidden="true">@</span>
								<input
									value={inlineLinkCompletion.query}
									placeholder={`${vocabulary.work}を検索…`}
									aria-label={`@${vocabulary.semanticLink}先を検索`}
									readonly={inlineLinkCompletion.phase !== "candidate"}
									disabled={inlineLinkCompletion.creating}
									oninput={(event) => void updateInlineLinkSearch(row.item.id, event.currentTarget.value)}
									onkeydown={(event) => handleInlineLinkOmniKeydown(event, row.item.id)}
									onmousedown={(event) => event.stopPropagation()}
								/>
							</div>
							<div class="inline-link-omniwindow__body">
							{#if inlineLinkCompletion.phase === "candidate"}
								<p class="inline-link-completions__hint" aria-live="polite">
									{inlineLinkCompletion.searching ? "検索中…" : `@${vocabulary.semanticLink}先を検索`}
								</p>
								<div role="listbox" aria-label={`${vocabulary.work}候補`}>
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
									{/each}
									{#if !inlineLinkCompletion.searching && inlineLinkCompletion.query.trim()}
										<button
											class="create-candidate"
											class:active={inlineLinkCompletion.activeIndex === inlineLinkCompletion.candidates.length}
											role="option"
											aria-selected={inlineLinkCompletion.activeIndex === inlineLinkCompletion.candidates.length}
											disabled={inlineLinkCompletion.creating}
											onmousedown={(event) => event.preventDefault()}
											onclick={() => void createInlineLinkTarget(row.item.id)}
										>
											<strong>「{inlineLinkCompletion.query.trim()}」を新規作成</strong>
											<span>未配置箱 · Shift+Enter</span>
										</button>
									{/if}
								</div>
								{#if !inlineLinkCompletion.searching && !inlineLinkCompletion.candidates.length}
									<p>一致する{vocabulary.work}はありません。</p>
								{:else if !inlineLinkCompletion.searching && inlineLinkCompletion.query.trim()}
									<p class="inline-link-completions__hint">候補から選択するか、Shift+Enterで新規作成できます。</p>
								{/if}
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
			<TodayView
				bind:dateStart
				bind:dateEnd
				bind:outlineFilter
				projection={dateProjection}
				loading={dateProjectionLoading}
				onMoveDateRange={moveDateRange}
				onShowWeek={showWeek}
				onLoad={loadDateProjection}
				onClearFilter={clearOutlineFilter}
				onOpenEntry={openDateEntry}
				{titleFor}
				{formatCreatedAt}
			/>
		{:else if viewMode === "unplaced"}
			<UnplacedInboxView
				works={unplacedWorks}
				{linkableWorks}
				{selectedId}
				bind:outlineFilter
				bind:unplacedLinkTargets={workController.unplacedLinkTargets}
				bind:unplacedLinkDirections={workController.unplacedLinkDirections}
				bind:unplacedLinkType={workController.unplacedLinkType}
				onUpdateText={updateUnplacedText}
				onPlace={placeUnplaced}
				onLink={linkUnplaced}
				onClearFilter={clearOutlineFilter}
				{formatCreatedAt}
			/>
		{:else if viewMode === "stubs"}
			<StubListView
				entries={stubEntries}
				onCreate={createStubFromList}
				onUpdateText={updateStubText}
				onResolve={resolveStubEntry}
			/>
		{:else if viewMode === "duplicates"}
			<DuplicateCandidatesPanel
				candidates={duplicateCandidates}
				{vocabulary}
				onRequestMerge={requestDuplicateMerge}
				onCreateLink={createDuplicateCandidateLink}
				onDismiss={excludeDuplicateCandidate}
			/>
		{:else if viewMode === "tags"}
			<TagBrowserView
				{tagScopes}
				{tagAliases}
				{tagError}
				bind:selectedTag
				bind:tagRenameFrom
				bind:tagRenameTo
				bind:tagMergeSources
				bind:tagMergeTarget
				workIds={new Set(itemByWorkId.keys())}
				{titleForWorkId}
				onOpenTagNode={openTagNode}
				onRenameTag={renameTag}
				onMergeTags={mergeTags}
			/>
		{:else if viewMode === "trash"}
			<TrashView entries={trashEntries} onRestore={restoreTrash} onPurge={purgeTrash} />
		{:else if viewMode === "options"}
			<OptionsView
				bind:markdownExportPreference
				bind:quickCapturePreference
				markdownExportEnabled={commands.exportMarkdown.enabled}
				markdownExportReason={commands.exportMarkdown.reason}
				{markdownExportSelectionRequired}
				{markdownExportNotice}
				startupReady={startup.phase === "ready"}
				{opmlNotice}
				{jsonBackupNotice}
				{treeProjectionPreference}
				{navCollapsed}
				{inspectorCollapsed}
				{inspectorWidth}
				onPersistMarkdownExportPreference={persistMarkdownExportPreference}
				onExportMarkdown={exportMarkdown}
				onImportOpml={importOpmlFile}
				onExportOpml={performOpmlExport}
				onExportJsonBackup={performJsonBackupExport}
				onRestoreJsonBackup={restoreJsonBackupFile}
				onTreeProjectionChange={setTreeProjectionPreference}
				onNavigationCollapsedChange={setNavigationCollapsed}
				onInspectorCollapsedChange={setInspectorCollapsed}
				onInspectorWidthChange={setInspectorWidth}
				onPersistQuickCapturePreference={persistQuickCapturePreference}
				onOpenLicenses={openLicenses}
			/>
		{:else if viewMode === "help"}
			<InAppHelp
				shortcuts={helpShortcuts}
				editorShortcuts={helpEditorShortcuts}
				onOpenOutline={() => { viewMode = "outline"; }}
				onOpenToday={() => void openToday()}
				onOpenUnplaced={() => void openUnplaced()}
				onOpenOptions={() => { viewMode = "options"; }}
				onOpenCommandPalette={() => void openCommandPalette()}
			/>
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
				filter={activeGlobalLineageFilter}
				onFilterChange={handleGlobalLineageFilterChange}
				{selectedId}
				onSelect={(id) => selectOccurrence(id)}
				onOpen={(id) => void openTreeOccurrence(id)}
				onContextMenu={(id, event) => openOccurrenceContextMenu(id, "tree", event)}
				onProjectionChange={setTreeProjectionPreference}
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
						<button class="clear-selection" onclick={() => setInspectorCollapsed(true)}>閉じる</button>
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
						onSearch={api.searchItems}
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
										emergenceController.setResolutionReason(
											suggestion.id,
											event.currentTarget.value,
										)}
								/>
								<div class="discovery-actions">
									<button onclick={() => resolveEmergence(suggestion, "accept")}>{vocabulary.emergenceAccept}</button>
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
						<button onclick={() => void executeCommand("createBranch")} disabled={!commands.createBranch.enabled} title={commands.createBranch.reason}>
							新しい{vocabulary.branch}を作る
						</button>
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
					<button class="inspector-close" type="button" onclick={() => setInspectorCollapsed(true)}>閉じる</button>
					<span>•</span><p>{vocabulary.work}を選択すると<br />関連{vocabulary.semanticLink}を編集できます</p>
				</div>
			{/if}
		</aside>
		{/if}
	</main>
	{/if}
</div>

{#if emergenceToast}
	{#key emergenceToast.id}
		<Toast
			title={emergenceToast.title}
			message={emergenceToast.message}
			onDismiss={() => emergenceController.dismissToast()}
		/>
	{/key}
{/if}

<ConfirmationDialog
	bind:this={confirmationDialog}
	pending={confirmationController.pending}
	submitting={confirmationController.submitting}
	bind:rewriteBranchName={confirmationController.rewriteBranchName}
	onConfirm={confirmPendingAction}
	onReset={() => confirmationController.reset()}
/>

<LicensesDialog
	bind:dialog={licensesDialog}
	{licenseIndex}
	{licenseDetail}
	{licenseError}
	{licenseLoading}
	onSelectLicense={selectLicense}
/>
