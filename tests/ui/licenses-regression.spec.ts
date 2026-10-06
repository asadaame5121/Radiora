import { expect, type Page, type Route, test } from "@playwright/test";

const index = {
	runtime: [{
		name: "Runtime A",
		version: "1.0",
		license: "MIT",
		file: "runtime-a.txt",
		summary: "Runtime notice",
	}],
	npm: [{
		name: "Package B",
		version: "2.0",
		license: "Apache-2.0",
		file: "package-b.txt",
		summary: "Package notice",
	}],
};

const licenseDialog = (page: Page) =>
	page.getByRole("dialog", { name: "ライセンス情報", exact: true });
const openButton = (page: Page) =>
	page.getByRole("button", { name: "ライセンス情報を表示", exact: true });

// Hold only the external HTTP boundary; do not mock App or the dialog's future owner.
async function holdLicense(page: Page, file = "runtime-a.txt") {
	let capture: (route: Route) => void = () => {
		throw new Error("Request capture is not initialized");
	};
	const request = new Promise<Route>((resolve) => {
		capture = resolve;
	});
	await page.route(`**/licenses/${file}`, (route) => capture(route));
	return { request };
}

async function finishLicense(page: Page, route: Route, status: number | "network", body: string) {
	if (status === "network") {
		const failed = page.waitForEvent(
			"requestfailed",
			(request) => request.url().endsWith("/licenses/runtime-a.txt"),
		);
		await route.abort("failed");
		await failed;
	} else {
		const response = page.waitForResponse("**/licenses/runtime-a.txt");
		await route.fulfill({ status, contentType: "text/plain", body });
		await (await response).finished();
	}
	// Let fetch continuation and the UI render finish before a negative/stability assertion.
	await page.evaluate(() =>
		new Promise<void>((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		})
	);
}

test.beforeEach(async ({ page }) => {
	await page.route("**/licenses/index.json", (route) => route.fulfill({ json: index }));
	await page.route(
		"**/licenses/package-b.txt",
		(route) => route.fulfill({ contentType: "text/plain", body: "Package B license text" }),
	);
	await page.goto("/");
	await page.getByRole("button", { name: "Option", exact: true }).click();
});

test("#313 license dialog displays runtime and npm notices, closes with Escape and reopens cleanly", async ({ page }) => {
	await openButton(page).click();
	const dialog = licenseDialog(page);
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("button", { name: /Runtime A/ })).toBeVisible();
	await dialog.getByRole("button", { name: /Package B/ }).click();
	await expect(dialog.getByRole("heading", { name: "Package B 2.0", exact: true })).toBeVisible();
	await expect(dialog.getByText("Package B license text", { exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	// Closing the dialog returns keyboard focus to the Options opener.
	await expect(openButton(page)).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText("左の一覧からライセンスを選択してください。", { exact: true }))
		.toBeVisible();
	await expect(dialog.getByText("Package B license text", { exact: true })).toHaveCount(0);
});

test("#313 index failure is announced and reopening can retry", async ({ page }) => {
	await page.route(
		"**/licenses/index.json",
		(route) => route.fulfill({ status: 503, body: "Unavailable" }),
	);
	await openButton(page).click();
	const dialog = licenseDialog(page);
	await expect(dialog.getByRole("alert")).toHaveText("ライセンス情報を読み込めませんでした (503)");
	await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
	await page.route("**/licenses/index.json", (route) => route.fulfill({ json: index }));
	await openButton(page).click();
	await expect(dialog.getByRole("button", { name: /Package B/ })).toBeVisible();
	await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("#313 selected license shows loading and HTTP failure, then another selection succeeds", async ({ page }) => {
	const held = await holdLicense(page);
	await openButton(page).click();
	const dialog = licenseDialog(page);
	await dialog.getByRole("button", { name: /Runtime A/ }).click();
	const route = await held.request;
	await expect(dialog.getByText("ライセンス全文を読み込んでいます…", { exact: true }))
		.toBeVisible();
	await finishLicense(page, route, 404, "Not found");
	await expect(dialog.getByText("ライセンス全文を読み込めませんでした (404)。", { exact: true }))
		.toBeVisible();
	await dialog.getByRole("button", { name: /Package B/ }).click();
	await expect(dialog.getByText("Package B license text", { exact: true })).toBeVisible();
});

for (const status of [200, 503, "network"] as const) {
	test(`#313 stale detail ${status} cannot replace a newer selection`, async ({ page }) => {
		const held = await holdLicense(page);
		await openButton(page).click();
		const dialog = licenseDialog(page);
		await dialog.getByRole("button", { name: /Runtime A/ }).click();
		const route = await held.request;
		await dialog.getByRole("button", { name: /Package B/ }).click();
		await expect(dialog.getByText("Package B license text", { exact: true })).toBeVisible();
		await finishLicense(page, route, status, "Old Runtime A license text");
		await expect(dialog.getByRole("heading", { name: "Package B 2.0", exact: true })).toBeVisible();
		await expect(dialog.getByText("Package B license text", { exact: true })).toBeVisible();
	});

	test(`#313 detail ${status} from a closed dialog cannot leak into a reopened dialog`, async ({ page }) => {
		const held = await holdLicense(page);
		await openButton(page).click();
		const dialog = licenseDialog(page);
		await dialog.getByRole("button", { name: /Runtime A/ }).click();
		const route = await held.request;
		await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
		await expect(dialog).toBeHidden();
		await openButton(page).click();
		await expect(dialog.getByText("左の一覧からライセンスを選択してください。", { exact: true }))
			.toBeVisible();
		await finishLicense(page, route, status, "Old Runtime A license text");
		await expect(dialog.getByText("左の一覧からライセンスを選択してください。", { exact: true }))
			.toBeVisible();
		await expect(dialog.getByRole("heading", { name: "Runtime A 1.0", exact: true })).toHaveCount(
			0,
		);
	});
}

for (const status of [200, 503]) {
	test(`#313 index loading is closable and its late ${status} cannot reopen the dialog`, async ({ page }) => {
		const held = await holdLicense(page, "index.json");
		await openButton(page).click();
		const route = await held.request;
		const dialog = licenseDialog(page);
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText("読み込んでいます…", { exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(openButton(page)).toBeFocused();
		const response = page.waitForResponse("**/licenses/index.json");
		await route.fulfill({ status, json: index });
		await (await response).finished();
		await page.evaluate(() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			})
		);
		await expect(dialog).toBeHidden();
	});
}

for (const status of [200, 503]) {
	test(`#313 old index ${status} cannot overwrite a reopened dialog's index`, async ({ page }) => {
		const held = await holdLicense(page, "index.json");
		await openButton(page).click();
		const route = await held.request;
		const dialog = licenseDialog(page);
		await expect(dialog).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await page.route(
			"**/licenses/index.json",
			(next) => next.fulfill({ json: { runtime: [], npm: index.npm } }),
		);
		await openButton(page).click();
		await expect(dialog.getByRole("button", { name: /Package B/ })).toBeVisible();
		const response = page.waitForResponse("**/licenses/index.json");
		await route.fulfill({ status, json: { runtime: index.runtime, npm: [] } });
		await (await response).finished();
		await page.evaluate(() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			})
		);
		await expect(dialog.getByRole("button", { name: /Package B/ })).toBeVisible();
		await expect(dialog.getByRole("button", { name: /Runtime A/ })).toHaveCount(0);
		await expect(dialog.getByRole("alert")).toHaveCount(0);
	});
}
