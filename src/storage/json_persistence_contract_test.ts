import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert@1";
import type { RecoverySnapshot } from "../domain/models.ts";
import type { GraphStateSnapshot, WorkBundle } from "./graph_store.ts";
import { JsonGraphStore, type JsonRestoreFileOperations } from "./json_store.ts";
import { MemoryGraphStore } from "./memory_store.ts";

const NOW = "2026-10-01T00:00:00.000Z";

function bundle(id: string): WorkBundle {
	return {
		work: { id, createdAt: NOW, updatedAt: NOW },
		branch: { id, workId: id, name: "main", headRevisionId: null, createdAt: NOW },
		workingCopy: { branchId: id, workId: id, text: id, updatedAt: NOW },
		occurrence: {
			id,
			workId: id,
			parentOccurrenceId: null,
			orderKey: 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: id },
		},
	};
}

function recovery(id: string, text: string): RecoverySnapshot {
	return {
		id,
		workId: "one",
		branchId: "one",
		text,
		contentHash: text,
		createdAt: NOW,
		sourceRevisionId: null,
	};
}

async function seed(store: MemoryGraphStore): Promise<void> {
	await store.importWorkBundles([bundle("one"), bundle("two")]);
	await store.createRecoverySnapshot(recovery("snapshot", "recovered"));
	await store.upsertEmergenceSuggestion({
		id: "suggestion",
		kind: "latent-relation",
		contextWorkId: "one",
		targetWorkId: "two",
		contextItemId: "one",
		targetItemId: "two",
		proposedLinkType: "LIKE",
		title: "Candidate",
		explanation: "Evidence",
		evidence: [],
		score: 1,
		persistenceStatus: "pending",
		createdAt: NOW,
		updatedAt: NOW,
	});
}

const rollbackMutations: Record<string, (store: JsonGraphStore) => Promise<void>> = {
	import: (store) => store.importWorkBundles([bundle("three")]),
	unplaced: (store) => {
		const { work, branch, workingCopy } = bundle("three");
		return store.createUnplacedWork(work, branch, workingCopy);
	},
	historicalTime: (store) =>
		store.setWorkHistoricalTime("one", {
			kind: "point",
			date: { precision: "year", year: 1604, approximate: false },
		}, NOW),
	merge: (store) => store.mergeWorks({ sourceWorkId: "two", survivorWorkId: "one", mergedAt: NOW }),
	recoveryRestore: (store) =>
		store.restoreRecoverySnapshot("snapshot", recovery("before", "one"), NOW),
	recoveryPromotion: (store) =>
		store.promoteRecoverySnapshot(
			"snapshot",
			{
				id: "revision",
				workId: "one",
				text: "recovered",
				parentRevisionIds: [],
				kind: "edition",
				createdAt: NOW,
			},
			"one",
			NOW,
		),
	emergence: (store) => store.resolveEmergenceSuggestion("suggestion", "pin"),
	relationType: (store) =>
		store.createRelationTypeDefinition({
			name: "CUSTOM",
			direction: "directed",
			builtIn: false,
			createdAt: NOW,
		}),
};

for (const [name, mutate] of Object.entries(rollbackMutations)) {
	Deno.test(`JSON ${name} rolls back all memory on direct-write failure without temporary files`, async () => {
		const directory = await Deno.makeTempDir();
		const path = `${directory}/graph.json`;
		try {
			const store = new JsonGraphStore(path);
			await seed(store);
			const before = await store.exportGraphState();
			const disk = await Deno.readTextFile(path);
			// A directory at the target deterministically fails the ordinary direct write.
			await Deno.rename(path, `${directory}/saved.json`);
			await Deno.mkdir(path);
			await assertRejects(() => mutate(store), Error);
			assertEquals(await store.exportGraphState(), before);
			assertEquals(await Deno.readTextFile(`${directory}/saved.json`), disk);
			assertEquals(Array.from(Deno.readDirSync(directory), (entry) => entry.name).sort(), [
				"graph.json",
				"saved.json",
			]);
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});
}

Deno.test("JSON ordinary save retains mutated memory on direct-write failure", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new JsonGraphStore(path);
		await seed(store);
		const disk = await Deno.readTextFile(path);
		await Deno.rename(path, `${directory}/saved.json`);
		await Deno.mkdir(path);
		await assertRejects(
			() => store.updateWorkingCopy("one", "unsaved", NOW),
			Error,
		);
		assertEquals((await store.listWorkingCopies("one"))[0].text, "unsaved");
		assertEquals(await Deno.readTextFile(`${directory}/saved.json`), disk);
		assertEquals(Array.from(Deno.readDirSync(directory), (entry) => entry.name).sort(), [
			"graph.json",
			"saved.json",
		]);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

for (const useUrl of [false, true]) {
	for (const failure of ["partial-write", "rename", "cleanup", "missing-temp"] as const) {
		Deno.test(`JSON atomic restore preserves memory, disk and original error: ${failure}, URL=${useUrl}`, async () => {
			const directory = await Deno.makeTempDir();
			const path = `${directory}/graph.json`;
			try {
				const initial = new JsonGraphStore(path);
				await seed(initial);
				const before = await initial.exportGraphState();
				const disk = await Deno.readTextFile(path);
				const replacement = new MemoryGraphStore();
				await replacement.importWorkBundles([bundle("replacement")]);
				const error = new Error(failure);
				let temporaryPath: string | URL | undefined;
				let stateAtCleanup: GraphStateSnapshot | undefined;
				const operations: JsonRestoreFileOperations = {
					writeTextFile: async (target, data) => {
						temporaryPath = target;
						if (failure === "missing-temp") throw error;
						await Deno.writeTextFile(target, failure === "partial-write" ? "partial" : data);
						if (failure === "partial-write") throw error;
					},
					rename: () => Promise.reject(error),
					remove: async (target) => {
						// The existing restore contract rolls memory back before cleanup.
						stateAtCleanup = await store.exportGraphState();
						if (failure === "cleanup") throw new Error("cleanup failed");
						await Deno.remove(target);
					},
				};
				const url = new URL("file:///");
				url.pathname = path.replaceAll("\\", "/");
				const store = new JsonGraphStore(useUrl ? url : path, operations);
				await store.initialize();
				const thrown = await assertRejects(() =>
					store.restoreGraphState(replacement.state.capture())
				);
				assertStrictEquals(thrown, error);
				assertEquals(stateAtCleanup, before);
				assertEquals(await store.exportGraphState(), before);
				assertEquals(await Deno.readTextFile(path), disk);
				const files = Array.from(Deno.readDirSync(directory), (entry) => entry.name).sort();
				if (failure === "cleanup") {
					assertEquals(files.length, 2);
					assertEquals(
						typeof temporaryPath === "string"
							? temporaryPath.endsWith(".tmp")
							: temporaryPath?.pathname.endsWith(".tmp"),
						true,
					);
				} else {
					assertEquals(files, ["graph.json"]);
				}
			} finally {
				await Deno.remove(directory, { recursive: true });
			}
		});
	}
}

for (const useUrl of [false, true]) {
	Deno.test(`JSON atomic restore cleans temporary files and rejects invalid state before writing: URL=${useUrl}`, async () => {
		const directory = await Deno.makeTempDir();
		const path = `${directory}/graph.json`;
		try {
			const url = new URL("file:///");
			url.pathname = path.replaceAll("\\", "/");
			const store = new JsonGraphStore(useUrl ? url : path);
			const replacement = new MemoryGraphStore();
			await seed(replacement);
			const expected = await replacement.exportGraphState();
			await store.restoreGraphState(expected);
			assertEquals(await store.exportGraphState(), expected);
			const reopened = new JsonGraphStore(path);
			await reopened.initialize();
			assertEquals(await reopened.exportGraphState(), expected);
			const disk = await Deno.readTextFile(path);
			await assertRejects(() =>
				store.restoreGraphState({
					...expected,
					works: [...expected.works, expected.works[0]],
				})
			);
			assertEquals(await store.exportGraphState(), expected);
			assertEquals(await Deno.readTextFile(path), disk);
			assertEquals(Array.from(Deno.readDirSync(directory), (entry) => entry.name), ["graph.json"]);
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});
}
