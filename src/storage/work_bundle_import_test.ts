import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { Branch, Occurrence, Work, WorkingCopy } from "../domain/models.ts";
import type { GraphStore, WorkBundle } from "./graph_store.ts";
import { JsonGraphStore } from "./json_store.ts";
import { MemoryGraphStore } from "./memory_store.ts";

const NOW = "2026-07-30T00:00:00.000Z";

function bundle(text: string, parentOccurrenceId: string | null, orderKey: number): WorkBundle {
	const work: Work = { id: crypto.randomUUID(), createdAt: NOW, updatedAt: NOW };
	const branch: Branch = {
		id: crypto.randomUUID(),
		workId: work.id,
		name: "main",
		headRevisionId: null,
		createdAt: NOW,
	};
	const workingCopy: WorkingCopy = {
		branchId: branch.id,
		workId: work.id,
		text,
		updatedAt: NOW,
	};
	const occurrence: Occurrence = {
		id: crypto.randomUUID(),
		workId: work.id,
		parentOccurrenceId,
		orderKey,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: branch.id },
	};
	return { work, branch, workingCopy, occurrence };
}

async function assertAtomicImport(store: GraphStore): Promise<void> {
	const root = bundle("日本語\n複数行", null, 1024);
	const child = bundle("子", root.occurrence.id, 1024);
	await store.importWorkBundles([root, child]);
	assertEquals((await store.listItems()).map((item) => item.text), ["日本語\n複数行", "子"]);

	const colliding = bundle("衝突", null, 2048);
	colliding.work.id = root.work.id;
	const before = await store.listItems();
	await assertRejects(
		() => store.importWorkBundles([bundle("先行", null, 2048), colliding]),
		Error,
		"Work ID collision",
	);
	assertEquals(await store.listItems(), before);
}

Deno.test("MemoryGraphStore imports a complete outline atomically", async () => {
	await assertAtomicImport(new MemoryGraphStore());
});

Deno.test("JsonGraphStore imports and persists a complete outline atomically", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}\\graph.json`;
	try {
		const store = new JsonGraphStore(path);
		await store.initialize();
		await assertAtomicImport(store);
		await store.close();
		const reopened = new JsonGraphStore(path);
		await reopened.initialize();
		assertEquals((await reopened.listItems()).map((item) => item.text), [
			"日本語\n複数行",
			"子",
		]);
		await reopened.close();
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
