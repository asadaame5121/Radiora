import { assertEquals } from "jsr:@std/assert@1";
import { createBindingHandlers } from "../src/desktop/register_bindings.ts";
import type { JsonBackupV6 } from "../src/services/json_backup.ts";
import { OutlineService } from "../src/services/outline_service.ts";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";

function desktopBindings(store: MemoryGraphStore) {
	const service = new OutlineService(store);
	return createBindingHandlers({
		getService: () => service,
		getStartupStatus: () => ({ phase: "ready", message: "準備完了" }),
		retryStartup: () => Promise.resolve({ phase: "ready", message: "準備完了" }),
		rewriteAsNewBranch: () => Promise.reject(new Error("not used by this test")),
	});
}

async function sha256(value: string): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function backupSummary(source: string) {
	const backup = JSON.parse(source) as JsonBackupV6;
	const data = backup.data;
	return {
		counts: Object.fromEntries(
			Object.entries(data)
				.filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
				.map(([key, values]) => [key, values.length]),
		),
		ids: {
			works: data.works.map((work) => work.id).sort(),
			branches: data.branches.map((branch) => branch.id).sort(),
			occurrences: data.occurrences.map((occurrence) => occurrence.id).sort(),
			links: data.links.map((link) => link.id).sort(),
		},
		linkDirections: data.links.map((link) => ({
			id: link.id,
			type: link.type,
			from: link.from,
			to: link.to,
		})).sort((left, right) => left.id.localeCompare(right.id)),
		bodyHashes: await Promise.all(
			[...data.workingCopies]
				.sort((left, right) => left.workId.localeCompare(right.workId))
				.map(async (copy) => ({
					workId: copy.workId,
					sha256: await sha256(copy.text),
				})),
		),
	};
}

Deno.test("Windows Desktop binding export restores an empty database without identity loss", async () => {
	const source = desktopBindings(new MemoryGraphStore());
	const root = await source.createItem({
		text: "原稿\n\n日本語 **Markdown**",
		parentId: null,
	});
	const child = await source.createItem({
		text: "別稿\n[原稿](radiora://work/11111111-1111-4111-8111-111111111111)",
		parentId: root.id,
	});
	await source.createLink({
		fromId: root.id,
		toId: child.id,
		type: "FIX",
	});

	const exported = await source.exportJsonBackup();
	const restored = desktopBindings(new MemoryGraphStore());
	assertEquals(await restored.listOutline(), { items: [], links: [], knots: [], stashItemIds: [] });
	await restored.restoreJsonBackup(exported);
	const reexported = await restored.exportJsonBackup();

	assertEquals(await backupSummary(reexported), await backupSummary(exported));
});
