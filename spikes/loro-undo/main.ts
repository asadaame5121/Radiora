// Browser demo for the Loro undo PoC (`npm run demo:web`, requires `npm i -D vite`).
//
// Status: the store logic below is the same code covered by loro_undo_test.ts, but this page was
// NOT executed in a browser while the PoC was written (the sandbox blocks Vite). See README §7.1.
//
// Plain DOM on purpose: the PoC is about the store's undo semantics, not about the view layer.
// A Svelte integration would keep `LoroOutlineStore` behind a controller and render from
// `items()` / `subscribe()` exactly like these render functions do.

import { LoroOutlineStore, type OutlineChange, type OutlineItem } from "./loro_outline_store.ts";

const local = new LoroOutlineStore({ peerId: "1", mergeIntervalMs: 0 });
const remote = new LoroOutlineStore({ peerId: "2", mergeIntervalMs: 0 });

const element = <T extends HTMLElement>(id: string): T => {
	const found = document.getElementById(id);
	if (found === null) throw new Error(`missing element #${id}`);
	return found as T;
};

const selection = element<HTMLSelectElement>("selection");
const status = element<HTMLParagraphElement>("status");
const remoteStatus = element<HTMLParagraphElement>("remote-status");
const lastChange = { value: "(no change yet)" as string };

let counter = 0;
const nextId = (prefix: string): string => {
	counter += 1;
	return `${prefix}-${counter}`;
};

const depthOf = (item: OutlineItem, items: readonly OutlineItem[]): number => {
	let depth = 0;
	let cursor = item.parentId;
	while (cursor !== null) {
		const parent = items.find((candidate) => candidate.id === cursor);
		if (parent === undefined) break;
		depth += 1;
		cursor = parent.parentId;
	}
	return depth;
};

const renderTree = (list: HTMLUListElement, store: LoroOutlineStore, selectable: boolean): void => {
	const items = store.items();
	list.replaceChildren(
		...items.map((item) => {
			const li = document.createElement("li");
			li.style.paddingLeft = `${depthOf(item, items) * 16}px`;
			li.textContent = `${item.title || "(無題)"}  [${item.id}]`;
			if (selectable && item.id === selectedId()) li.dataset.selected = "true";
			return li;
		}),
	);
};

const selectedId = (): string => selection.value;

const renderSelection = (): void => {
	const items = local.items();
	const previous = selection.value;
	selection.replaceChildren(
		...items.map((item) => {
			const option = document.createElement("option");
			option.value = item.id;
			option.textContent = item.title || item.id;
			return option;
		}),
	);
	if (items.some((item) => item.id === previous)) selection.value = previous;
};

const render = (): void => {
	renderSelection();
	renderTree(element<HTMLUListElement>("tree"), local, true);
	renderTree(element<HTMLUListElement>("remote-tree"), remote, false);
	element<HTMLButtonElement>("undo").disabled = !local.canUndo();
	element<HTMLButtonElement>("redo").disabled = !local.canRedo();
	status.textContent = [
		`undo: ${local.undoLabel() ?? "-"}`,
		`redo: ${local.redoLabel() ?? "-"}`,
		`last change: ${lastChange.value}`,
	].join("\n");
	remoteStatus.textContent = `items: ${remote.itemIds().join(", ") || "(empty)"}`;
};

local.subscribe((change: OutlineChange) => {
	lastChange.value = `${change.by} / ${change.origin ?? "no origin"}`;
	render();
});
remote.subscribe(() => render());

const withSelection = (run: (id: string) => void): void => {
	const id = selectedId();
	if (id === "") return;
	run(id);
};

const on = (id: string, handler: () => void): void => {
	element<HTMLButtonElement>(id).addEventListener("click", handler);
};

on("add-root", () => {
	local.insertItem({ id: nextId("work"), title: `作品${counter}` });
});
on("add-child", () =>
	withSelection((id) => {
		local.insertItem({ id: nextId("item"), parentId: id, title: `子項目${counter}` });
	}),
);
on("retitle", () =>
	withSelection((id) => {
		local.setTitle(id, `${local.titleOf(id) ?? ""}✎`);
	}),
);
on("move-root", () => withSelection((id) => local.moveItem(id, null, 0)));
on("delete", () => withSelection((id) => local.removeItem(id)));
on("undo", () => local.undo());
on("redo", () => local.redo());
on("normalize", () => local.normalizeTitles());

on("remote-add", () => {
	remote.insertItem({ id: nextId("remote"), title: `リモート${counter}` });
});
on("remote-retitle", () =>
	withSelection((id) => {
		if (remote.titleOf(id) === undefined) return;
		remote.setTitle(id, `${remote.titleOf(id) ?? ""}!`);
	}),
);
on("remote-delete", () =>
	withSelection((id) => {
		if (remote.titleOf(id) === undefined) return;
		remote.removeItem(id);
	}),
);
on("push", () => remote.applyUpdate(local.exportUpdate()));
on("pull", () => local.applyUpdate(remote.exportUpdate()));

selection.addEventListener("change", () => render());

local.insertItem({ id: "work-1", title: "銀河鉄道の夜" });
local.insertItem({ id: "item-1", parentId: "work-1", title: "第一章" });
local.insertItem({ id: "item-2", parentId: "work-1", title: "第二章" });
remote.applyUpdate(local.exportUpdate());
render();
