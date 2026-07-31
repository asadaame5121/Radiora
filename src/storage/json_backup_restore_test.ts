import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { OccurrenceOperations } from "../services/occurrence_operations.ts";
import { JsonGraphStore, type JsonRestoreFileOperations } from "./json_store.ts";

Deno.test("JsonGraphStore atomically restores graph state and persists it", async () => {
	const directory = await Deno.makeTempDir();
	const sourcePath = `${directory}\\source.json`;
	const targetPath = `${directory}\\target.json`;
	try {
		const source = new JsonGraphStore(sourcePath);
		await source.initialize();
		await new OccurrenceOperations(source).createItem({
			text: "復元本文\n日本語",
			parentId: null,
		});
		const expected = await source.exportGraphState();
		await source.close();

		const target = new JsonGraphStore(targetPath);
		await target.initialize();
		await new OccurrenceOperations(target).createItem({ text: "置換前", parentId: null });
		await target.restoreGraphState(expected);
		assertEquals(await target.exportGraphState(), expected);
		await target.close();

		const reopened = new JsonGraphStore(targetPath);
		await reopened.initialize();
		assertEquals(await reopened.exportGraphState(), expected);
		await reopened.close();
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

for (
	const failure of [
		{
			name: "capacity exhaustion while writing",
			message: "No space left on device",
			operations: (): JsonRestoreFileOperations => ({
				writeTextFile: () => Promise.reject(new Error("No space left on device")),
				rename: (oldPath, newPath) => Deno.rename(oldPath, newPath),
				remove: async () => {},
			}),
		},
		{
			name: "interruption before replacing the database",
			message: "simulated interruption",
			operations: (): JsonRestoreFileOperations => ({
				writeTextFile: (path, data) => Deno.writeTextFile(path, data),
				rename: () => Promise.reject(new Error("simulated interruption")),
				remove: (path) => Deno.remove(path),
			}),
		},
	] as const
) {
	Deno.test(`JsonGraphStore keeps current data after ${failure.name}`, async () => {
		const directory = await Deno.makeTempDir();
		const targetPath = `${directory}\\target.json`;
		try {
			const target = new JsonGraphStore(targetPath);
			await target.initialize();
			await new OccurrenceOperations(target).createItem({ text: "現在の本文", parentId: null });
			const beforeState = await target.exportGraphState();
			const beforeFile = await Deno.readTextFile(targetPath);

			const replacement = new JsonGraphStore(`${directory}\\replacement.json`);
			await replacement.initialize();
			await new OccurrenceOperations(replacement).createItem({
				text: "置き換える本文",
				parentId: null,
			});
			const replacementState = await replacement.exportGraphState();

			const failingTarget = new JsonGraphStore(targetPath, failure.operations());
			await failingTarget.initialize();
			const error = await assertRejects(
				() => failingTarget.restoreGraphState(replacementState),
				Error,
			);
			assertStringIncludes(error.message, failure.message);
			assertEquals(await failingTarget.exportGraphState(), beforeState);
			assertEquals(await Deno.readTextFile(targetPath), beforeFile);
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});
}
