import { expect, test } from "@playwright/test";
import { renderedContrast } from "./theme_contrast.ts";

const preferences = ["dark", "auto", "light"] as const;
const labels = { dark: "Dark", auto: "Auto", light: "Light" } as const;

async function expectSelection(
	page: import("@playwright/test").Page,
	preference: (typeof preferences)[number],
	storedPreference: string | null = preference,
) {
	const group = page.getByRole("group", { name: "テーマの切り替え" });
	await expect(group.getByRole("button", { pressed: true })).toHaveCount(1);
	await expect(group.getByRole("button", { name: labels[preference], pressed: true }))
		.toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-theme", preference);
	await expect.poll(() => page.evaluate(() => localStorage.getItem("radiora.themePreference")))
		.toBe(storedPreference);
}

test("an unsaved preference starts in Auto and each control selection persists", async ({ page }) => {
	await page.goto("/");
	await expectSelection(page, "auto", null);
	expect(await page.evaluate(() => localStorage.getItem("radiora.themePreference"))).toBeNull();

	const group = page.getByRole("group", { name: "テーマの切り替え" });
	for (const preference of preferences) {
		await group.getByRole("button", { name: labels[preference], exact: true }).click();
		await expectSelection(page, preference);
	}
});

for (const preference of preferences) {
	test(`${preference} preference is restored after reload`, async ({ page }) => {
		await page.goto("/");
		await page.getByRole("group", { name: "テーマの切り替え" })
			.getByRole("button", { name: labels[preference], exact: true }).click();
		await expectSelection(page, preference);

		await page.reload();
		await expectSelection(page, preference);
	});
}

test("Auto follows system colors while retaining Auto preference", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/");
	await page.getByRole("group", { name: "テーマの切り替え" })
		.getByRole("button", { name: "Auto", exact: true }).click();
	await expectSelection(page, "auto");
	const html = page.locator("html");
	const backgroundColor = () =>
		html.evaluate((element) => getComputedStyle(element).backgroundColor);
	await expect.poll(backgroundColor).toBe("rgb(244, 240, 230)");

	await page.emulateMedia({ colorScheme: "dark" });
	await expect.poll(backgroundColor).toBe("rgb(5, 7, 11)");
	await expectSelection(page, "auto");

	await page.emulateMedia({ colorScheme: "light" });
	await expect.poll(backgroundColor).toBe("rgb(244, 240, 230)");
	await expectSelection(page, "auto");
});

for (const preference of ["dark", "light"] as const) {
	test(`${preference} ignores operating-system color changes`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await page.goto("/");
		await page.getByRole("group", { name: "テーマの切り替え" })
			.getByRole("button", { name: labels[preference], exact: true }).click();
		await expectSelection(page, preference);
		const initialColor = await page.locator("html").evaluate((element) =>
			getComputedStyle(element).backgroundColor
		);
		expect(initialColor).toBe(
			preference === "dark" ? "rgb(5, 7, 11)" : "rgb(244, 240, 230)",
		);

		await page.emulateMedia({ colorScheme: "dark" });
		await expect.poll(() =>
			page.locator("html").evaluate((element) => getComputedStyle(element).backgroundColor)
		).toBe(initialColor);
		await expectSelection(page, preference);
	});
}

test("an invalid stored preference falls back to operable Auto", async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem("radiora.themePreference", "sepia");
	});
	await page.goto("/");
	await expectSelection(page, "auto", "sepia");

	await page.getByRole("group", { name: "テーマの切り替え" })
		.getByRole("button", { name: "Dark", exact: true }).click();
	await expectSelection(page, "dark");
});

test("TopBar and Options share one theme preference through navigation", async ({ page }) => {
	await page.goto("/");
	const topBarGroup = page.getByRole("group", { name: "テーマの切り替え" });
	await topBarGroup.getByRole("button", { name: "Dark", exact: true }).click();
	await expectSelection(page, "dark");

	await page.getByRole("button", { name: "Option", exact: true }).click();
	const option = page.getByRole("heading", { name: "Option", exact: true });
	await expect(option).toBeVisible();
	const themeSelect = page.getByLabel("カラーテーマ");
	await expect(themeSelect).toHaveValue("dark");
	await themeSelect.selectOption("light");
	await expectSelection(page, "light");
	await expect(themeSelect).toHaveValue("light");

	const viewSwitcher = page.getByRole("group", { name: "アウトラインとツリー" });
	await viewSwitcher.getByRole("button", { name: "アウトライン" }).click();
	await expect(page.getByRole("heading", { name: "Option", exact: true })).toHaveCount(0);
	await expectSelection(page, "light");

	await topBarGroup.getByRole("button", { name: "Auto", exact: true }).click();
	await expectSelection(page, "auto");

	await page.getByRole("button", { name: "Option", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Option", exact: true })).toBeVisible();
	await expect(themeSelect).toHaveValue("auto");
});

test("Light palette and active view switcher use the rendered design colors", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Light", exact: true }).click();

	const html = page.locator("html");
	await expect.poll(() => html.evaluate((element) => getComputedStyle(element).backgroundColor))
		.toBe("rgb(244, 240, 230)");
	await expect.poll(() => html.evaluate((element) => getComputedStyle(element).color))
		.toBe("rgb(17, 17, 17)");

	const activeView = page.getByRole("group", { name: "アウトラインとツリー" })
		.getByRole("button", { name: "アウトライン", pressed: true });
	await expect(activeView).toBeVisible();
	await expect.poll(() =>
		activeView.evaluate((element) => getComputedStyle(element).backgroundColor)
	)
		.toBe("rgb(201, 52, 38)");
	await expect.poll(() => activeView.evaluate((element) => getComputedStyle(element).color))
		.toBe("rgb(255, 255, 255)");
	expect(await renderedContrast(activeView)).toBeGreaterThanOrEqual(4.5);

	const search = page.getByRole("combobox").first();
	await search.focus();
	await expect.poll(() => search.evaluate((element) => getComputedStyle(element).borderTopColor))
		.toBe("rgb(159, 43, 32)");
});

test("Dark TopBar and visible search styling retain readable computed colors", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Dark", exact: true }).click();

	const topBar = page.locator("header.top-bar");
	await expect(topBar).toBeVisible();
	await expect.poll(() =>
		page.locator("html").evaluate((element) => getComputedStyle(element).backgroundColor)
	).toBe("rgb(5, 7, 11)");
	await expect.poll(() => topBar.evaluate((element) => getComputedStyle(element).backgroundColor))
		.toBe("rgba(5, 9, 15, 0.92)");
	const actionsButton = page.getByRole("toolbar", { name: "ナビゲーション" }).getByRole("button");
	await expect(actionsButton).toBeVisible();
	await expect.poll(() => actionsButton.evaluate((element) => getComputedStyle(element).color))
		.toBe("rgb(174, 189, 197)");

	const switcher = page.getByRole("group", { name: "アウトラインとツリー" });
	await expect.poll(() => switcher.evaluate((element) => getComputedStyle(element).backgroundColor))
		.toBe("rgb(4, 8, 13)");
	const activeView = switcher.getByRole("button", { name: "アウトライン", pressed: true });
	await expect.poll(() =>
		activeView.evaluate((element) => getComputedStyle(element).backgroundColor)
	)
		.toBe("rgb(13, 102, 117)");
	expect(await renderedContrast(activeView)).toBeGreaterThanOrEqual(4.5);

	const search = page.getByRole("combobox").first();
	await search.fill("palette");
	const results = page.getByRole("listbox", { name: "検索と新規作成の候補" });
	await expect(results).toBeVisible();
	await expect(results.getByRole("option")).not.toHaveCount(0);
	await expect.poll(() => results.evaluate((element) => getComputedStyle(element).backgroundColor))
		.toBe("rgb(12, 23, 35)");
	const section = results.locator(".search-section").first();
	await expect(section).toBeVisible();
	await expect.poll(() => section.evaluate((element) => getComputedStyle(element).backgroundColor))
		.toBe("rgb(7, 18, 28)");
	await expect.poll(() => section.evaluate((element) => getComputedStyle(element).color))
		.toBe("rgb(37, 198, 209)");
	expect(await renderedContrast(section)).toBeGreaterThanOrEqual(4.5);
	const resultText = results.locator("button strong").first();
	await expect(resultText).toBeVisible();
	expect(await renderedContrast(resultText)).toBeGreaterThanOrEqual(4.5);
});
