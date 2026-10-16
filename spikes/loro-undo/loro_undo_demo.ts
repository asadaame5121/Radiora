// Runnable transcript for the Loro undo PoC. `npm run demo`
//
// Prints what the store does, so the undo semantics can be read without a UI.

import { LoroOutlineStore, type OutlineItem } from "./loro_outline_store.ts";

const render = (items: readonly OutlineItem[]): string => {
	const depthOf = (item: OutlineItem): number => {
		let depth = 0;
		let cursor = item.parentId;
		while (cursor !== null) {
			const parent: OutlineItem | undefined = items.find((candidate) => candidate.id === cursor);
			if (parent === undefined) break;
			depth += 1;
			cursor = parent.parentId;
		}
		return depth;
	};
	if (items.length === 0) return "  (empty)";
	return items.map((item) => `${"  ".repeat(depthOf(item))}- [${item.id}] ${item.title}`).join("\n");
};

const section = (title: string): void => {
	console.log(`\n=== ${title} ===`);
};

const sync = (from: LoroOutlineStore, to: LoroOutlineStore): void => {
	to.applyUpdate(from.exportUpdate());
};

const drainUndo = (store: LoroOutlineStore): number => {
	let steps = 0;
	while (store.undo()) steps += 1;
	return steps;
};

section("1. アウトラインを組み立てる (1操作 = 1 commit = 1 undo ステップ)");
const a = new LoroOutlineStore({ peerId: "1" });
a.insertItem({ id: "work-1", title: "銀河鉄道の夜" });
a.insertItem({ id: "item-1", parentId: "work-1", title: "第一章" });
a.insertItem({ id: "item-2", parentId: "work-1", title: "第二章" });
a.insertItem({ id: "item-3", parentId: "item-1", title: "少年の孤独" });
console.log(render(a.items()));
console.log(`canUndo=${a.canUndo()} / next undo -> ${a.undoLabel() ?? "(none)"}`);

section("2. タイトル編集・移動・削除を undo / redo");
a.setTitle("item-2", "第二章 改稿");
a.moveItem("item-3", "item-2", 0);
a.removeItem("item-1");
console.log(render(a.items()));
console.log(`next undo -> ${a.undoLabel() ?? "(none)"}`);
a.undo();
console.log(`\nundo 1回 (削除の取り消し):\n${render(a.items())}`);
a.undo();
console.log(`\nundo 2回 (移動の取り消し):\n${render(a.items())}`);
a.undo();
console.log(`\nundo 3回 (タイトル変更の取り消し):\n${render(a.items())}`);
console.log(`next redo -> ${a.redoLabel() ?? "(none)"}`);
a.redo();
a.redo();
console.log(`\nredo 2回:\n${render(a.items())}`);

section("3. 複数操作を1ステップにまとめる (transaction)");
const grouped = new LoroOutlineStore({ peerId: "2" });
grouped.insertItem({ id: "work-1", title: "作品" });
grouped.insertItem({ id: "item-1", parentId: "work-1", title: "案A" });
grouped.transaction("項目を分割", () => {
	grouped.insertItem({ id: "item-2", parentId: "work-1", title: "案B" });
	grouped.setTitle("item-1", "案A (分割元)");
	grouped.moveItem("item-2", "item-1", 0);
});
console.log(render(grouped.items()));
console.log(`next undo -> ${grouped.undoLabel() ?? "(none)"}`);
grouped.undo();
console.log(`\nundo 1回 (3操作がまとめて戻る):\n${render(grouped.items())}`);
console.log(`残りの undo ステップ数=${drainUndo(grouped)}`);

section("4. システム由来のローカル変更は undo 対象外 (excludeOriginPrefixes)");
const system = new LoroOutlineStore({ peerId: "3" });
system.insertItem({ id: "work-1", title: "  余分な   空白  " });
system.normalizeTitles();
console.log(render(system.items()));
console.log(`next undo -> ${system.undoLabel() ?? "(none)"} (正規化ではなく項目追加が戻る)`);
system.undo();
console.log(render(system.items()));

section("5. undo は局所的: 他ピアの変更を巻き戻さない");
const peerA = new LoroOutlineStore({ peerId: "10" });
const peerB = new LoroOutlineStore({ peerId: "20" });
peerA.insertItem({ id: "work-1", title: "共同編集" });
sync(peerA, peerB);
peerA.insertItem({ id: "item-a", parentId: "work-1", title: "Aの追記" });
sync(peerA, peerB);
peerB.insertItem({ id: "item-b", parentId: "work-1", title: "Bの追記" });
sync(peerB, peerA);
console.log(`同期後 (A):\n${render(peerA.items())}`);
console.log(`A の next undo -> ${peerA.undoLabel() ?? "(none)"}`);
peerA.undo();
console.log(`\nA が undo した後 (A):\n${render(peerA.items())}`);
sync(peerA, peerB);
console.log(`\n収束後 (B):\n${render(peerB.items())}`);
console.log(`両者の一致: ${JSON.stringify(peerA.items()) === JSON.stringify(peerB.items())}`);

section("6. 削除の undo は「復元」ではなく「再作成」: TreeID が変わる");
const identity = new LoroOutlineStore({ peerId: "30" });
identity.insertItem({ id: "work-1", title: "同定" });
identity.insertItem({ id: "x", parentId: "work-1", title: "abc" });
const before = identity.treeIds();
console.log(`削除前: ${JSON.stringify(before)}`);
identity.removeItem("x");
identity.undo();
console.log(`undo 後: ${JSON.stringify(identity.treeIds())}`);
console.log(render(identity.items()));
console.log(`itemId=x の TreeID は ${before[1]?.treeId} -> ${identity.treeIds()[1]?.treeId} (アプリ側の id は不変)`);

section("7. 削除 undo と他ピアの並行編集は併合されない");
const concurrentA = new LoroOutlineStore({ peerId: "10" });
const concurrentB = new LoroOutlineStore({ peerId: "20" });
concurrentA.insertItem({ id: "work-1", title: "w" });
concurrentA.insertItem({ id: "x", parentId: "work-1", title: "abc" });
sync(concurrentA, concurrentB);
sync(concurrentB, concurrentA);
concurrentA.removeItem("x");
concurrentB.setTitle("x", "xyz");
sync(concurrentA, concurrentB);
sync(concurrentB, concurrentA);
console.log(`並行編集を交換した時点で x は削除済み: ${render(concurrentA.items())}`);
concurrentA.undo();
console.log(`A が削除を undo: ${JSON.stringify(concurrentA.items()[1])}`);
sync(concurrentA, concurrentB);
sync(concurrentB, concurrentA);
console.log(`B が見る x: ${JSON.stringify(concurrentB.items()[1])} (B の "xyz" は破棄される)`);
console.log(`両者の一致: ${JSON.stringify(concurrentA.items()) === JSON.stringify(concurrentB.items())}`);

section("8. 履歴プレビュー (checkout) と undo スタック");
const preview = new LoroOutlineStore({ peerId: "40" });
preview.insertItem({ id: "work-1", title: "初稿" });
const firstVersion = preview.frontiers();
preview.setTitle("work-1", "第二稿");
const previewed = preview.previewAt(firstVersion, (store) => store.titleOf("work-1"));
console.log(`プレビュー中のタイトル: ${previewed}`);
console.log(`プレビュー後のタイトル: ${preview.titleOf("work-1")}`);
console.log(`プレビュー後も canUndo=${preview.canUndo()}, next undo -> ${preview.undoLabel() ?? "(none)"}`);

section("9. mergeInterval による 1ステップへのまとまり方");
const measure = (mergeIntervalMs: number): number => {
	const store = new LoroOutlineStore({ peerId: "50", mergeIntervalMs });
	store.insertItem({ id: "work-1", title: "" });
	for (const text of ["あ", "あい", "あいう", "あいうえ"]) store.setTitle("work-1", text);
	return drainUndo(store);
};
console.log(`mergeInterval=1000ms: 連続する4回の編集が ${measure(1000)} ステップに統合`);
console.log(`mergeInterval=0ms   : 連続する4回の編集が ${measure(0)} ステップ`);

section("10. スナップショット復元と undo 履歴");
const restored = new LoroOutlineStore({ peerId: "60" });
restored.applyUpdate(a.exportSnapshot());
console.log(render(restored.items()));
console.log(`復元後の canUndo=${restored.canUndo()} / canRedo=${restored.canRedo()} (履歴はセッション内のみ)`);
