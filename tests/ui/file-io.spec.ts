import { expect, test } from "@playwright/test";
import { DEFAULT_UI_VOCABULARY as vocabulary } from "../../src/shared/ui_vocabulary.ts";

test("Options keeps Markdown settings across remount and exports all three formats", async ({ page }) => {
	await page.route(
		"**/api/rpc/exportOpml",
		(route) => route.fulfill({ json: { result: '<opml version="2.0"><body/></opml>' } }),
	);
	await page.route(
		"**/api/rpc/exportJsonBackup",
		(route) => route.fulfill({ json: { result: '{"format":"radiora-backup","schemaVersion":8}' } }),
	);
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await page.getByRole("button", { name: "Option", exact: true }).click();
	const card = page.locator('section[aria-labelledby="option-export-title"]');
	await card.locator("select").nth(1).selectOption("portable");
	await expect.poll(() =>
		page.evaluate(() => localStorage.getItem("radiora.markdownExportPreference"))
	).toContain('"referenceMode":"portable"');
	await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
	await page.getByRole("button", { name: "Option", exact: true }).click();
	await expect(card.locator("select").nth(1)).toHaveValue("portable");
	for (
		const [label, extension, notice] of [
			[vocabulary.markdownExportAction, ".md", "Markdownをエクスポートしました。"],
			[vocabulary.opmlExport, ".opml", vocabulary.opmlExportSuccess + "。"],
			[vocabulary.jsonBackupExport, ".json", vocabulary.jsonBackupExportSuccess + "。"],
		]
	) {
		const pending = page.waitForEvent("download");
		await page.getByRole("button", { name: label, exact: true }).click();
		const download = await pending;
		expect(download.suggestedFilename()).toMatch(
			new RegExp("^radiora-.*" + extension.replace(".", "\\.") + "$"),
		);
		await expect(page.getByRole("status").filter({ hasText: notice })).toBeVisible();
		const stream = await download.createReadStream();
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(Buffer.from(chunk));
		const source = Buffer.concat(chunks).toString("utf8");
		expect(source.length).toBeGreaterThan(0);
		if (extension === ".opml") expect(source).toContain("<opml");
		if (extension === ".json") expect(JSON.parse(source).format).toBe("radiora-backup");
	}
});

test("Options import and restore route through reload and existing relation owners", async ({ page }) => {
	const steps: string[] = [];
	let importing = false;
	await page.route("**/api/rpc/importOpml", (route) => {
		importing = true;
		steps.push("import");
		expect(route.request().postDataJSON().args[0]).toBe("<opml/>");
		return route.fulfill({ json: { result: { importedCount: 2 } } });
	});
	await page.route("**/api/rpc/restoreJsonBackup", (route) => {
		steps.push("restore");
		return route.fulfill({
			json: {
				result: { workCount: 3, occurrenceCount: 3, revisionCount: 3, recoverySnapshotCount: 0 },
			},
		});
	});
	await page.route("**/api/rpc/listRelationTypeDefinitions", (route) => {
		if (importing) steps.push("relations");
		return route.continue();
	});
	await page.route("**/api/rpc/listOutline", (route) => {
		if (importing) steps.push("reload");
		return route.continue();
	});
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await page.getByRole("button", { name: "Option", exact: true }).click();
	await page.getByLabel(vocabulary.opmlImport, { exact: true }).setInputFiles({
		name: "outline.opml",
		mimeType: "text/x-opml",
		buffer: Buffer.from("<opml/>"),
	});
	await expect(
		page.getByRole("status").filter({ hasText: vocabulary.opmlImportSuccess + ": 2件。" }),
	).toBeVisible();
	expect(steps).toEqual(["import", "reload"]);
	steps.length = 0;
	await page.getByLabel(vocabulary.jsonBackupRestore, { exact: true }).setInputFiles({
		name: "backup.json",
		mimeType: "application/json",
		buffer: Buffer.from("{}"),
	});
	await expect(
		page.getByRole("status").filter({
			hasText: vocabulary.jsonBackupRestoreSuccess + ": 3件の" + vocabulary.work + "。",
		}),
	).toBeVisible();
	expect(steps).toEqual(["restore", "relations", "reload"]);
});

test("restore and reload failures retain the error display without success notices", async ({ page }) => {
	let failRestore = true;
	let restored = false;
	await page.route("**/api/rpc/restoreJsonBackup", (route) => {
		restored = true;
		return failRestore
			? route.fulfill({ status: 500, json: { message: "restore failed" } })
			: route.fulfill({
				json: {
					result: { workCount: 3, occurrenceCount: 3, revisionCount: 3, recoverySnapshotCount: 0 },
				},
			});
	});
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			restored
				? route.fulfill({ status: 500, json: { message: "reload failed" } })
				: route.continue(),
	);
	await page.goto("/", { waitUntil: "domcontentloaded" });
	await page.getByRole("button", { name: "Option", exact: true }).click();
	const input = page.getByLabel(vocabulary.jsonBackupRestore, { exact: true });
	const file = { name: "backup.json", mimeType: "application/json", buffer: Buffer.from("{}") };
	await input.setInputFiles(file);
	await expect(page.locator(".error")).toContainText("restore failed");
	await expect(page.locator(".error")).toContainText(vocabulary.jsonBackupRestoreFailureRecovery);
	await expect(page.locator(".json-backup-notice")).toHaveCount(0);
	failRestore = false;
	await input.setInputFiles(file);
	await expect(page.locator(".error")).toContainText("reload failed");
	await expect(page.locator(".json-backup-notice")).toHaveCount(0);
});
