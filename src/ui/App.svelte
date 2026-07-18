<script lang="ts">
	import { onMount } from "svelte";
	import type {
		LinkType,
		OutlineItem,
		OutlineLink,
		OutlineSnapshot,
		SearchResult,
	} from "../domain/models";
	import { LINK_TYPES } from "../domain/models";
	import type { RadioraBindings, StartupStatus } from "../shared/bindings";

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

	let snapshot = $state<OutlineSnapshot>({ items: [], links: [], knots: [], stashItemIds: [] });
	let loading = $state(true);
	let startup = $state<StartupStatus>({ phase: "starting", message: "Radioraを起動しています…" });
	let error = $state("");
	let selectedId = $state<string | null>(null);
	let searchQuery = $state("");
	let searchResults = $state<SearchResult[]>([]);
	let newLinkTarget = $state("");
	let newLinkType = $state<LinkType>("LIKE");
	let draggedId = $state<string | null>(null);
	const saveTimers = new Map<string, number>();

	const itemById = $derived(new Map(snapshot.items.map((item) => [item.id, item])));
	const selectedItem = $derived(selectedId ? itemById.get(selectedId) ?? null : null);
	const selectedLinks = $derived(selectedId
		? snapshot.links.filter((link) => link.fromId === selectedId || link.toId === selectedId)
		: []);
	const visibleRows = $derived.by(() => buildVisibleRows(snapshot));

	onMount(() => {
		let cancelled = false;
		async function monitorStartup(): Promise<void> {
			while (!cancelled) {
				try {
					startup = await api.getStartupStatus();
					if (startup.phase === "ready") {
						await load();
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
			const descendants = children.get(item.id) ?? [];
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

	let searchTimer: number | undefined;
	function queueSearch(): void {
		clearTimeout(searchTimer);
		searchTimer = window.setTimeout(async () => {
			searchResults = await api.searchItems(searchQuery);
		}, 180);
	}

	async function selectSearch(result: SearchResult): Promise<void> {
		for (const ancestorId of result.ancestorIds) {
			const ancestor = itemById.get(ancestorId);
			if (ancestor?.collapsed) await api.setCollapsed(ancestor.id, false);
		}
		searchQuery = "";
		searchResults = [];
		selectedId = result.item.id;
		await load(result.item.id);
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
		const id = link.fromId === selectedId ? link.toId : link.fromId;
		return itemById.get(id)?.text || "(空の項目)";
	}

	function errorMessage(cause: unknown): string {
		if (typeof cause === "object" && cause && "message" in cause) return String(cause.message);
		return String(cause);
	}
</script>

<svelte:head><title>Radiora v2 PoC</title></svelte:head>

<div class="shell">
	<header>
		<div><strong>Radiora</strong><span>v2 technology PoC</span></div>
		<div class="search-wrap" class:disabled={startup.phase !== "ready"}>
			<input aria-label="アウトラインを検索" placeholder="本文を検索…" bind:value={searchQuery} oninput={queueSearch} />
			{#if searchResults.length}
				<div class="search-results">
					{#each searchResults as result}
						<button onclick={() => selectSearch(result)}>{result.item.text || "(空の項目)"}</button>
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
		<section class="outline-panel">
			<div class="section-title"><span>Outline</span><button onclick={createRoot}>＋ Root</button></div>
			{#if loading}
				<p class="empty">Loading…</p>
			{:else if snapshot.items.length === 0}
				<button class="first-item" onclick={createRoot}>最初の項目を作る</button>
			{:else}
				<div class="rows">
					{#each visibleRows.filter((row) => !row.stash) as row (row.item.id)}
						<div class:selected={selectedId === row.item.id} class="row" style={`--depth:${row.depth}`} role="treeitem"
							aria-selected={selectedId === row.item.id} tabindex="-1"
							draggable="true" ondragstart={() => draggedId = row.item.id}
							ondragover={(event) => event.preventDefault()} ondrop={() => dropOn(row.item)}>
							<button class="disclosure" class:hidden={!row.hasChildren} onclick={() => toggle(row)}>{row.item.collapsed ? "›" : "⌄"}</button>
							<button class="bullet" aria-label="項目を選択" onclick={() => selectedId = row.item.id}>•</button>
							<textarea rows="1" data-item-id={row.item.id} value={row.item.text}
								onfocus={() => selectedId = row.item.id}
								oninput={(event) => updateLocalText(row.item.id, event.currentTarget.value)}
								onkeydown={(event) => handleKeydown(event, row)}></textarea>
							<button class="delete" title="項目を削除" onclick={() => remove(row.item.id)}>×</button>
						</div>
					{/each}
				</div>
			{/if}

			{#if snapshot.stashItemIds.length}
				<div class="section-title stash-title"><span>Stash / Knots</span><small>{snapshot.knots.length} knot</small></div>
				<div class="stash-list">
					{#each visibleRows.filter((row) => row.stash) as row (row.item.id)}
						<button class:selected={selectedId === row.item.id} onclick={() => selectedId = row.item.id}>
							<span>∞</span>{row.item.text || "(空の項目)"}
						</button>
					{/each}
				</div>
			{/if}
		</section>

		<aside>
			{#if selectedItem}
				<p class="eyebrow">SELECTED ITEM</p>
				<h2>{selectedItem.text || "(空の項目)"}</h2>
				<p class="hint">Enter: 兄弟　Shift+Enter: 改行<br />Tab / Shift+Tab: 階層　Alt+↑↓: 移動</p>
				<div class="link-form">
					<select bind:value={newLinkType}>{#each LINK_TYPES as type}<option value={type}>{type}</option>{/each}</select>
					<select bind:value={newLinkTarget}>
						<option value="">リンク先を選択</option>
						{#each snapshot.items.filter((item) => item.id !== selectedId) as item}
							<option value={item.id}>{item.text || "(空の項目)"}</option>
						{/each}
					</select>
					<button onclick={addLink} disabled={!newLinkTarget}>Link</button>
				</div>
				<div class="links">
					{#each selectedLinks as link}
						<div><span class={`tag ${link.type.toLowerCase()}`}>{link.type}</span><span>{link.fromId === selectedId ? "→" : "←"} {otherName(link)}</span><button onclick={() => removeLink(link)}>×</button></div>
					{:else}<p class="empty">任意リンクはありません</p>{/each}
				</div>
			{:else}
				<div class="aside-empty"><span>•</span><p>項目を選択すると<br />関連リンクを編集できます</p></div>
			{/if}
		</aside>
	</main>
	{/if}
</div>
