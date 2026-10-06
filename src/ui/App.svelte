<script lang="ts">
	import { formatCreatedAt, formatRecentEditAt, localDateValue } from "./calendar_display.ts";
	import { DateProjectionController } from "./date_projection_controller.svelte.ts";
	import { TagController } from "./tag_controller.svelte.ts";
	import { onMount, tick, untrack } from "svelte";
	import { HistoricalTimeController } from "./historical_time_controller.svelte.ts";
	import { OccurrenceSelectionWorkspace } from "./occurrence_selection_workspace.ts";
	import { OutlineOperationsController } from "./outline_operations_controller.svelte.ts";
	import HistoricalTimeSelectionDialog from "./HistoricalTimeSelectionDialog.svelte";
	import TreeRequestStatus from "./TreeRequestStatus.svelte";
	import GlobalLineage from "./GlobalLineage.svelte";
	import RevisionComparison from "./RevisionComparison.svelte";
	import ComparisonPane from "./ComparisonPane.svelte";
	import RecoverySnapshots from "./RecoverySnapshots.svelte";
	import WorkLineage from "./WorkLineage.svelte";
	import AppTopBar from "./AppTopBar.svelte";
	import LongFormEditor from "./LongFormEditor.svelte";
	import OutlineView from "./OutlineView.svelte";
	import type { OutlineHelpers, OutlineRowHandlers } from "./outline_row_types.ts";
	import InspectorView, { type InspectorAsideMode } from "./InspectorView.svelte";
	import DuplicateCandidatesPanel from "./DuplicateCandidatesPanel.svelte";
	import InAppHelp from "./InAppHelp.svelte";
	import ContextMenu from "./ContextMenu.svelte";
	import TodayView from "./TodayView.svelte";
	import StubListView from "./StubListView.svelte";
	import UnplacedInboxView from "./UnplacedInboxView.svelte";
	import TagBrowserView from "./TagBrowserView.svelte";
	import TrashView from "./TrashView.svelte";
	import OptionsView from "./OptionsView.svelte";
	import { downloadTextFile } from "./download_text_file.ts";
	import StartupCacheStatus from "./StartupCacheStatus.svelte";
	import StartupView from "./StartupView.svelte";
	import PrimaryNavigation, {
		type RecentNavigationItem,
	} from "./PrimaryNavigation.svelte";
	import ConfirmationDialog from "./ConfirmationDialog.svelte";
	import Toast from "./Toast.svelte";
	import IconButton from "./primitives/IconButton.svelte";
	import CommandPaletteDialog from "./CommandPaletteDialog.svelte";
	import ShortcutNavigation from "./ShortcutNavigation.svelte";
	import { KeyboardController, focusWorkspacePane } from "./keyboard_controller.svelte.ts";
	import { KeyboardWorkspaceController } from "./keyboard_workspace_controller.svelte.ts";
	import { LongFormController } from "./long_form_controller.svelte.ts";
	import LicensesDialog from "./LicensesDialog.svelte";
	import {
		fetchLicenseIndex,
		type LicenseEntry,
		type LicenseIndex,
	} from "../services/license_index.ts";
	import { rankRecentEditedItems } from "../services/recent_edited_items.ts";
	import {
		createConfirmationController,
		type PendingConfirmation,
	} from "./confirmation_controller.svelte.ts";
	import { createOutlineDragController } from "./outline_drag_controller.svelte.ts";
	import { createEditorController } from "./editor_controller.svelte.ts";
	import { createPendingEmptyItemController } from "./pending_empty_item_controller.svelte.ts";
	import { createEmergenceController } from "./emergence_controller.svelte.ts";
	import { HistoryController } from "./history_controller.svelte.ts";
	import { BranchRewriteController } from "./branch_rewrite_controller.ts";
	import { ComparisonController } from "./comparison_controller.svelte.ts";
	import { createOmniSearchController } from "./omni_search_controller.svelte.ts";
	import { createCommandPaletteController } from "./command_palette_controller.svelte.ts";
	import { createNavigationController } from "./navigation_controller.svelte.ts";
	import { RelationTypeController } from "./relation_type_controller.svelte.ts";
	import { createWorkController } from "./work_controller.svelte.ts";
	import type { ContextMenuItem } from "./context_menu";
	import { createRpcAdapter } from "./rpc_adapter";
	import type {
		CreateLinkInput,
		EmergenceSuggestion,
		OutlineItem,
		OutlineLink,
		OutlineSnapshot,
		NavigationTarget,
		RelationTypeDirection,
	} from "../domain/models";
	import type { RadioraBindings } from "../shared/bindings";
	import type { DateProjection } from "../services/date_projection";
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
	import { createThemeController } from "./theme_controller.svelte.ts";
	import { TreeController } from "./tree_controller.svelte.ts";
	import {
		ancestorBreadcrumb,
	} from "../services/browsing_navigation_state";
	import { useUiVocabulary } from "./ui_vocabulary_context";
	import { navigationUiState } from "./navigation_state";
	import type { VisibleRow } from "./outline_view_model";
	import {
		COMMAND_DEFINITIONS,
		commandAvailability,
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
	} from "../services/comparison_service";
	import {
		parseInlineSemanticLinks,
		type InlineSemanticLinkCandidate,
	} from "../services/inline_semantic_link";
	import {
		projectSemanticLinkAnnotations,
		type SemanticLinkAnnotation,
	} from "../services/semantic_link_annotations";
	import type { ViewMode } from "./app_view_mode.ts";
	import { BookmarkController } from "./bookmark_controller.svelte.ts";
	import { OutlineController } from "./outline_controller.svelte.ts";
	import { StartupController } from "./startup_controller.svelte.ts";
	import { OutlineViewportAdapter } from "./outline_viewport_adapter.ts";
	import { ScreenDestinationPresenter } from "./screen_destination_presenter.ts";
	import { ScreenNavigationWorkspace } from "./screen_navigation_workspace.svelte.ts";
	import { focusTreeSelection } from "./tree_focus_adapter.ts";

	import { OutlineDisplayController } from "./outline_display_controller.svelte.ts";
	import { OutlineFocusAdapter } from "./outline_focus_adapter.ts";

	import { CommandExecutionController } from "./command_execution_controller.ts";
	import { GlobalKeyboardAdapter } from "./global_keyboard_adapter.ts";
	import { PaletteFocusAdapter } from "./palette_focus_adapter.ts";
	import { OccurrenceContextMenuController } from "./occurrence_context_menu_controller.svelte.ts";

	const api = createRpcAdapter<RadioraBindings>();


	const vocabulary = useUiVocabulary();
	const bookmarkController = new BookmarkController({ read: () => api.listBookmarks(), reportError: (cause) => error = errorMessage(cause) });
	const outlineController: OutlineController = new OutlineController({
		readOutline: () => api.listOutline(),
		prepareBookmarks: (current) => bookmarkController.prepareRefresh(current),
		drafts: () => editorController.drafts(),
		prepareTree: (current, required) => tree.prepareRefresh(current, required),
		reconcileSelection: () => selectionWorkspace.reconcile(),
		selectionReceipt: () => selectionWorkspace.currentReceipt(),
		focus: (id, reloadCurrent) => selectOccurrence(id, (selectionCurrent) => requestFocus(id, undefined, () => reloadCurrent() && selectionCurrent())),
		persist: (saved) => persistStartupSnapshotCache(saved),
		reportError: (cause) => error = errorMessage(cause),
		clearError: () => error = "",
	});
	const snapshot = $derived(outlineController.snapshot);
	const startupController = new StartupController({
		api,
		errorMessage,
		onCacheRestored: (cache) => {
			const restored = selectionWorkspace.restoreInitial(cache.snapshot, cache.location,
				() => !startupController.cancelled && !startupController.dataLoaded && !editorController.hasUnsavedChanges() && !longForm.dirty);
			return restored;
		},
		onReady: loadStartupData,
		onReadyError: (cause) => error = errorMessage(cause),
	});
	const startup = $derived(startupController.status);
	const startupCacheActive = $derived(startupController.cacheActive);
	let error = $state("");
	const outlineDisplay = new OutlineDisplayController();
	const outlineFilter = $derived(outlineDisplay.filter);
	const longFormController = new LongFormController({
		flush: () => editorController.flushAutosave(),
		save: (id, text) => api.updateItemText(id, text),
		reload: () => load(),
		reportError: (cause) => error = errorMessage(cause),
	});
	const longForm = $derived(longFormController.state);
	const outlineViewport = new OutlineViewportAdapter();
	onMount(() => outlineViewport.connect());
	const screenNavigation: ScreenNavigationWorkspace = new ScreenNavigationWorkspace({
		outline: {
			captureBrowsing: () => navigationController.captureBrowsing(),
			commitBrowsing: (state) => navigationController.commitBrowsing(state),
			filter: () => outlineFilter, setFilter: (next) => outlineDisplay.setFilter(next),
			expanded: () => transientExpandedIds, setExpanded: (next) => outlineDisplay.setExpanded(next),
			inspector: () => ({ mode: asideMode, collapsed: inspectorCollapsed }),
			setInspector: (context) => { asideMode = context.mode; inspectorCollapsed = context.collapsed; },
			longForm: () => longForm.active,
			setLongForm: (active, id) => longFormController.setMode(active, itemById.get(id ?? "") ?? null),
			capturePosition: () => outlineViewport.capture(browsingLocation.selectedOccurrenceId, browsingLocation.hoistOccurrenceId, longForm.active),
			restorePosition: (position, current) => outlineViewport.restore(position, current),
		},
		snapshot: () => snapshot,
		readOutline: () => api.listOutline(),
		onOutlinePublished: () => persistStartupSnapshotCache(outlineController.cacheSnapshot),
		outlinePublication: {
			begin: () => outlineController.begin(),
			invalidate: () => { startupController.invalidateDataLoad(); outlineController.invalidate(); },
		},
		selection: {
			current: () => selectedId,
			guard: (item, current) => historicalTimeController.canSelect(item, current),
			commit: (id, item) => selectionWorkspace.commitPrepared(id, item),
			cancelPending: () => selectionWorkspace.cancelPending(),
		},
		editor: {
			save: () => longFormController.save(false),
			flush: () => editorController.flushForNavigation(),
			version: () => editorController.editVersion + longFormController.editVersion,
		},
		screens: { prepare: (destination) => screenPresenter.prepare(destination), focusTree: focusTreeSelection },
		reportError: (cause) => error = errorMessage(cause),
	});
	let viewMode: ViewMode = $derived(screenNavigation.view);
	// Side-effect boundary: record viewMode changes asynchronously for telemetry/analysis.
	// Dependency: viewMode. Cleanup: not needed (best-effort async logging).
	$effect(() => {
		void api.recordViewChange(viewMode).catch(() => console.warn("Could not record view change."));
	});
	const dateProjectionController = new DateProjectionController({
		projectDates: (range) => api.projectDates(range),
		onError: (cause) => error = errorMessage(cause),
		navigation: screenNavigation,
	});
	let selectedId = $state<string | null>(null);
	const navigationController = createNavigationController();
	const paletteController = createCommandPaletteController();
	const omniController = createOmniSearchController({
		recordSearch: (outcome, durationMs) => {
			void api.recordClientOperation("search.execute", outcome, durationMs).catch(() => console.warn("Could not record search."));
		},
		searchPort: {
			suggestItems: (prefix, limit) => api.suggestItems(prefix, limit),
			searchItems: (request) => api.searchItems(request),
			getSelectedId: () => selectedId,
			reportError: (cause) => error = errorMessage(cause),
		},
	});
	const transientExpandedIds = $derived(outlineDisplay.expanded);
	let asideMode = $state<InspectorAsideMode>("overview");
	const tagController = new TagController({
		api: {
			listScopedTags: () => api.listScopedTags(),
			listTagAliases: () => api.listTagAliases(),
			renameTag: (from, to) => api.renameTag(from, to),
			mergeTags: (sources, target) => api.mergeTags(sources, target),
		},
		errorMessage,
	});
	const confirmationController = createConfirmationController();
	let confirmationDialog: ConfirmationDialog;
	let licensesDialogOpen = $state(false);
	let licenseIndex = $state<LicenseIndex | null>(null);
	let licenseDetail = $state<{ name: string; text: string } | null>(null);
	let licenseError = $state("");
	let licenseLoading = $state(false);

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
	const contextMenuController = new OccurrenceContextMenuController({
		exists: (id) => itemById.has(id), select: (id) => selectOccurrence(id), selected: () => selectedId,
		execute: (id) => executeCommand(id),
		remove: (id) => outlineOperations.remove(id),
		navigate: (id, kind) => screenNavigation.navigate({
			view: kind === "work-lineage" ? "workLineage" : "outline", occurrenceId: id,
			...(kind === "zoom" ? { hoistId: id } : kind === "open-outline" ? { expandedIds: ancestorBreadcrumb(snapshot, id).map((item) => item.id) } : {}),
		}),
		run: (action) => commandExecution.run(action),
		actions: {
			bookmark: async (id) => { const bookmark = bookmarkController.bookmarks.find((entry) => entry.occurrenceId === id); if (bookmark) await removeBookmark(bookmark.id); else await executeCommand("addBookmark"); },
			duplicate: () => commandExecution.run(duplicateSelectedOccurrence),
			"revision-comparison": () => commandExecution.run(openSelectedRevisionComparison),
			"export-selected": (id) => commandExecution.execute("exportMarkdown", { exportOccurrenceId: id }),
			"trash-work": () => commandExecution.run(trashSelectedWork),
		},
	});
	const occurrenceContextMenu = $derived(contextMenuController.state);
	const tree = new TreeController({
		listGlobalLineage: (filter) => api.listGlobalLineage(filter),
		selectedWorkId: () => selectedItem?.workId ?? null,
		onError: (cause) => error = errorMessage(cause),
	});
	const themeController = createThemeController();
	const outlineDrag = createOutlineDragController({
		moveItem: (input) => api.moveItem(input),
		reload: load,
		reportError: (cause) => error = errorMessage(cause),
	});
	const relationTypes = new RelationTypeController(api);
	const workController = createWorkController({
		api,
		getSnapshot: () => snapshot,
		reload: load,
		navigation: screenNavigation,
		selectOccurrence,
		requestConfirmation,
		reportError: (cause) => error = errorMessage(cause),
		captureQuickCaptureInput: () => {
			const current = omniController.captureInput();
			return () => omniController.clearAccepted(current);
		},
		reloadBookmarks: () => bookmarkController.reload(),
	});
	const historicalTimeController = new HistoricalTimeController({
		save: (workId, value) => api.setWorkHistoricalTime(workId, value),
		reload: load,
		select: selectOccurrence,
	});
	const selectionWorkspace = new OccurrenceSelectionWorkspace({
		current: () => selectedId,
		publish: (id) => selectedId = id,
		snapshot: () => snapshot,
		publishStartupSnapshot: (next) => outlineController.restoreCache(next),
		interruptNavigation: () => screenNavigation.invalidate(),
		clearCompletions: () => editorController.clearCompletions(),
		form: historicalTimeController,
		outline: {
			visible: () => viewMode === "outline",
			browsing: () => navigationController.captureBrowsing(),
			publishBrowsing: (next) => navigationController.commitBrowsing(next),
			expanded: () => transientExpandedIds,
			publishExpanded: (next) => outlineDisplay.setExpanded(next),
			capturePanels: () => outlineViewport.capturePanels(),
			restorePane: (id, current) => outlineViewport.restorePane(id, current),
		},
		reportError: (cause) => error = errorMessage(cause),
	});
	const emergenceController = createEmergenceController({
		api,
		getSelectedId: () => selectedId,
		titleForId,
		reloadOutline: load,
		reportError: (cause) => error = errorMessage(cause),
	});
	const history = new HistoryController(
		api,
		() => selectedItem?.workId ?? null,
		() => selectedBranchId ?? null,
		(cause) => error = errorMessage(cause),
	);
	const branchRewrite = new BranchRewriteController({
		api,
		getSnapshot: () => snapshot,
		navigation: screenNavigation,
		reload: load,
		refreshHistory: async (workId) => {
			await Promise.all([history.loadRevisions(workId), history.loadWorkLineage(workId)]);
		},
	});
	const comparison = new ComparisonController({
		api,
		getSelectedWorkId: () => selectedItem?.workId ?? null,
		getSelectedId: () => selectedId,
		navigation: screenNavigation,
		reportError: (cause) => error = errorMessage(cause),
		comparisonPaneLabel: () => vocabulary.comparisonPane,
	});
	const editorController = createEditorController({
		api,
		getSnapshot: () => snapshot,
		getSelectedId: () => selectedId,
		updateWorkingCopy: (item, text, updatedAt) => outlineController.updateText(item, text, updatedAt),
		reload: load,
		loadUnplacedWorks: () => workController.loadUnplacedWorks(),
		navigation: screenNavigation,
		requestFocus,
		findTextarea: (itemId) => document.querySelector<HTMLTextAreaElement>(
			`textarea[data-item-id="${CSS.escape(itemId)}"]`,
		),
		reportError: (cause) => error = errorMessage(cause),
		errorMessage,
		persistSnapshotCache: persistStartupSnapshotCache,
		vocabulary,
		relationTypeNames: () => relationTypes.names,
		isSymmetricRelationType: (type) => relationTypes.isSymmetric(type),
	});
	const pendingEmptyItemController = createPendingEmptyItemController({
		getSnapshot: () => snapshot,
		flushAutosave: (workId) => editorController.flushAutosave(workId),
		deleteItem: (id) => api.deleteItem(id),
		reload: (current) => load(undefined, current, current),
		reportError: (cause) => error = errorMessage(cause),
	});
	const outlineOperations = new OutlineOperationsController({
		api,
		getItems: () => snapshot.items,
		getItemById: (id) => itemById.get(id),
		reload: load,
		flushAutosave: (workId) => editorController.flushAutosave(workId),
		reportError: (cause) => error = errorMessage(cause),
		pendingEmpty: pendingEmptyItemController,
		clearTemporaryExpansion: (id) => outlineDisplay.clearExpansion(id),
		captureRequest: captureOutlineRequest,
		selection: { current: () => selectedId, clear: () => selectOccurrence(null) },
	});
	const keyboardWorkspace = new KeyboardWorkspaceController({
		selectedId: () => selectedId,
		hoistId: () => browsingLocation.hoistOccurrenceId,
		view: () => viewMode,
		navigation: screenNavigation,
		longFormActive: () => longForm.active,
		select: selectOccurrence,
		focus: requestFocus,
		setHoist: (id) => selectionWorkspace.setHoist(id),
		projection: () => browsingProjection,
		items: () => snapshot.items,
		clearTemporaryExpansion: () => outlineDisplay.setExpanded([]),
		setCollapsed: (id, collapsed) => api.setCollapsed(id, collapsed),
		reload: () => load(),
	});
	const screenPresenter = new ScreenDestinationPresenter({ comparison, dates: dateProjectionController, work: workController, tags: tagController });

	const keyboard = new KeyboardController({
		context: () => commandContext,
		blocked: () => startup.phase !== "ready" || commandPaletteOpen || Boolean(confirmationController.pending) || licensesDialogOpen || Boolean(occurrenceContextMenu) || Boolean(document.querySelector('[role="dialog"], dialog[open]')),
		execute: executeCommand,
		reportError: (cause) => error = errorMessage(cause),
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
	const browsingLocation = $derived(navigationController.browsingLocation);
	// biome-ignore lint/correctness/noUnusedVariables: Retained for browsing navigation contract test compliance
	const browsingPane = $derived(navigationController.browsingPane);
	const browsingProjection = $derived(navigationController.projectBrowsing(snapshot));
	const commandPaletteOpen = $derived(paletteController.commandPaletteOpen);
	const quickCaptureText = $derived(omniController.quickCaptureText);
	const suggestions = $derived(omniController.suggestions);
	const searchResults = $derived(omniController.searchResults);
	const searchActiveIndex = $derived(omniController.searchActiveIndex);

	// biome-ignore lint/correctness/noUnusedVariables: Retained for omniwindow contract test compliance
	const omniEntryCount = $derived(omniController.omniEntryCount);
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
	const recentEditedItems = $derived.by(() =>
		rankRecentEditedItems({
			items: snapshot.items,
			stashItemIds: snapshot.stashItemIds,
		})
	);
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
	const semanticLinkAnnotations = $derived(
		projectSemanticLinkAnnotations(snapshot.items, snapshot.links, relationTypes.definitions),
	);
	const linkableWorks = $derived([
		...new Map([
			...snapshot.items.map((item) => [item.workId, { workId: item.workId, text: item.text }] as const),
			...unplacedWorks.map((work) => [
				work.workId,
				{ workId: work.workId, text: work.text },
			] as const),
		]).values(),
	]);
	const visibleRows = $derived.by(() => outlineDisplay.visibleRows(
		snapshot,
		browsingProjection,
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
		isHoisted: Boolean(browsingLocation.hoistOccurrenceId),
		isOutline: viewMode === "outline" && !longForm.active,
		hasReturnPosition: Boolean(keyboardWorkspace.position),
		canGoBack: screenNavigation.canGoBack,
	});
	const commands = $derived(commandAvailability(commandContext));
	const occurrenceContextMenuItems = $derived.by((): readonly ContextMenuItem[] => {
		const bookmarked = Boolean(
			selectedId && bookmarkController.bookmarks.some((bookmark) => bookmark.occurrenceId === selectedId),
		);
		return [
			{ id: "open-outline", label: "アウトラインで開く" },
			{ id: "zoom", label: `この${vocabulary.occurrence}へZoom` },
			{
				id: "long-form",
				label: vocabulary.manuscriptOpen,
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
		paletteController.commandPaletteQuery,
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
	const chordCommands = $derived(COMMAND_DEFINITIONS.flatMap((command) => command.chordKey ? [{
		id: command.id, label: command.label(vocabulary), chordKey: command.chordKey,
		availability: commands[command.id],
	}] : []));

	// Side-effect boundary: load emergence suggestions on selection changes once startup is ready.
	// Dependency: selectedId, startup.phase. Cleanup: managed inside loadEmergence request lifecycle.
	$effect(() => {
		const id = selectedId;
		if (id && startup.phase === "ready") void loadEmergence(id);
		else emergenceController.clear();
	});


	// Side-effect boundary: sync work-level history, recovery snapshots, and reference backlinks with selection.
	// Dependency: selectedItem?.workId, selectedBranchId, startup.phase.
	// Cleanup: handled by controllers (history.clear, editorController.clearBacklinks).
	$effect(() => {
		const workId = selectedItem?.workId;
		if (workId && startup.phase === "ready") {
			void history.loadRevisions(workId);
			void history.loadWorkLineage(workId);
			if (selectedBranchId) void history.loadRecoverySnapshots(workId, selectedBranchId);
			else history.clearRecovery();
			void editorController.loadInternalReferenceBacklinks(workId);
		} else {
			history.clear();
			editorController.clearBacklinks();
		}
	});

	onMount(() => {
		const cleanupTheme = themeController.init();
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
		const cleanupKeyboard = globalKeyboard.connect();
		window.addEventListener("beforeunload", warnAboutUnsavedChanges);
		document.addEventListener("visibilitychange", flushWhenHidden);
		// Capture before editor libraries so Ctrl+K cannot be consumed as a
		// Markdown link-formatting shortcut while the textarea has focus.

		void startupController.start();
		return () => {
			startupController.dispose();
			omniController.dispose();
			outlineController.dispose();
			bookmarkController.dispose();
			screenNavigation.invalidate();
			selectionWorkspace.dispose();
			tree.dispose();
			cleanupTheme();
			persistStartupSnapshotCache();
			window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
			document.removeEventListener("visibilitychange", flushWhenHidden);
			cleanupKeyboard();
			commandExecution.dispose();
			paletteFocus.dispose();
			contextMenuController.close();
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

	async function loadStartupData(current: () => boolean): Promise<void> {
		await relationTypes.load(current);
		if (!current()) return;
		tree.reconcileRelations(relationTypes.names, true);
		const loaded = await load(undefined, current, current);
		if (!current()) return;
		if (!loaded) throw new Error(error || "初期データの読み込みに失敗しました。");
		const discarded = await pendingEmptyItemController.discardRestored(current);
		if (!current()) return;
		if (!discarded) throw new Error(error || "復元データの処理に失敗しました。");
		startupController.markDataLoaded(current);
		persistStartupSnapshotCache();
		await loadTags(current);
	}

	async function load(focusId?: string, canFocus = () => true, startupCurrent?: () => boolean): Promise<boolean> {
		if (!startupCurrent) startupController.invalidateDataLoad();
		return outlineController.reload({
			focusId, canFocus,
			current: startupCurrent ?? (() => !startupController.cancelled),
			treeRequired: !startupCurrent,
		});
	}

	function persistStartupSnapshotCache(
		snapshotToCache?: OutlineSnapshot,
		location = navigationController.browsingLocation,
	): void {
		// Explicit snapshots are saved API data; only the drawing snapshot may contain unsaved input.
		if (startupCacheActive || startup.phase !== "ready" || (!snapshotToCache && editorController.hasUnsavedChanges())) return;
		// biome-ignore lint/plugin/noSwallowedRejection: Startup acceleration is optional and must not interrupt editing.
		void api.saveStartupSnapshotCache(snapshotToCache ?? snapshot, location).catch(() => {
			// Startup acceleration must not interrupt editing when the cache cannot be written.
		});
	}

	function selectOccurrence(id: string | null, afterSelection?: (current: () => boolean) => void): boolean {
		return selectionWorkspace.select(id, afterSelection);
	}

	/** The selected Work joins the filter only as a transient display exception. */
	const activeGlobalLineageFilter = $derived(tree.activeFilter());

	function releaseEditorFocus(): void {
		const active = document.activeElement;
		if (active instanceof HTMLTextAreaElement && active.dataset.itemId !== undefined) {
			active.blur();
		}
	}

	function deselectFromBlank(event: MouseEvent): void {
		if (event.button !== 0 || outlineDrag.draggedId) return;
		selectOccurrence(null, releaseEditorFocus);
	}

	const openOccurrenceContextMenu = (id: string, source: "outline" | "tree", event: MouseEvent | KeyboardEvent): void => contextMenuController.open(id, source, event);
	const handleOccurrenceContextMenuKeydown = (id: string, source: "outline" | "tree", event: KeyboardEvent): void => contextMenuController.keydown(id, source, event);
	const executeOccurrenceContextMenuAction = contextMenuController.execute;

	function openTreeOccurrence(id: string): void {
		if (!itemById.has(id)) return;
		openOutlineOccurrence(id, ancestorBreadcrumb(snapshot, id).map((item) => item.id));
	}
	function hoistSelected(): void {
		if (!selectedId) return;
		outlineDisplay.expand(selectedId);
		selectionWorkspace.setHoist(selectedId);
	}

	function hoistOccurrence(id: string): void {
		selectOccurrence(id, () => void executeCommand("hoist"));
	}

	function clearHoist(): void {
		selectionWorkspace.setHoist(null);
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

	function selectInspectorPlacement(id: string): void {
		openOutlineOccurrence(id);
	}

	function openOutlineOccurrence(id: string, expandedIds = transientExpandedIds): void {
		void screenNavigation.navigate({ view: "outline", occurrenceId: id, expandedIds });
	}

	const outlineFocus = new OutlineFocusAdapter({
		context: () => ({ pane: navigationController.browsing.activePaneId, origin: screenNavigation.origin }),
		canFocus: (id) => viewMode === "outline" && selectedId === id,
	});
	onMount(() => () => outlineFocus.dispose());
	function requestFocus(id: string, caretOffset?: number, current = selectionWorkspace.currentReceipt()): void {
		outlineFocus.request(id, caretOffset, current);
	}

	// biome-ignore lint/correctness/noUnusedVariables: Retained for browsing navigation contract test compliance
	function addBrowsingPane(): void {
		navigationController.addBrowsingPane();
	}

	// biome-ignore lint/correctness/noUnusedVariables: Retained for browsing navigation contract test compliance
	function switchBrowsingPane(paneId: string): void {
		selectionWorkspace.switchPane(paneId);
	}

	function openBreadcrumb(id: string): void {
		selectOccurrence(id, () => {
			if (browsingLocation.hoistOccurrenceId) selectionWorkspace.setHoist(null);
		});
	}

	// Side-effect boundary: view/selected Work/filter changes invalidate the prior Tree request.
	// Tree owns generations; untrack keeps result/error/loading writes out of the dependencies.
	// Cleanup invalidates responses after selection changes or leaving Tree.
	$effect(() => {
		if (viewMode !== "globalLineage") { tree.invalidate(); return; }
		const key = tree.filterKey();
		untrack(() => { if (tree.needsRefresh(key)) void tree.refresh(); });
		return () => tree.invalidate();
	});

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
		await outlineOperations.handleKeydown(event, row.item, () => ({
			start: textarea.selectionStart,
			end: textarea.selectionEnd,
		}));
	}

	function updateLocalText(id: string, textarea: HTMLTextAreaElement): void {
		pendingEmptyItemController.noteTextChange(id, textarea.value);
		editorController.updateLocalText(id, textarea);
	}
	function updateEditorSelection(id: string, textarea: HTMLTextAreaElement): void {
		outlineViewport.track(id, browsingLocation.hoistOccurrenceId, textarea);
		editorController.updateEditorSelection(id, textarea);
	}
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
	const openUnplaced = workController.openUnplaced;
	const updateUnplacedText = workController.updateUnplacedText;
	const openStubs = workController.openStubs;
	const openDuplicates = workController.openDuplicates;
	const createStubFromList = workController.createStubFromList;
	const updateStubText = workController.updateStubText;
	const resolveStubEntry = workController.resolveStubEntry;
	const placeUnplaced = workController.placeUnplaced;
	const excludeDuplicateCandidate = workController.excludeDuplicateCandidate;
	const createDuplicateCandidateLink = workController.createDuplicateCandidateLink;
	const requestDuplicateMerge = workController.requestDuplicateMerge;
	const linkUnplaced = workController.linkUnplaced;
	const openToday = dateProjectionController.openToday;
	const loadDateProjection = dateProjectionController.load;
	const moveDateRange = dateProjectionController.moveRange;
	const showWeek = dateProjectionController.showWeek;

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
		await bookmarkController.reload();
	}

	async function removeBookmark(id: string): Promise<void> {
		await commandExecution.run(async () => {
			await api.deleteBookmark(id);
			await bookmarkController.reload();
		});
	}

	async function openBookmark(id: string): Promise<void> {
		const origin = screenNavigation.origin;
		const resolved = await api.resolveBookmark(id);
		await openNavigationTarget(resolved.target, undefined, origin);
	}

	async function resumeEditing(): Promise<void> {
		const origin = screenNavigation.origin;
		const resolved = await api.resolveResumePosition();
		if (!resolved) return;
		await openNavigationTarget(resolved.target, resolved.resolvedCaretOffset, origin);
	}

	async function openNavigationTarget(target: NavigationTarget, caretOffset?: number, origin = screenNavigation.origin): Promise<void> {
		const state = navigationUiState(target, caretOffset);
		const accepted = await screenNavigation.navigate({ view: "outline", occurrenceId: state.selectedOccurrenceId, expandedIds: state.temporaryExpandedOccurrenceIds, caretOffset: state.caretOffset }, origin);
		if (accepted && !state.selectedOccurrenceId) error = `この${vocabulary.work}には表示できる${vocabulary.occurrence}がありません。`;
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
		await history.loadRecoverySnapshots(selectedItem.workId, selectedBranchId);
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
			history.loadRevisions(selectedItem.workId),
			history.loadWorkLineage(selectedItem.workId),
			history.loadRecoverySnapshots(selectedItem.workId, selectedBranchId),
		]);
	}

	async function setSelectedOccurrenceRevision(revisionId: string | null): Promise<void> {
		if (!selectedId) return;
		try {
			await editorController.flushAutosave();
			await api.setOccurrenceRevision(selectedId, revisionId);
			await load(selectedId);
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function openSelectedRevisionComparison(): Promise<void> {
		await comparison.openRevision(
			selectedItem?.revisionSelector.mode === "pinned"
				? selectedItem.revisionSelector.revisionId
				: "",
		).catch((cause) => { error = errorMessage(cause); });
	}

	async function retryWorkingCopySave(): Promise<void> {
		try {
			await editorController.retryAutosave();
		// biome-ignore lint/plugin/noSwallowedRejection: The coordinator retains the draft and exposes the failed status for another retry.
		} catch {
			// The coordinator retains the draft and exposes the failure detail.
		}
	}

	async function saveLongFormEditing(): Promise<void> {
		await keyboardWorkspace.saveLongForm();
	}
	function startLongFormEditing(): void { void executeCommand("startLongFormEditing"); }

	async function cancelLongFormEditing(): Promise<void> {
		if (!longForm.dirty) {
			longFormController.reset();
			return;
		}
		await requestConfirmation({
			action: "cancel-longform",
			pendingAction: async () => {
				longFormController.reset();
			},
		});
	}

	function handleLongFormInput(value: string): void {
		longFormController.input(value);
	}

	function clearOutlineFilter(): void {
		outlineDisplay.clearFilter();
	}

	function captureOutlineRequest(): () => boolean {
		const selected = selectionWorkspace.currentReceipt();
		const origin = screenNavigation.origin;
		return () => selected() && origin === screenNavigation.origin;
	}
	const toggle = (row: VisibleRow): Promise<void> => outlineOperations.toggle(row.item);

	function handleSearchKeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if (event.key === "Escape") {
			omniController.clearOmniwindow();
			return;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const delta = event.key === "ArrowDown" ? 1 : -1;
			omniController.moveSearchActiveIndex(delta);
			return;
		}
		if (event.key === "Enter" && event.shiftKey && quickCaptureText.trim()) {
			event.preventDefault();
			void executeCommand("quickCapture");
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const entry = omniController.enterEntry((entry) => titleFor(entry.value.item));
			if (entry === "capture") { void executeCommand("quickCapture"); return; }
			if (entry) void selectItem(entry.value.item, entry.value.ancestorIds);
		}
	}

	async function selectItem(item: OutlineItem, ancestorIds: string[]): Promise<void> {
		const input = omniController.captureInput();
		if (await screenNavigation.navigate({ view: "outline", occurrenceId: item.id, expandedIds: ancestorIds })) omniController.clearAccepted(input);
	}

	function openRecentItem(item: OutlineItem): void {
		void selectItem(item, ancestorBreadcrumb(snapshot, item.id).map((ancestor) => ancestor.id));
	}

	function openRecentNavigationItem(item: RecentNavigationItem): void {
		const outlineItem = itemById.get(item.id);
		if (outlineItem) void openRecentItem(outlineItem);
	}

	function openHelp(): void {
		void screenNavigation.navigate({ view: "help" });
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

	async function performAddLink(input: CreateLinkInput): Promise<void> {
		await api.createLink(input);
		await load();
	}

	async function removeLink(link: OutlineLink): Promise<void> {
		await api.deleteLink(link.fromId, link.toId, link.type);
		await load();
	}

	async function createRelationTypeDefinition(input: {
		name: string;
		direction: RelationTypeDirection;
	}): Promise<void> {
		await relationTypes.create(input);
		tree.reconcileRelations(relationTypes.names);
	}

	async function reverseLink(link: OutlineLink): Promise<void> {
		if (link.origin === "derived" || relationTypes.isSymmetric(link.type)) return;
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
	async function openTags(): Promise<void> {
		await screenNavigation.navigate({ view: "tags" });
	}

	async function loadTags(current = () => true): Promise<void> {
		try {
			await Promise.all([tagController.load(current), workController.loadUnplacedWorks(current)]);
		} catch (cause) {
			if (current()) tagController.error = errorMessage(cause);
		}
	}

	async function renameTag(): Promise<void> {
		await tagController.rename();
		if (!tagController.error) {
			try {
				await workController.loadUnplacedWorks();
			} catch (cause) {
				tagController.error = errorMessage(cause);
			}
		}
	}

	async function mergeTags(): Promise<void> {
		await tagController.merge();
		if (!tagController.error) {
			try {
				await workController.loadUnplacedWorks();
			} catch (cause) {
				tagController.error = errorMessage(cause);
			}
		}
	}

	function openTagNode(workId: string): void {
		const item = itemByWorkId.get(workId);
		if (item) {
			openOutlineOccurrence(item.id);
			return;
		}
		if (unplacedWorks.some((work) => work.workId === workId)) {
			void openUnplaced();
			return;
		}
		error = `この${vocabulary.work}には表示できる${vocabulary.occurrence}がありません。`;
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

	const commandExecution = new CommandExecutionController({
		context: () => commandContext,
		reportError: (cause) => error = errorMessage(cause),
		reportUnavailable: (reason) => error = reason,
		operations: {
			quickCapture: performQuickCapture, hoist: hoistSelected, clearHoist,
			exportMarkdown: (payload) => performMarkdownExport(payload.exportOccurrenceId), addBookmark: performAddBookmark,
			createLink: (payload) => payload.linkInput ? performAddLink(payload.linkInput) : openLinkEditor(),
			saveRevision: async (payload) => { if (payload.snapshotId) await performPromoteRecoverySnapshot(payload.snapshotId); },
			createBranch: requestRewriteAsNewBranch,
			startLongFormEditing: () => keyboardWorkspace.openLongForm(), showOutline: () => keyboardWorkspace.openOutline(),
			showTree: () => keyboardWorkspace.openTree(), goBack: () => screenNavigation.goBack(), returnToEditor: () => keyboardWorkspace.returnToEditor(),
			focusSearch: () => keyboardWorkspace.focusSearch(), focusQuickCapture: () => keyboardWorkspace.focusSearch(),
			toggleSidebar: toggleNavigation, collapseAll: () => keyboardWorkspace.setAllCollapsed(true), expandAll: () => keyboardWorkspace.setAllCollapsed(false),
			toggleCollapsed: async () => { const row = visibleRows.find((entry) => entry.item.id === selectedId); if (row) await toggle(row); },
			zoomOut: () => keyboardWorkspace.zoomOut(), removeOccurrence: async () => { if (selectedId) await outlineOperations.remove(selectedId); },
		},
	});
	function executeCommand(id: CommandId, snapshotId?: string, linkInput?: CreateLinkInput): Promise<void> {
		return commandExecution.execute(id, { snapshotId, linkInput });
	}
	const paletteFocus = new PaletteFocusAdapter({ open: () => commandPaletteOpen, afterRender: tick });
	const globalKeyboard = new GlobalKeyboardAdapter({
		chord: keyboard,
		blocked: () => commandPaletteOpen || Boolean(confirmationController.pending) || licensesDialogOpen || Boolean(occurrenceContextMenu) || Boolean(document.querySelector('[role="dialog"], dialog[open]')),
		specialBlocked: () => Boolean(confirmationController.pending) || licensesDialogOpen || Boolean(occurrenceContextMenu) || Boolean(document.querySelector('[role="dialog"]:not(.command-palette__content), dialog[open]')),
		help: () => { if (commandPaletteOpen) void closeCommandPalette(); openHelp(); },
		togglePalette: () => { if (commandPaletteOpen) void closeCommandPalette(); else void openCommandPalette(); },
		focusPane: focusWorkspacePane, treeVisible: () => viewMode === "globalLineage", bindings: shortcuts.bindings,
		execute: executeCommand, reportError: (cause) => error = errorMessage(cause),
	});

	async function openCommandPalette(): Promise<void> {
		keyboard.cancel();
		keyboardWorkspace.remember();
		paletteFocus.remember();
		paletteController.openCommandPalette();
	}

	async function closeCommandPalette(): Promise<void> {
		paletteController.closeCommandPalette();
		await paletteFocus.restore();
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
		return parseInlineSemanticLinks(text, relationTypes.names);
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
		if (!await longFormController.save()) return;
		confirmationController.rewriteBranchName = "";
		await requestConfirmation({
			action: "rewrite",
			occurrenceId: selectedItem.id,
			workId: selectedItem.workId,
			sourceBranchId: selectedBranchId,
		});
	}

	function requestClearHoist(): void { void executeCommand("clearHoist"); }
	function exportMarkdown(): void { void executeCommand("exportMarkdown"); }
	function addBookmark(): void { void executeCommand("addBookmark"); }
	function promoteRecoverySnapshot(snapshotId: string): Promise<void> {
		return executeCommand("saveRevision", snapshotId);
	}

	const purgeTrash = workController.purgeTrash;

	async function performMarkdownExport(selectedOccurrenceId?: string): Promise<void> {
		markdownExportNotice = "";
		const started = performance.now();
		let outcome: "ok" | "error" = "ok";
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
			downloadTextFile(markdown, "text/markdown;charset=utf-8", `radiora-${localDateValue(new Date())}.md`);
			markdownExportNotice = "Markdownをエクスポートしました。";
		} catch (cause) {
			outcome = "error";
			error = `Markdownをエクスポートできませんでした: ${errorMessage(cause)}`;
		} finally {
			void api.recordClientOperation("export.markdown", outcome, performance.now() - started)
				.catch(() => console.warn("Could not record Markdown export."));
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
			downloadTextFile(source, "text/x-opml;charset=utf-8", `radiora-${localDateValue(new Date())}.opml`);
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
			downloadTextFile(source, "application/json;charset=utf-8", `radiora-backup-${localDateValue(new Date())}.json`);
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
			await relationTypes.load();
			tree.reconcileRelations(relationTypes.names, true);
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
			licenseIndex = await fetchLicenseIndex();
		} catch (cause) {
			licenseError = errorMessage(cause);
		} finally {
			licenseLoading = false;
		}
		licensesDialogOpen = true;
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
				await branchRewrite.confirmRewrite(confirmation, confirmationController.rewriteBranchName);
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

	function errorMessage(cause: unknown): string {
		if (typeof cause === "object" && cause && "message" in cause) return String(cause.message);
		return String(cause);
	}

	const outlineHelpers = $derived<OutlineHelpers>({
		inlineSemanticLinksFor,
		semanticLinkAnnotationsFor,
		bodyFor,
		titleFor,
		referencesIn,
		annotationDirection,
	});

	const outlineHandlers: OutlineRowHandlers = {
		openOccurrenceContextMenu,
		handleOccurrenceContextMenuKeydown,
		deselectFromBlank,
		dropOn: outlineDrag.dropOn,
		toggle: (row) => {
			const current = captureOutlineRequest();
			void toggle(row).catch((cause) => { if (current()) error = errorMessage(cause); });
		},
		selectOccurrence,
		hoistOccurrence,
		updateLocalText,
		updateEditorSelection,
		discardUntouchedEmptyItem: pendingEmptyItemController.discard,
		handleKeydown,
		openEditorInternalReference,
		applyInternalReferenceCompletion,
		updateInlineLinkSearch,
		handleInlineLinkOmniKeydown,
		selectInlineLinkCandidate,
		createInlineLinkTarget,
		selectInlineLinkType,
		setInlineLinkDirection,
		commitInlineLink,
		openInternalReference,
		inspectInlineSemanticLink,
	};
</script>

<svelte:head><title>Radiora v2 PoC</title></svelte:head>

{#if keyboard.open}
	<ShortcutNavigation commands={chordCommands} notice={keyboard.notice}
		onChoose={(id) => void keyboard.choose(id).catch((cause) => error = errorMessage(cause))}
		onCancel={() => keyboard.cancel()} />
{/if}

<CommandPaletteDialog
	open={commandPaletteOpen}
	commands={commandPaletteCommands}
	{vocabulary}
	bind:query={() => paletteController.commandPaletteQuery, (value) => paletteController.setQuery(value)}
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
		onClose={contextMenuController.close}
	/>
{/if}

{#if startupCacheActive}
	<StartupCacheStatus
		startup={startup}
		onRetry={startupController.retry}
		onReload={() => void startupController.reloadData()}
	/>
{/if}

<div class="shell" class:nav-collapsed={navCollapsed} inert={startupCacheActive} aria-busy={startupCacheActive}>
	<PrimaryNavigation
		collapsed={navCollapsed}
		activeView={viewMode}
		recentItems={primaryNavigationRecentItems}
		selectedId={selectedId}
		onToggleCollapse={toggleNavigation}
		onOpenToday={() => void openToday()}
		onOpenUnplaced={() => void openUnplaced()}
		onOpenStubs={() => void openStubs()}
		onOpenDuplicates={() => void openDuplicates()}
		onOpenOptions={() => void screenNavigation.navigate({ view: "options" })}
		onOpenTags={() => void openTags()}
		onOpenHelp={openHelp}
		onOpenRecentItem={(item) => void openRecentNavigationItem(item)}
	/>
	<AppTopBar
		{viewMode}
		{viewModeLabel}
		canGoBack={commands.goBack.enabled}
		onGoBack={() => void executeCommand("goBack")}
		quickCaptureText={omniController.quickCaptureText}
		{quickCaptureDestinationLabel}
		{quickCaptureSubmitting}
		startupPhase={startup.phase}
		{searchActiveIndex}
		{suggestions}
		{searchResults}
		searchEntriesLength={omniController.searchEntries.length}
		{commands}
		{vocabulary}
		bookmarks={bookmarkController.bookmarks}
		{inspectorCollapsed}
		{workingCopySaveStatus}
		themePreference={themeController.preference}
		onSetViewMode={(mode) => void executeCommand(mode === "outline" ? "showOutline" : "showTree")}
		onQuickCaptureInput={(val) => {
			omniController.input(val);
		}}
		onQuickCaptureKeydown={handleSearchKeydown}
		onSelectSuggestion={(item, ancestorIds) => selectItem(item, ancestorIds ?? [])}
		onSelectSearch={(result) => selectItem(result.item, result.ancestorIds)}
		onExecuteCommand={(cmd) => void executeCommand(cmd)}
		onResumeEditing={resumeEditing}
		onOpenBookmark={openBookmark}
		onRemoveBookmark={removeBookmark}
		onToggleInspector={toggleInspector}
		onRetryWorkingCopySave={retryWorkingCopySave}
		onThemePreferenceChange={(preference) => themeController.setPreference(preference)}
		{titleFor}
	/>

	{#if error}<div class="error">{error}<IconButton label="エラーメッセージを閉じる" onclick={() => (error = "")}>×</IconButton></div>{/if}

	{#if startup.phase !== "ready" && !startupCacheActive}
		<StartupView startup={startup} onRetry={startupController.retry} />
	{:else}
	<main
		class="app-main"
		class:full-workspace={dedicatedView}
		class:inspector-collapsed={inspectorCollapsed}
		style={`--inspector-width:${inspectorColumn}`}
	>
		{#if viewMode === "outline"}
			<section class="outline-panel" data-pane-id={navigationController.browsing.activePaneId}>
				{#if longForm.active}
					{#if selectedItem}
						<LongFormEditor
							item={selectedItem}
							{selectedBreadcrumb}
							preview={longForm.preview}
						text={longForm.text}
						dirty={longForm.dirty}
						{titleFor}
						onInput={(value) => handleLongFormInput(value)}
							onSave={saveLongFormEditing}
							onCancel={cancelLongFormEditing}
							onSetPreview={(prev) => (longForm.preview = prev)}
						/>
					{/if}
				{:else}
					<OutlineView
						draggedId={outlineDrag.draggedId}
						onDragStart={outlineDrag.start}
						onDragEnd={outlineDrag.end}
						{outlineContextBreadcrumb}
						{outlineContextBreadcrumbItems}
						{outlineContextTitle}
						hoisted={Boolean(browsingLocation.hoistOccurrenceId)}
						canClearHoist={commands.clearHoist.enabled}
						clearHoistReason={commands.clearHoist.reason}
						onClearHoist={requestClearHoist}
						{visibleRows}
						{vocabulary}
						loading={outlineController.loading}
						hasSnapshot={outlineController.hasSnapshot}
						snapshotItemsLength={snapshot.items.length}
						{selectedId}
						{internalReferenceCompletion}
						{inlineLinkCompletion}
						relationTypeDefinitions={relationTypes.definitions}
						stashItemIdsLength={snapshot.stashItemIds.length}
						knotsLength={snapshot.knots.length}
						{openBreadcrumb}
						createRoot={outlineOperations.createRoot}
						handlers={outlineHandlers}
						helpers={outlineHelpers}
					/>
				{/if}
			</section>
		{:else if viewMode === "today"}
			<TodayView
				bind:dateStart={dateProjectionController.start}
				bind:dateEnd={dateProjectionController.end}
				bind:outlineFilter={() => outlineDisplay.filter, (value) => outlineDisplay.setFilter(value)}
				projection={dateProjectionController.projection}
				loading={screenNavigation.pendingView === "today"}
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
				relationTypeDefinitions={relationTypes.definitions}
				bind:outlineFilter={() => outlineDisplay.filter, (value) => outlineDisplay.setFilter(value)}
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
				tagScopes={tagController.scopes}
				tagAliases={tagController.aliases}
				tagError={tagController.error}
				bind:selectedTag={tagController.selectedTag}
				bind:tagRenameFrom={tagController.renameFrom}
				bind:tagRenameTo={tagController.renameTo}
				bind:tagMergeSources={tagController.mergeSources}
				bind:tagMergeTarget={tagController.mergeTarget}
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
				operationLogPort={api}
				{opmlNotice}
				{jsonBackupNotice}
				treeProjectionPreference={tree.projectionPreference}
				{navCollapsed}
				{inspectorCollapsed}
				{inspectorWidth}
				themePreference={themeController.preference}
				relationTypeDefinitions={relationTypes.definitions}
				onCreateRelationTypeDefinition={createRelationTypeDefinition}
				onPersistMarkdownExportPreference={persistMarkdownExportPreference}
				onExportMarkdown={exportMarkdown}
				onImportOpml={importOpmlFile}
				onExportOpml={performOpmlExport}
				onExportJsonBackup={performJsonBackupExport}
				onRestoreJsonBackup={restoreJsonBackupFile}
				onTreeProjectionChange={(next) => tree.setProjection(next)}
				onNavigationCollapsedChange={setNavigationCollapsed}
				onInspectorCollapsedChange={setInspectorCollapsed}
				onInspectorWidthChange={setInspectorWidth}
				onThemePreferenceChange={(preference) => themeController.setPreference(preference)}
				onPersistQuickCapturePreference={persistQuickCapturePreference}
				onOpenTrash={() => void openTrash()}
				onOpenLicenses={openLicenses}
			/>
		{:else if viewMode === "help"}
			<InAppHelp
				shortcuts={helpShortcuts}
				editorShortcuts={helpEditorShortcuts}
				onOpenOutline={() => { void screenNavigation.navigate({ view: "outline" }); }}
				onOpenToday={() => void openToday()}
				onOpenUnplaced={() => void openUnplaced()}
				onOpenOptions={() => { void screenNavigation.navigate({ view: "options" }); }}
				onOpenCommandPalette={() => void openCommandPalette()}
			/>
		{:else if viewMode === "comparison"}
			{#if comparison.link}
				{#key comparison.link.linkId}
					<ComparisonPane
						documents={[comparison.link.left, comparison.link.right]}
						context={{
							kind: "semantic-link",
							type: comparison.link.type,
							direction: comparison.link.direction,
							createdAt: comparison.link.createdAt,
							reason: comparison.link.reason,
						}}
						preferredLeftKey={comparisonDocumentKey(comparison.link.left)}
						preferredRightKey={comparisonDocumentKey(comparison.link.right)}
						locked
					/>
				{/key}
			{:else if comparison.work}
				{#key comparison.work.workId}
					<ComparisonPane
						documents={comparison.work.documents}
						context={{ kind: "branch" }}
						preferredLeftKey={comparison.work.preferredLeftKey}
						preferredRightKey={comparison.work.preferredRightKey}
					/>
				{/key}
			{:else if selectedItem}
				{#if history.revisionsLoading}
					<section class="revision-comparison"><p class="comparison-empty">版を読み込んでいます…</p></section>
				{:else}
					{#key selectedItem.workId}
						<RevisionComparison
							revisions={history.revisions}
							preferredRevisionId={comparison.preferredRevisionId ??
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
			{#if history.workLineageLoading}
				<section class="revision-comparison"><p class="comparison-empty">{vocabulary.workLineage}を読み込んでいます…</p></section>
			{:else if history.workLineage}
				{#key history.workLineage.work.id}
					<div class="work-lineage-workspace">
						<WorkLineage
							projection={history.workLineage}
							onCompare={(scope, id) => comparison.openWork(scope, id)}
							onBack={() => { void screenNavigation.navigate({ view: "outline" }); }}
						/>
						{#if selectedItem && selectedBranchId}
							<RecoverySnapshots
								snapshots={history.recoverySnapshots}
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
		{:else}
			<TreeRequestStatus
				loading={tree.loading}
				error={tree.error === null ? "" : errorMessage(tree.error)}
				onRetry={() => void tree.refresh()}
			>
				{#if tree.projection}
					<GlobalLineage
						projection={tree.projection}
						projectionPreference={tree.projectionPreference}
						filter={activeGlobalLineageFilter}
						relationTypeDefinitions={relationTypes.definitions}
						onFilterChange={(next) => tree.setFilter(next)}
						{selectedId}
						selectedWorkId={selectedItem?.workId ?? null}
						onSelect={(id) => selectOccurrence(id)}
						onOpen={(id) => void openTreeOccurrence(id)}
						onContextMenu={(id, event) => openOccurrenceContextMenu(id, "tree", event)}
						onProjectionChange={(next) => tree.setProjection(next)}
					/>
				{/if}
			</TreeRequestStatus>
		{/if}

		{#if !dedicatedView}
			<InspectorView
				historicalTimeController={historicalTimeController}
				{asideMode}
				{selectedItem}
				{selectedPlacements}
				{selectedLinks}
				{selectedBranchId}
				recoverySnapshots={history.recoverySnapshots}
				revisions={history.revisions}
				{commands}
				{vocabulary}
				relationTypeDefinitions={relationTypes.definitions}
				inlineSemanticLinkNotice={inlineSemanticLinkNotice}
				internalReferenceBacklinks={internalReferenceBacklinks}
				internalReferenceNotice={internalReferenceNotice}
				{emergenceSuggestions}
				emergenceResolutionReasons={emergenceResolutionReasons}
				{emergenceLoading}
				onAsideModeChange={(mode) => asideMode = mode}
				onElement={(element) => inspectorElement = element}
				onStartResize={startInspectorResize}
				onAddBookmark={addBookmark}
				onSelectOccurrence={selectOccurrence}
				onUpdateSelectedHeading={updateSelectedHeading}
				onSelectPlacement={selectInspectorPlacement}
				showOutlineHint={viewMode === "outline"}
				onStartLongFormEditing={startLongFormEditing}
				onConfirmLink={(input) => executeCommand("createLink", undefined, input)}
				onDeleteLink={removeLink}
				onReverseLink={reverseLink}
				onCompareLink={(link) => comparison.openLink(link.id)}
				onSearch={api.searchItems}
				{titleFor}
				titleForId={titleForId}
				titleForWork={titleForWorkId}
				{formatCreatedAt}
				onOpenBacklink={openInternalReferenceBacklink}
				onSetEmergenceReason={(id, value) => emergenceController.setResolutionReason(id, value)}
				onResolveEmergence={resolveEmergence}
				onOpenWorkLineage={() => void screenNavigation.navigate({ view: "workLineage" })}
				onOpenRevisionComparison={openSelectedRevisionComparison}
				onSelectRevision={setSelectedOccurrenceRevision}
				onCreateBranch={() => executeCommand("createBranch")}
			/>
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

<HistoricalTimeSelectionDialog controller={historicalTimeController} />
<ConfirmationDialog
	bind:this={confirmationDialog}
	pending={confirmationController.pending}
	submitting={confirmationController.submitting}
	bind:rewriteBranchName={confirmationController.rewriteBranchName}
	onConfirm={confirmPendingAction}
	onReset={() => confirmationController.reset()}
/>

<LicensesDialog
	bind:open={licensesDialogOpen}
	{licenseIndex}
	{licenseDetail}
	{licenseError}
	{licenseLoading}
	onSelectLicense={selectLicense}
/>
