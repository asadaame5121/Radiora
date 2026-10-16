// Behavioral tests for the Loro undo PoC. Run with `npm test` (node --test).
//
// Every expectation here was measured against loro-crdt 1.16.4; the surprising ones are marked
// "measured" so the README can cite them.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LoroDoc, UndoManager } from "loro-crdt";
import { LoroOutlineStore, OUTLINE_UI_ORIGIN, type OutlineChange } from "./loro_outline_store.ts";

/** Flat, order-preserving view: `parent > id@index: title`. */
const tree = (store: LoroOutlineStore): string[] =>
	store.items().map((item) => `${item.parentId ?? "root"} > ${item.id}@${item.index}: ${item.title}`);

const sync = (from: LoroOutlineStore, to: LoroOutlineStore): void => {
	to.applyUpdate(from.exportUpdate());
};

const exchange = (a: LoroOutlineStore, b: LoroOutlineStore): void => {
	sync(a, b);
	sync(b, a);
};

const drainUndo = (store: LoroOutlineStore): number => {
	let steps = 0;
	while (store.undo()) steps += 1;
	return steps;
};

/** work-1 with three children, one of them nested one level deeper. */
const createOutline = (
	options: { peerId?: `${number}`; mergeIntervalMs?: number } = {},
): LoroOutlineStore => {
	const store = new LoroOutlineStore({ peerId: options.peerId ?? "1", mergeIntervalMs: options.mergeIntervalMs });
	store.insertItem({ id: "work-1", title: "作品" });
	store.insertItem({ id: "item-1", parentId: "work-1", title: "第一章" });
	store.insertItem({ id: "item-2", parentId: "work-1", title: "第二章" });
	store.insertItem({ id: "item-3", parentId: "item-1", title: "少年の孤独" });
	return store;
};

test("undo and redo return false while the stacks are empty", () => {
	const store = new LoroOutlineStore({ peerId: "1" });
	assert.equal(store.canUndo(), false);
	assert.equal(store.canRedo(), false);
	assert.equal(store.undo(), false);
	assert.equal(store.redo(), false);
	assert.equal(store.undoLabel(), undefined);
	assert.deepEqual(store.items(), []);
});

test("an insert is reverted by undo and re-applied by redo, with the same app item id", () => {
	const store = new LoroOutlineStore({ peerId: "1" });
	store.insertItem({ id: "work-1", title: "作品" });
	store.insertItem({ id: "item-1", parentId: "work-1", title: "第一章" });

	assert.deepEqual(tree(store), ["root > work-1@0: 作品", "work-1 > item-1@0: 第一章"]);
	assert.equal(store.undoLabel(), "項目を追加: 第一章");

	assert.equal(store.undo(), true);
	assert.deepEqual(tree(store), ["root > work-1@0: 作品"]);
	assert.equal(store.canRedo(), true);
	assert.equal(store.redoLabel(), "項目を追加: 第一章");

	assert.equal(store.redo(), true);
	assert.deepEqual(tree(store), ["root > work-1@0: 作品", "work-1 > item-1@0: 第一章"]);
	assert.equal(store.canRedo(), false);
});

test("a title edit is undone and redone as text content", () => {
	const store = createOutline();
	store.setTitle("item-2", "第二章 改稿");
	assert.equal(store.titleOf("item-2"), "第二章 改稿");

	assert.equal(store.undo(), true);
	assert.equal(store.titleOf("item-2"), "第二章");
	assert.equal(store.undoLabel(), "項目を追加: 少年の孤独");

	assert.equal(store.redo(), true);
	assert.equal(store.titleOf("item-2"), "第二章 改稿");
});

test("a move is undone back to the original parent and sibling index", () => {
	const store = createOutline();
	const before = tree(store);

	store.moveItem("item-3", "item-2", 0);
	assert.deepEqual(tree(store), [
		"root > work-1@0: 作品",
		"work-1 > item-1@0: 第一章",
		"work-1 > item-2@1: 第二章",
		"item-2 > item-3@0: 少年の孤独",
	]);

	assert.equal(store.undo(), true);
	assert.deepEqual(tree(store), before);
});

test("undoing a delete restores the whole subtree, measured: under a new TreeID", () => {
	const store = createOutline();
	const treeIdBefore = store.treeIds().find((node) => node.id === "item-1")?.treeId;
	assert.ok(treeIdBefore);

	store.removeItem("item-1");
	assert.deepEqual(store.itemIds(), ["work-1", "item-2"]);

	assert.equal(store.undo(), true);
	assert.deepEqual(tree(store), [
		"root > work-1@0: 作品",
		"work-1 > item-1@0: 第一章",
		"item-1 > item-3@0: 少年の孤独",
		"work-1 > item-2@1: 第二章",
	]);
	assert.equal(store.titleOf("item-3"), "少年の孤独");
	assert.notEqual(
		store.treeIds().find((node) => node.id === "item-1")?.treeId,
		treeIdBefore,
		"the restored node is a new node, so a persisted TreeID would dangle",
	);
});

test("transaction() merges several commands into a single undo step", () => {
	const store = new LoroOutlineStore({ peerId: "1" });
	store.insertItem({ id: "work-1", title: "作品" });
	store.insertItem({ id: "item-1", parentId: "work-1", title: "案A" });

	store.transaction("項目を分割", () => {
		store.insertItem({ id: "item-2", parentId: "work-1", title: "案B" });
		store.setTitle("item-1", "案A (分割元)");
		store.moveItem("item-2", "item-1", 0);
	});
	assert.equal(store.undoLabel(), "項目を分割");

	assert.equal(store.undo(), true);
	assert.deepEqual(tree(store), ["root > work-1@0: 作品", "work-1 > item-1@0: 案A"]);
	assert.equal(store.undo(), true);
	assert.deepEqual(tree(store), ["root > work-1@0: 作品"]);
	assert.equal(store.undo(), true);
	assert.equal(store.undo(), false);
});

test("mergeInterval merges rapid commits, 0 keeps one step per command", () => {
	const type = (interval: number): number => {
		const store = new LoroOutlineStore({ peerId: "1", mergeIntervalMs: interval });
		store.insertItem({ id: "work-1", title: "" });
		for (const title of ["あ", "あい", "あいう"]) store.setTitle("work-1", title);
		return drainUndo(store);
	};

	assert.equal(type(1000), 1);
	assert.equal(type(0), 4);
});

test("a new local edit discards the redo stack", () => {
	const store = createOutline();
	store.setTitle("item-2", "第二章 改稿");
	store.undo();
	assert.equal(store.canRedo(), true);

	store.insertItem({ id: "item-4", parentId: "work-1", title: "第三章" });
	assert.equal(store.canRedo(), false);
	assert.equal(store.titleOf("item-2"), "第二章");
});

test("commits from an excluded origin are applied but never undone", () => {
	const store = new LoroOutlineStore({ peerId: "1" });
	store.insertItem({ id: "work-1", title: "  余分な   空白  " });
	store.normalizeTitles();
	assert.equal(store.titleOf("work-1"), "余分な 空白");
	assert.equal(store.undoLabel(), "項目を追加:   余分な   空白  ");

	assert.equal(store.undo(), true);
	assert.deepEqual(store.items(), []);
});

test("maxUndoSteps bounds how far back undo can go", () => {
	const store = new LoroOutlineStore({ peerId: "1", maxUndoSteps: 2 });
	store.insertItem({ id: "work-1", title: "作品" });
	store.insertItem({ id: "item-1", parentId: "work-1", title: "第一章" });
	store.insertItem({ id: "item-2", parentId: "work-1", title: "第二章" });

	assert.equal(drainUndo(store), 2);
	assert.deepEqual(store.itemIds(), ["work-1"]);
});

test("undo is local: it never reverts another peer's change, and both converge", () => {
	const a = new LoroOutlineStore({ peerId: "10" });
	const b = new LoroOutlineStore({ peerId: "20" });
	a.insertItem({ id: "work-1", title: "共同編集" });
	exchange(a, b);

	a.insertItem({ id: "item-a", parentId: "work-1", title: "Aの追記" });
	sync(a, b);
	b.insertItem({ id: "item-b", parentId: "work-1", title: "Bの追記" });
	sync(b, a);

	assert.equal(a.undoLabel(), "項目を追加: Aの追記");
	assert.equal(a.undo(), true);
	assert.deepEqual(a.itemIds(), ["work-1", "item-b"]);

	exchange(a, b);
	assert.deepEqual(b.itemIds(), ["work-1", "item-b"]);
	assert.deepEqual(a.items(), b.items());
});

test("undoing a retitle keeps a concurrently inserted remote text and converges", () => {
	const a = new LoroOutlineStore({ peerId: "10" });
	const b = new LoroOutlineStore({ peerId: "20" });
	a.insertItem({ id: "work-1", title: "abc" });
	exchange(a, b);

	a.setTitle("work-1", "Xabc");
	b.setTitle("work-1", "abc!");
	exchange(a, b);
	const merged = a.titleOf("work-1");

	assert.equal(a.undo(), true);
	assert.equal(a.titleOf("work-1"), "abc!");
	exchange(a, b);
	assert.equal(b.titleOf("work-1"), "abc!");
	assert.deepEqual(a.items(), b.items());
	assert.equal(merged, "Xabc!");
});

test("measured: undoing a delete restores the pre-delete text, not a concurrent remote edit", () => {
	const a = new LoroOutlineStore({ peerId: "10" });
	const b = new LoroOutlineStore({ peerId: "20" });
	a.insertItem({ id: "work-1", title: "w" });
	a.insertItem({ id: "x", parentId: "work-1", title: "abc" });
	exchange(a, b);

	a.removeItem("x");
	b.setTitle("x", "xyz");
	exchange(a, b);
	assert.deepEqual(a.itemIds(), ["work-1"]);

	assert.equal(a.undo(), true);
	assert.equal(a.titleOf("x"), "abc");
	exchange(a, b);
	assert.equal(b.titleOf("x"), "abc");
	assert.deepEqual(a.items(), b.items());
});

test("previewAt() reads an old version without touching undo history", () => {
	const store = createOutline();
	const firstVersion = store.frontiers();
	store.setTitle("item-2", "第二章 改稿");
	store.removeItem("item-3");

	const preview = store.previewAt(firstVersion, (previewed) => ({
		titles: previewed.items().map((item) => item.title),
		frontiers: previewed.frontiers(),
	}));

	assert.deepEqual(preview.titles, ["作品", "第一章", "少年の孤独", "第二章"]);
	assert.deepEqual(store.items().map((item) => item.title), ["作品", "第一章", "第二章 改稿"]);
	assert.equal(store.canUndo(), true);
	assert.equal(store.undoLabel(), "項目を削除: item-3");
});

test("measured: a bare checkout() clears both stacks, which is why previewAt pauses first", () => {
	const doc = new LoroDoc();
	doc.setPeerId("1");
	doc.setRecordTimestamp(false);
	const text = doc.getText("t");
	const undo = new UndoManager(doc, { mergeInterval: 0 });

	text.insert(0, "a");
	doc.commit({ origin: OUTLINE_UI_ORIGIN });
	const firstVersion = doc.frontiers();
	text.insert(1, "b");
	doc.commit({ origin: OUTLINE_UI_ORIGIN });
	assert.equal(undo.canUndo(), true);

	doc.checkout(firstVersion);
	assert.equal(undo.canUndo(), false);
	assert.equal(undo.canRedo(), false);
});

test("a restored snapshot carries the outline but no undo history", () => {
	const source = createOutline();
	const snapshot = source.exportSnapshot();

	const restored = new LoroOutlineStore({ peerId: "2" });
	restored.applyUpdate(snapshot);

	assert.deepEqual(restored.items(), source.items());
	assert.equal(restored.canUndo(), false);
	assert.equal(restored.canRedo(), false);
});

test("subscribers see local, import and undo changes with their origin", () => {
	const store = new LoroOutlineStore({ peerId: "1" });
	const remote = new LoroOutlineStore({ peerId: "2" });
	const changes: OutlineChange[] = [];
	const unsubscribe = store.subscribe((change) => changes.push(change));

	store.insertItem({ id: "work-1", title: "作品" });
	remote.insertItem({ id: "work-1", title: "作品" });
	remote.setTitle("work-1", "遠隔の変更");
	store.applyUpdate(remote.exportUpdate());
	store.undo();

	assert.deepEqual(
		changes.map((change) => `${change.by}/${change.origin ?? "none"}`),
		["local/ui:outline", "import/none", "local/undo"],
	);

	unsubscribe();
	store.insertItem({ id: "item-1", parentId: "work-1", title: "第一章" });
	assert.equal(changes.length, 3);
});
