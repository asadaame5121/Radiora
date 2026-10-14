import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert@1";
import type { Knot, RecoverySnapshot } from "../domain/models.ts";
import type { GraphStateSnapshot, WorkBundle } from "./graph_store.ts";
import { JsonGraphStore, type JsonRestoreFileOperations } from "./json_store.ts";
import { MemoryGraphStore } from "./memory_store.ts";

const NOW = "2026-10-01T00:00:00.000Z";
const EXTERNAL_MUTATION_WAIT_MS = 30;

Deno.test("JSON close drains accepted mutations and batches while rejecting new writes", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new JsonGraphStore(path);
		await seed(store);
		const first = store.updateWorkingCopy("one", "first", NOW);
		const second = store.updateWorkingCopy("one", "second", NOW);
		const batch = store.batch(async () => {
			await store.updateWorkingCopy("one", "last", NOW);
		});
		const closed = store.close();
		await assertRejects(() => store.updateWorkingCopy("one", "rejected", NOW), Error, "closing");
		await Promise.all([first, second, batch, closed]);
		assertEquals((await store.listWorkingCopies("one"))[0].text, "last");
		const reopened = new JsonGraphStore(path);
		await reopened.initialize();
		assertEquals((await reopened.listWorkingCopies("one"))[0].text, "last");
		await reopened.close();
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("JSON nested rollback preserves pending Knot reconciliation", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new JsonGraphStore(path);
		await seed(store);
		await store.batch(async () => {
			await store.updateOccurrence({ ...bundle("one").occurrence, parentOccurrenceId: "two" });
			await store.updateOccurrence({ ...bundle("two").occurrence, parentOccurrenceId: "one" });
			await assertRejects(() => store.importWorkBundles([bundle("one")]), Error);
		});
		const knots = await store.listKnots();
		assertEquals(knots.length, 1);
		assertEquals([...knots[0].cycleIds].sort(), ["one", "two"]);
		const disk: GraphStateSnapshot = JSON.parse(await Deno.readTextFile(path)).data;
		assertEquals(disk.knots, knots);
		const reopened = new JsonGraphStore(path);
		await reopened.initialize();
		assertEquals(await reopened.listKnots(), knots);
		await reopened.close();
		await store.close();
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("JSON queued Knot replacements honor the last request", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new JsonGraphStore(path);
		await seed(store);
		const original = await store.listKnots();
		const replacement: Knot[] = [{ id: "knot", cycleIds: ["one", "two"], createdAt: NOW }];
		const first = store.replaceKnots(replacement);
		const last = store.replaceKnots(original);
		await Promise.all([first, last]);
		assertEquals(await store.listKnots(), original);
		const disk: GraphStateSnapshot = JSON.parse(await Deno.readTextFile(path)).data;
		assertEquals(disk.knots, original);
		await store.close();
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

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

Deno.test("JsonGraphStore batch saves atomically via rename and avoids intermediate writes (C02)", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	const operationsCalled: { write: number; rename: number; remove: number } = {
		write: 0,
		rename: 0,
		remove: 0,
	};
	const operations: JsonRestoreFileOperations = {
		writeTextFile: async (p, d) => {
			operationsCalled.write++;
			await Deno.writeTextFile(p, d);
		},
		rename: async (oldP, newP) => {
			operationsCalled.rename++;
			await Deno.rename(oldP, newP);
		},
		remove: async (p) => {
			operationsCalled.remove++;
			await Deno.remove(p);
		},
	};

	try {
		const store = new JsonGraphStore(path, operations);
		await seed(store);
		operationsCalled.write = 0;
		operationsCalled.rename = 0;
		operationsCalled.remove = 0;

		await store.batch(async () => {
			await store.updateWorkingCopy("one", "updated batch text", NOW);
			await store.updateOccurrence({
				id: "one",
				workId: "one",
				parentOccurrenceId: null,
				orderKey: 500,
				collapsed: true,
				revisionSelector: { mode: "branch", branchId: "one" },
			});
		});

		assertEquals(operationsCalled.rename, 1);
		assertEquals(operationsCalled.write, 1);

		// Check memory
		const occurrences = await store.listOccurrences();
		assertEquals(occurrences.find((o) => o.id === "one")?.collapsed, true);

		// Check disk on reopen
		const reopened = new JsonGraphStore(path);
		await reopened.initialize();
		const diskOccurrences = await reopened.listOccurrences();
		assertEquals(diskOccurrences.find((o) => o.id === "one")?.collapsed, true);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("JsonGraphStore batch rolls back memory and disk on thrown error", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new JsonGraphStore(path);
		await seed(store);
		const beforeState = await store.exportGraphState();

		await assertRejects(
			() =>
				store.batch(async () => {
					await store.updateWorkingCopy("one", "should be rolled back", NOW);
					throw new Error("simulated batch error");
				}),
			Error,
			"simulated batch error",
		);

		assertEquals(await store.exportGraphState(), beforeState);

		const reopened = new JsonGraphStore(path);
		await reopened.initialize();
		assertEquals(await reopened.exportGraphState(), beforeState);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("JsonGraphStore batch rolls back and cleans temporary file on temp write failure", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	let failWrite = false;
	const operations: JsonRestoreFileOperations = {
		writeTextFile: async (p, d) => {
			if (failWrite) throw new Error("simulated temp write failure");
			await Deno.writeTextFile(p, d);
		},
		rename: (oldP, newP) => Deno.rename(oldP, newP),
		remove: (p) => Deno.remove(p),
	};

	try {
		const store = new JsonGraphStore(path, operations);
		await seed(store);
		const beforeState = await store.exportGraphState();

		failWrite = true;
		await assertRejects(
			() =>
				store.batch(async () => {
					await store.updateWorkingCopy("one", "write fail text", NOW);
				}),
			Error,
			"simulated temp write failure",
		);

		assertEquals(await store.exportGraphState(), beforeState);
		assertEquals(Array.from(Deno.readDirSync(directory), (entry) => entry.name), ["graph.json"]);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("JsonGraphStore batch rolls back and cleans temporary file on rename failure", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	let failRename = false;
	const operations: JsonRestoreFileOperations = {
		writeTextFile: (p, d) => Deno.writeTextFile(p, d),
		rename: async (oldP, newP) => {
			if (failRename) throw new Error("simulated rename failure");
			await Deno.rename(oldP, newP);
		},
		remove: (p) => Deno.remove(p),
	};

	try {
		const store = new JsonGraphStore(path, operations);
		await seed(store);
		const beforeState = await store.exportGraphState();

		failRename = true;
		await assertRejects(
			() =>
				store.batch(async () => {
					await store.updateWorkingCopy("one", "rename fail text", NOW);
				}),
			Error,
			"simulated rename failure",
		);

		assertEquals(await store.exportGraphState(), beforeState);
		assertEquals(Array.from(Deno.readDirSync(directory), (entry) => entry.name), ["graph.json"]);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("JsonGraphStore nested batch shares batch context with single atomic rename", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	let renameCount = 0;
	const operations: JsonRestoreFileOperations = {
		writeTextFile: (p, d) => Deno.writeTextFile(p, d),
		rename: async (oldP, newP) => {
			renameCount++;
			await Deno.rename(oldP, newP);
		},
		remove: (p) => Deno.remove(p),
	};

	try {
		const store = new JsonGraphStore(path, operations);
		await seed(store);
		renameCount = 0;

		await store.batch(async () => {
			await store.updateWorkingCopy("one", "nested text 1", NOW);
			await store.batch(async () => {
				await store.updateWorkingCopy("two", "nested text 2", NOW);
			});
		});

		assertEquals(renameCount, 1);

		const reopened = new JsonGraphStore(path);
		await reopened.initialize();
		const diskState = await reopened.exportGraphState();
		assertEquals(diskState.workingCopies.find((w) => w.workId === "one")?.text, "nested text 1");
		assertEquals(diskState.workingCopies.find((w) => w.workId === "two")?.text, "nested text 2");
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("JsonGraphStore batch serializes concurrent external updates", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new JsonGraphStore(path);
		await seed(store);

		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();

		const batchPromise = store.batch(async () => {
			await store.updateWorkingCopy("one", "batch update text", NOW);
			entered.resolve();
			await release.promise;
		});

		await entered.promise;

		let externalSettled = false;
		const externalPromise = store.updateWorkingCopy("two", "external concurrent text", NOW).then(
			() => {
				externalSettled = true;
			},
		);

		await new Promise((resolve) => setTimeout(resolve, EXTERNAL_MUTATION_WAIT_MS));
		assertEquals(externalSettled, false);

		release.resolve();
		await batchPromise;
		await externalPromise;
		assertEquals(externalSettled, true);

		const reopened = new JsonGraphStore(path);
		await reopened.initialize();
		const diskState = await reopened.exportGraphState();
		assertEquals(
			diskState.workingCopies.find((w) => w.workId === "one")?.text,
			"batch update text",
		);
		assertEquals(
			diskState.workingCopies.find((w) => w.workId === "two")?.text,
			"external concurrent text",
		);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
