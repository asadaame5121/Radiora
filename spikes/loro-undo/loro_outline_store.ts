// Spike: Loro-backed outline store whose undo/redo is owned by Loro's UndoManager.
//
// Radiora mapping (see ./README.md for the full table):
//   - one outline (work's tree of items)      -> one LoroTree named "outline"
//   - outline item id (DB / RPC identity)     -> node metadata field "itemId"
//   - item title (editor text)                -> LoroText container in node metadata "title"
//   - one user action (insert / retitle / …)  -> one commit(origin, message)
//   - Ctrl+Z / Ctrl+Shift+Z                   -> UndoManager.undo() / redo()
//
// This file is a throwaway PoC: it deliberately keeps reads simple (`tree.toJSON()` on every
// read) so the undo semantics stay visible. A real integration should consume `LoroEventBatch`
// diffs instead.

import { LoroDoc, LoroText, UndoManager } from "loro-crdt";
import type { Frontiers, LoroEventBatch, LoroTree, LoroTreeNode } from "loro-crdt";

const TREE_NAME = "outline";
const FIELD_ITEM_ID = "itemId";
const FIELD_TITLE = "title";

/** Origin of commits that come from the local UI and therefore belong to the undo stack. */
export const OUTLINE_UI_ORIGIN = "ui:outline";

/**
 * Origin prefix of commits that are local but must never be undone by the user
 * (normalization, migration, autosave fixups).
 */
export const OUTLINE_SYSTEM_ORIGIN_PREFIX = "system:";

export type OutlineItemId = string;

export type OutlineItem = {
	readonly id: OutlineItemId;
	readonly parentId: OutlineItemId | null;
	readonly index: number;
	readonly title: string;
};

/** A committed change of the outline document, as observed by the UI. */
export type OutlineChange = {
	readonly by: LoroEventBatch["by"];
	readonly origin: string | undefined;
};

export type LoroOutlineStoreOptions = {
	/** Numeric peer id as a string. Every store that syncs with another needs its own. */
	readonly peerId: `${number}`;
	/**
	 * Undo steps created within this window are merged into one step.
	 * `0` disables merging, i.e. one commit is exactly one undo step.
	 */
	readonly mergeIntervalMs?: number;
	readonly maxUndoSteps?: number;
};

export type InsertItemInput = {
	readonly id: OutlineItemId;
	readonly parentId?: OutlineItemId | null;
	readonly index?: number;
	readonly title?: string;
};

type TreeNodeJson = {
	readonly id: string;
	readonly children: TreeNodeJson[];
	readonly meta: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (record: Record<string, unknown>, key: string, context: string): string => {
	const value = record[key];
	if (typeof value !== "string") {
		throw new Error(`${context}: expected string field "${key}"`);
	}
	return value;
};

/** Runtime validation of the WASM JSON boundary (no cast is used as a validation substitute). */
const parseForest = (value: unknown): TreeNodeJson[] => {
	if (!Array.isArray(value)) throw new Error("outline tree: expected an array of nodes");
	return value.map((node, index) => parseNode(node, `outline tree[${index}]`));
};

const parseNode = (value: unknown, context: string): TreeNodeJson => {
	if (!isRecord(value)) throw new Error(`${context}: expected an object`);
	const meta = value.meta;
	return {
		id: readString(value, "id", context),
		children: parseForest(value.children),
		meta: isRecord(meta) ? meta : {},
	};
};

/**
 * `onPush` may attach any JSON value to a step. The PoC stores a plain label string, but accepts
 * an object form too, so a real integration can carry e.g. a selection id alongside the label.
 */
const readLabel = (value: unknown): string | undefined => {
	if (typeof value === "string") return value.length > 0 ? value : undefined;
	if (!isRecord(value)) return undefined;
	const label = value.label;
	return typeof label === "string" && label.length > 0 ? label : undefined;
};

/**
 * In-memory outline document with Loro-native undo/redo.
 *
 * The store owns the document; UndoManager is bound to this store's peer id and cannot change
 * peer afterwards, so one store == one local writer == one undo history.
 */
export class LoroOutlineStore {
	readonly #doc: LoroDoc;
	readonly #tree: LoroTree;
	readonly #undo: UndoManager;
	readonly #listeners = new Set<(change: OutlineChange) => void>();

	#pendingLabel: string | undefined;
	#carriedLabel: string | undefined;
	#transactionLabel: string | undefined;
	#historyOp: "undo" | "redo" | undefined;

	constructor(options: LoroOutlineStoreOptions) {
		this.#doc = new LoroDoc();
		this.#doc.setPeerId(options.peerId);
		// Deterministic sibling ordering: the PoC drives index explicitly instead of jitter.
		this.#doc.setRecordTimestamp(false);
		this.#tree = this.#doc.getTree(TREE_NAME);
		this.#tree.enableFractionalIndex(0);
		this.#undo = new UndoManager(this.#doc, {
			mergeInterval: options.mergeIntervalMs ?? 0,
			maxUndoSteps: options.maxUndoSteps ?? 100,
			// Local commits marked with this prefix stay out of the undo stack.
			excludeOriginPrefixes: [OUTLINE_SYSTEM_ORIGIN_PREFIX],
			// `onPush`'s first argument names the stack being pushed: true = undo stack
			// (a new local step, or a redo), false = redo stack (the result of an undo).
			onPush: (isUndoStack) => ({
				value:
					isUndoStack && this.#historyOp === undefined
						? (this.#pendingLabel ?? "")
						: (this.#takeCarriedLabel() ?? ""),
				cursors: [],
			}),
			onPop: (_isUndoStack, value) => {
				// A popped step moves to the opposite stack; carry its label across.
				this.#carriedLabel = readLabel(value.value);
			},
		});
		this.#doc.subscribe((batch) => {
			// Loro reports "no origin" as an empty string; the store exposes it as undefined.
			this.#emit({ by: batch.by, origin: batch.origin === "" ? undefined : batch.origin });
		});
	}

	// ---------------------------------------------------------------- commands

	insertItem(input: InsertItemInput): void {
		const parentId = input.parentId ?? null;
		if (this.#findNode(input.id) !== undefined) {
			throw new Error(`outline item already exists: ${input.id}`);
		}
		const node =
			parentId === null
				? this.#tree.createNode(undefined, input.index)
				: this.#requireNode(parentId).createNode(input.index);
		node.data.set(FIELD_ITEM_ID, input.id);
		node.data.setContainer(FIELD_TITLE, new LoroText()).insert(0, input.title ?? "");
		this.#commit(`項目を追加: ${input.title ?? input.id}`, OUTLINE_UI_ORIGIN);
	}

	setTitle(id: OutlineItemId, title: string): void {
		const node = this.#requireNode(id);
		// `update` applies the minimal edit needed, so concurrent edits to the same title merge
		// character-wise instead of replacing the whole string.
		this.#titleText(node).update(title);
		this.#commit(`タイトル変更: ${id}`, OUTLINE_UI_ORIGIN);
	}

	moveItem(id: OutlineItemId, parentId: OutlineItemId | null, index?: number): void {
		const node = this.#requireNode(id);
		node.move(parentId === null ? undefined : this.#requireNode(parentId), index);
		this.#commit(`項目を移動: ${id}`, OUTLINE_UI_ORIGIN);
	}

	removeItem(id: OutlineItemId): void {
		this.#tree.delete(this.#requireNode(id).id);
		this.#commit(`項目を削除: ${id}`, OUTLINE_UI_ORIGIN);
	}

	/** Local, non-user change (e.g. migration / normalization). Excluded from the undo stack. */
	normalizeTitles(): number {
		let changed = 0;
		for (const node of this.#tree.nodes()) {
			if (node.isDeleted()) continue;
			const text = this.#titleText(node);
			const normalized = text.toString().replaceAll(/\s+/g, " ").trim();
			if (normalized !== text.toString()) {
				text.update(normalized);
				changed += 1;
			}
		}
		if (changed > 0) {
			this.#commit(`タイトル正規化: ${changed}件`, `${OUTLINE_SYSTEM_ORIGIN_PREFIX}normalize`);
		}
		return changed;
	}

	/**
	 * Run several commands as exactly one undo step ("split item", "paste subtree", …).
	 * Uses Loro's undo grouping instead of a hand-rolled command stack.
	 */
	transaction(label: string, run: () => void): void {
		const previousLabel = this.#transactionLabel;
		this.#transactionLabel = label;
		this.#undo.groupStart();
		try {
			run();
		} finally {
			this.#undo.groupEnd();
			this.#transactionLabel = previousLabel;
		}
	}

	// ----------------------------------------------------------------- history

	/**
	 * Undo the last local step.
	 *
	 * `undo()` runs its own transaction and emits a change batch with origin `"undo"`, so the UI
	 * re-renders through the normal subscription. Remote changes are never undone.
	 */
	undo(): boolean {
		return this.#runHistoryOp("undo");
	}

	redo(): boolean {
		return this.#runHistoryOp("redo");
	}

	canUndo(): boolean {
		return this.#undo.canUndo();
	}

	canRedo(): boolean {
		return this.#undo.canRedo();
	}

	/** Label of the action that `undo()` would revert, e.g. `項目を移動: item-3`. */
	undoLabel(): string | undefined {
		return readLabel(this.#undo.topUndoValue());
	}

	/** Label of the action that `redo()` would re-apply. */
	redoLabel(): string | undefined {
		return readLabel(this.#undo.topRedoValue());
	}

	clearHistory(): void {
		this.#undo.clear();
	}

	// ------------------------------------------------------------------ reads

	/** Flat projection of the outline, ordered depth-first (`index` is the sibling position). */
	items(): OutlineItem[] {
		const items: OutlineItem[] = [];
		const walk = (nodes: TreeNodeJson[], parentId: OutlineItemId | null): void => {
			for (const [index, node] of nodes.entries()) {
				const id = readString(node.meta, FIELD_ITEM_ID, `outline node ${node.id}`);
				items.push({
					id,
					parentId,
					index,
					title: readString(node.meta, FIELD_TITLE, `outline node ${node.id}`),
				});
				walk(node.children, id);
			}
		};
		walk(parseForest(this.#tree.toJSON()), null);
		return items;
	}

	itemIds(): OutlineItemId[] {
		return this.items().map((item) => item.id);
	}

	titleOf(id: OutlineItemId): string | undefined {
		return this.items().find((item) => item.id === id)?.title;
	}

	/**
	 * Diagnostic view of the current Loro TreeIDs behind each app item id.
	 *
	 * The PoC uses it to show that TreeIDs are *not* stable across undo (see README findings);
	 * app code must never persist them.
	 */
	treeIds(): Array<{ id: OutlineItemId; treeId: string }> {
		return this.#tree
			.nodes()
			.filter((node) => !node.isDeleted())
			.map((node) => ({
				id: String(node.data.get(FIELD_ITEM_ID)),
				treeId: String(node.id),
			}));
	}

	/** Latest version of the document, usable as a `previewAt` argument. */
	frontiers(): Frontiers {
		return this.#doc.frontiers();
	}

	subscribe(listener: (change: OutlineChange) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	// ------------------------------------------------- persistence and syncing

	exportSnapshot(): Uint8Array {
		return this.#doc.export({ mode: "snapshot" });
	}

	exportUpdate(): Uint8Array {
		return this.#doc.export({ mode: "update" });
	}

	applyUpdate(bytes: Uint8Array): void {
		this.#doc.import(bytes);
	}

	/**
	 * Read-only history preview (revision comparison pane): pause the UndoManager, check out the
	 * given version, read it, then restore the latest version and resume.
	 *
	 * Undo/redo stacks survive because of `pause()`; a bare `checkout()` would clear them.
	 */
	previewAt<T>(frontiers: Frontiers, read: (store: LoroOutlineStore) => T): T {
		const latest = this.#doc.frontiers();
		this.#undo.pause();
		try {
			this.#doc.checkout(frontiers);
			return read(this);
		} finally {
			this.#doc.checkout(latest);
			this.#undo.resume();
		}
	}

	// --------------------------------------------------------------- internals

	#commit(label: string, origin: string): void {
		this.#pendingLabel = this.#transactionLabel ?? label;
		this.#doc.commit({ origin, message: this.#pendingLabel });
	}

	#runHistoryOp(op: "undo" | "redo"): boolean {
		this.#historyOp = op;
		try {
			return op === "undo" ? this.#undo.undo() : this.#undo.redo();
		} finally {
			this.#historyOp = undefined;
		}
	}

	#emit(change: OutlineChange): void {
		for (const listener of [...this.#listeners]) listener(change);
	}

	#takeCarriedLabel(): string | undefined {
		const label = this.#carriedLabel;
		this.#carriedLabel = undefined;
		return label;
	}

	#titleText(node: LoroTreeNode): LoroText {
		const existing = node.data.get(FIELD_TITLE);
		if (existing instanceof LoroText) return existing;
		return node.data.setContainer(FIELD_TITLE, new LoroText());
	}

	#requireNode(id: OutlineItemId): LoroTreeNode {
		const node = this.#findNode(id);
		if (node === undefined) throw new Error(`outline item not found: ${id}`);
		return node;
	}

	/**
	 * Resolve the live node for an app-level item id.
	 *
	 * Nodes are matched by the metadata `itemId`, never by `LoroTreeNode.id`: undoing a delete
	 * re-creates the subtree under a *new* TreeID, and the old node remains as a deleted
	 * tombstone (`tree.nodes()` returns tombstones as well, and handles to them stay usable).
	 */
	#findNode(id: OutlineItemId): LoroTreeNode | undefined {
		for (const node of this.#tree.nodes()) {
			if (node.isDeleted()) continue;
			if (node.data.get(FIELD_ITEM_ID) === id) return node;
		}
		return undefined;
	}
}
