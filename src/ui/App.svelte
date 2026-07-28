<script lang="ts">
	import { onMount } from "svelte";
	import PhylogeneticTree from "./PhylogeneticTree.svelte";
	import type {
		EmergenceAction,
		EmergenceSuggestion,
		LinkType,
		OutlineItem,
		OutlineLink,
		OutlineSnapshot,
		RuleQueryResult,
		SavedRuleQuery,
		SearchAlias,
		SearchResult,
		Suggestion,
		TrashEntry,
	} from "../domain/models";
	import { LINK_TYPES } from "../domain/models";
	import type { RadioraBindings, StartupStatus } from "../shared/bindings";
	import { useUiVocabulary } from "./ui_vocabulary_context";

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
	type ViewMode = "outline" | "tree" | "trash";
	type AsideMode = "links" | "discover" | "query";

	const vocabulary = useUiVocabulary();
	let snapshot = $state<OutlineSnapshot>({ items: [], links: [], knots: [], stashItemIds: [] });
	let loading = $state(true);
	let startup = $state<StartupStatus>({ phase: "starting", message: "Radioraを起動しています…" });
	let error = $state("");
	let viewMode = $state<ViewMode>("outline");
	let selectedId = $state<string | null>(null);
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
	let ruleSource = $state('?- link("LIKE", From, To).');
	let ruleResult = $state<RuleQueryResult | null>(null);
	let ruleName = $state("");
	let savedRuleQueries = $state<SavedRuleQuery[]>([]);
	let ruleError = $state("");
	let newLinkTarget = $state("");
	let newLinkType = $state<LinkType>("LIKE");
	let draggedId = $state<string | null>(null);
	let trashEntries = $state<TrashEntry[]>([]);
	const saveTimers = new Map<string, number>();

	const itemById = $derived(new Map(snapshot.items.map((item) => [item.id, item])));
	const itemByWorkId = $derived(new Map(snapshot.items.map((item) => [item.workId, item])));
	const selectedItem = $derived(selectedId ? itemById.get(selectedId) ?? null : null);
	const selectedPlacements = $derived(selectedItem
		? snapshot.items.filter((item) => item.workId === selectedItem.workId)
			.sort((left, right) => left.orderKey - right.orderKey || left.id.localeCompare(right.id))
		: []);
	const selectedLinks = $derived(selectedItem
		? snapshot.links.filter((link) =>
			link.fromId === selectedItem.workId || link.toId === selectedItem.workId
		)
		: []);
	const linkTargets = $derived([
		...new Map(
			snapshot.items
				.filter((item) => item.workId !== selectedItem?.workId)
				.map((item) => [item.workId, item]),
		).values(),
	]);
	const visibleRows = $derived.by(() => buildVisibleRows(snapshot));
	const searchEntries = $derived([
		...suggestions.map((suggestion) => ({ kind: "suggestion" as const, value: suggestion })),
		...searchResults.map((result) => ({ kind: "result" as const, value: result })),
	]);

	$effect(() => {
		const id = selectedId;
		if (id && startup.phase === "ready") void loadEmergence(id);
		else emergenceSuggestions = [];
	});

	onMount(() => {
		let cancelled = false;
		async function monitorStartup(): Promise<void> {
			while (!cancelled) {
				try {
					startup = await api.getStartupStatus();
					if (startup.phase === "ready") {
						await load();
						aliases = await api.listSearchAliases();
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
		return () => { cancelled = true; };
	});

	async function retryStartup(): Promise<void> {
		startup = { phase: "starting", message: "再試行しています…", logPath: startup.logPath };
		startup = await api.retryStartup();
		if (startup.phase === "ready") await load();
	}

	async function load(focusId?: string): Promise<void> {
		try {
			error = "";
			snapshot = await api.listOutline();
			if (focusId) requestFocus(focusId);
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			loading = false;
		}
	}

	function buildVisibleRows(data: OutlineSnapshot): VisibleRow[] {
		const stash = new Set(data.stashItemIds);
		const normalItems = data.items.filter((item) => !stash.has(item.id));
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
			if (!item.collapsed) descendants.forEach((child) => visit(child, depth + 1));
		};
		(children.get(null) ?? []).forEach((root) => visit(root, 0));
		data.items.filter((item) => stash.has(item.id)).sort((a, b) => a.orderKey - b.orderKey)
			.forEach((item) => rows.push({ item, depth: 0, hasChildren: false, stash: true }));
		return rows;
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

	async function handleKeydown(event: KeyboardEvent, row: VisibleRow): Promise<void> {
		const textarea = event.currentTarget as HTMLTextAreaElement;
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
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

	function updateLocalText(id: string, text: string): void {
		const item = snapshot.items.find((candidate) => candidate.id === id);
		if (item) item.text = text;
		const oldTimer = saveTimers.get(id);
		if (oldTimer) clearTimeout(oldTimer);
		saveTimers.set(id, window.setTimeout(async () => {
			try {
				await api.updateItemText(id, text);
			} catch (cause) {
				error = errorMessage(cause);
			}
		}, 250));
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
		await api.deleteItem(id);
		if (selectedId === id) selectedId = null;
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
		for (const ancestorId of ancestorIds) {
			const ancestor = itemById.get(ancestorId);
			if (ancestor?.collapsed) await api.setCollapsed(ancestor.id, false);
		}
		searchQuery = "";
		suggestions = [];
		searchResults = [];
		searchActiveIndex = -1;
		selectedId = item.id;
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

	async function executeRule(): Promise<void> {
		ruleError = "";
		ruleResult = null;
		try {
			ruleResult = await api.runRuleQuery(ruleSource, 500);
		} catch (cause) {
			ruleError = errorMessage(cause);
		}
	}

	async function saveRule(): Promise<void> {
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

	async function addLink(): Promise<void> {
		if (!selectedId || !newLinkTarget || selectedId === newLinkTarget) return;
		await api.createLink({ fromId: selectedId, toId: newLinkTarget, type: newLinkType });
		newLinkTarget = "";
		await load();
	}

	async function removeLink(link: OutlineLink): Promise<void> {
		await api.deleteLink(link.fromId, link.toId, link.type);
		await load();
	}

	function requestFocus(id: string): void {
		setTimeout(() => {
			const element = document.querySelector<HTMLTextAreaElement>(`[data-item-id="${id}"]`);
			element?.focus();
			element?.setSelectionRange(element.value.length, element.value.length);
			element?.scrollIntoView({ block: "center" });
		}, 0);
	}

	function otherName(link: OutlineLink): string {
		const id = link.fromId === selectedItem?.workId ? link.toId : link.fromId;
		const item = itemByWorkId.get(id);
		return item ? titleFor(item) : `(空の${vocabulary.work})`;
	}

	async function duplicateSelectedOccurrence(): Promise<void> {
		if (!selectedItem) return;
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
		if (
			!confirm(
				`この${vocabulary.work}をゴミ箱へ移します。${count}件の${vocabulary.occurrence}と${vocabulary.semanticLink}は保持されます。`,
			)
		) return;
		await api.trashWork(selectedItem.id);
		selectedId = null;
		await load();
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

	async function purgeTrash(entry: TrashEntry): Promise<void> {
		if (
			!confirm(
				`完全消去します。${vocabulary.occurrence}${entry.occurrenceCount}件、${vocabulary.semanticLink}${entry.linkCount}件と本文を復元できなくなります。`,
			)
		) return;
		await api.purgeWork(entry.work.id);
		trashEntries = await api.listTrash();
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

	function errorMessage(cause: unknown): string {
		if (typeof cause === "object" && cause && "message" in cause) return String(cause.message);
		return String(cause);
	}
</script>

<svelte:head><title>Radiora v2 PoC</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand"><strong>Radiora</strong><span>v2</span></div>
		<nav class="view-switcher" aria-label="表示モード">
			<button class:active={viewMode === "outline"} aria-pressed={viewMode === "outline"}
				onclick={() => (viewMode = "outline")}>Outline</button>
			<button class:active={viewMode === "tree"} aria-pressed={viewMode === "tree"}
				onclick={() => (viewMode = "tree")}>Tree</button>
			<button class:active={viewMode === "trash"} aria-pressed={viewMode === "trash"}
				onclick={openTrash}>ゴミ箱</button>
		</nav>
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
				<div class="section-title"><span>Outline</span><button onclick={createRoot}>＋ Root</button></div>
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
								<button class="bullet" aria-label={`${vocabulary.work}を選択`} onclick={() => selectedId = row.item.id}>•</button>
								<textarea rows="1" data-item-id={row.item.id} value={row.item.text}
									onfocus={() => selectedId = row.item.id}
									oninput={(event) => updateLocalText(row.item.id, event.currentTarget.value)}
									onkeydown={(event) => handleKeydown(event, row)}></textarea>
								<button class="delete" title={`この${vocabulary.occurrence}を外す`} onclick={() => remove(row.item.id)}>×</button>
							</div>
						{/each}
					</div>
				{/if}

				{#if snapshot.stashItemIds.length}
					<div class="section-title stash-title"><span>Stash / Knots</span><small>{snapshot.knots.length} knot</small></div>
					<div class="stash-list">
						{#each visibleRows.filter((row) => row.stash) as row (row.item.id)}
							<button class:selected={selectedId === row.item.id} onclick={() => selectedId = row.item.id}>
								<span>∞</span>{row.item.text || `(空の${vocabulary.work})`}
							</button>
						{/each}
					</div>
				{/if}
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
		{:else}
			<section class="tree-panel" aria-label="Phylogenetic Tree">
				<PhylogeneticTree
					{snapshot}
					{selectedId}
					onSelect={(id) => (selectedId = id)}
				/>
			</section>
		{/if}

		<aside>
			{#if selectedItem}
				<nav class="aside-tabs" aria-label="詳細表示">
					<button class:active={asideMode === "links"} onclick={() => (asideMode = "links")}>{vocabulary.semanticLink}</button>
					<button class:active={asideMode === "discover"} onclick={() => (asideMode = "discover")}>発見</button>
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
										selectedId = placement.id;
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
					<div class="link-form">
						<select bind:value={newLinkType}>{#each LINK_TYPES as type}<option value={type}>{type}</option>{/each}</select>
						<select bind:value={newLinkTarget}>
							<option value="">{vocabulary.semanticLink}先を選択</option>
							{#each linkTargets as item}
								<option value={item.id}>{item.text || `(空の${vocabulary.work})`}</option>
							{/each}
						</select>
						<button onclick={addLink} disabled={!newLinkTarget}>{vocabulary.semanticLink}を追加</button>
					</div>
					<div class="links">
						{#each selectedLinks as link}
							<div><span class={`tag ${link.type.toLowerCase()}`}>{link.type}</span><span>{link.fromId === selectedItem.workId ? "→" : "←"} {otherName(link)}</span><button onclick={() => removeLink(link)}>×</button></div>
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
				{:else}
					<div class="query-panel">
						<label for="rule-source">読み取り専用Datalog</label>
						<textarea id="rule-source" rows="6" bind:value={ruleSource} spellcheck="false"></textarea>
						<div class="query-actions"><button onclick={executeRule}>実行</button><input placeholder="保存名" bind:value={ruleName} /><button onclick={saveRule}>保存</button></div>
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
