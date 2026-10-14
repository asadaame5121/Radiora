import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert@1";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { OccurrenceOperations } from "../src/services/occurrence_operations.ts";
import { NodeSqliteDatabaseAdapter } from "../src/storage/sqlite_records.ts";
import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";

const UPDATED_AT = "2026-10-14T00:00:00.000Z";
type FailurePoint = "begin" | "statement" | "commit";

function failingConnector(point: FailurePoint) {
	let armed = false;
	return {
		arm: () => {
			armed = true;
		},
		connect: (path: string) => {
			const raw = new DatabaseSync(path);
			return new NodeSqliteDatabaseAdapter({
				exec: (sql) => {
					if (
						armed && ((point === "begin" && sql === "BEGIN IMMEDIATE") ||
							(point === "commit" && sql === "COMMIT"))
					) {
						armed = false;
						throw new Error(`injected ${point} failure`);
					}
					raw.exec(sql);
				},
				prepare: (sql) => {
					const statement = raw.prepare(sql);
					return {
						get: (...args: unknown[]) => statement.get(...args as SQLInputValue[]),
						all: (...args: unknown[]) => statement.all(...args as SQLInputValue[]),
						run: (...args: unknown[]) => {
							const result = statement.run(...args as SQLInputValue[]);
							if (armed && point === "statement") {
								armed = false;
								throw new Error("injected statement failure");
							}
							return result;
						},
					};
				},
				close: () => raw.close(),
			});
		},
	};
}

const mutations: Record<
	string,
	(store: SqliteGraphStore, state: GraphStateSnapshot) => Promise<void>
> = {
	workingCopy: (store, state) =>
		store.updateWorkingCopy(state.works[0].id, "failed text", UPDATED_AT),
	branchWorkingCopy: (store, state) =>
		store.updateBranchWorkingCopy(state.branches[0].id, "failed text", UPDATED_AT),
	occurrence: (store, state) =>
		store.updateOccurrence({ ...state.occurrences[0], collapsed: true }),
	structuralOccurrence: (store, state) =>
		store.updateOccurrence({
			...state.occurrences[0],
			parentOccurrenceId: state.occurrences[0].id,
		}),
	resumeSet: (store, state) =>
		store.setResumePosition({
			workId: state.works[0].id,
			occurrenceId: state.occurrences[0].id,
			caretOffset: 42,
			updatedAt: UPDATED_AT,
		}),
	resumeClear: (store) => store.clearResumePosition(),
};

for (const point of ["begin", "statement", "commit"] as const) {
	for (const [name, mutate] of Object.entries(mutations)) {
		Deno.test(`SQLite targeted ${name} restores memory and disk after ${point} failure and accepts the next queued mutation`, async () => {
			const root = await Deno.makeTempDir({ prefix: "sqlite-targeted-failure-" });
			const path = `${root}/graph.db`;
			const injection = failingConnector(point);
			let store = new SqliteGraphStore(path, { connector: injection.connect });
			try {
				await store.initialize();
				const item = await new OccurrenceOperations(store).createItem({
					text: "before",
					parentId: null,
				});
				await store.setResumePosition({
					workId: item.workId,
					occurrenceId: item.id,
					caretOffset: 0,
					updatedAt: UPDATED_AT,
				});
				const before = await store.exportGraphState();
				injection.arm();
				await assertRejects(() => mutate(store, before), Error, `injected ${point} failure`);
				assertEquals(await store.exportGraphState(), before);
				await store.close();
				store = new SqliteGraphStore(path, { connector: injection.connect });
				await store.initialize();
				assertEquals(await store.exportGraphState(), before);

				injection.arm();
				const failure = assertRejects(
					() => mutate(store, before),
					Error,
					`injected ${point} failure`,
				);
				const next = store.updateWorkingCopy(item.workId, "after", UPDATED_AT);
				await failure;
				await next;
				const after = await store.exportGraphState();
				assertEquals(after.workingCopies[0].text, "after");
				assertEquals(after.occurrences, before.occurrences);
				assertEquals(after.resumePosition, before.resumePosition);
				await store.close();
				store = new SqliteGraphStore(path);
				await store.initialize();
				assertEquals(await store.exportGraphState(), after);
			} finally {
				await store.close();
				await Deno.remove(root, { recursive: true });
			}
		});
	}
}

class ObservedSqliteStore extends SqliteGraphStore {
	occurrenceRecords() {
		return this.state.occurrences;
	}
}

Deno.test("SQLite structural occurrence updates reject invalid references inside a batch before changing memory", async () => {
	const root = await Deno.makeTempDir();
	const path = `${root}/graph.db`;
	const store = new SqliteGraphStore(path);
	try {
		await store.initialize();
		const operations = new OccurrenceOperations(store);
		const item = await operations.createItem({ text: "first", parentId: null });
		const other = await operations.createItem({ text: "second", parentId: null });
		const bookmarkId = crypto.randomUUID();
		await store.createBookmark({
			id: bookmarkId,
			workId: item.workId,
			occurrenceId: item.id,
			createdAt: UPDATED_AT,
		});
		await store.setResumePosition({
			workId: item.workId,
			occurrenceId: item.id,
			caretOffset: 0,
			updatedAt: UPDATED_AT,
		});
		const before = await store.exportGraphState();
		const occurrence = before.occurrences[0];
		await store.batch(async () => {
			await assertRejects(
				() =>
					store.updateOccurrence({
						...occurrence,
						parentOccurrenceId: item.id,
						revisionSelector: { mode: "branch", branchId: "missing" },
					}),
				Error,
				"Invalid Occurrence Branch selector",
			);
			await assertRejects(
				() =>
					store.updateOccurrence({
						...occurrence,
						parentOccurrenceId: item.id,
						revisionSelector: { mode: "pinned", revisionId: "missing" },
					}),
				Error,
				"Invalid Occurrence Revision selector",
			);
			const changedWork = {
				...occurrence,
				workId: other.workId,
				revisionSelector: before.occurrences[1].revisionSelector,
			};
			await assertRejects(
				() => store.updateOccurrence(changedWork),
				Error,
				"Invalid Bookmark workId reference",
			);
			await store.deleteBookmark(bookmarkId);
			await assertRejects(
				() => store.updateOccurrence(changedWork),
				Error,
				"Invalid ResumePosition workId reference",
			);
			assertEquals(await store.listOccurrences(), before.occurrences);
			await store.updateOccurrence({ ...occurrence, collapsed: true });
		});
		const after = await store.exportGraphState();
		assertEquals(after.occurrences[0].collapsed, true);
		assertEquals(after.knots, before.knots);
		await store.close();
		const reopened = new SqliteGraphStore(path);
		try {
			await reopened.initialize();
			assertEquals(await reopened.exportGraphState(), after);
		} finally {
			await reopened.close();
		}
	} finally {
		await store.close();
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("SQLite structural occurrence updates reuse the validated local plan inside a batch and persist knots", async () => {
	const root = await Deno.makeTempDir();
	const path = `${root}/graph.db`;
	const store = new ObservedSqliteStore(path);
	try {
		await store.initialize();
		const item = await new OccurrenceOperations(store).createItem({
			text: "cycle",
			parentId: null,
		});
		const occurrence = (await store.listOccurrences())[0];
		await store.batch(async () => {
			const records = store.occurrenceRecords();
			await store.updateOccurrence({ ...occurrence, parentOccurrenceId: item.id });
			assertStrictEquals(store.occurrenceRecords(), records);
		});
		const after = await store.exportGraphState();
		assertEquals(after.knots.map((knot) => knot.cycleIds), [[item.id]]);
		await store.close();
		const reopened = new SqliteGraphStore(path);
		try {
			await reopened.initialize();
			assertEquals(await reopened.exportGraphState(), after);
		} finally {
			await reopened.close();
		}
	} finally {
		await store.close();
		await Deno.remove(root, { recursive: true });
	}
});
