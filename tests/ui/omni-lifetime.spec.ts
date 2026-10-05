import { expect, test } from "@playwright/test";
test("Palette and screen restoration preserve shared Omni input; Escape clears it", async ({ page }) => {
	await page.goto("/");
	const input = page.getByRole("combobox", { name: "検索・クイック入力", exact: true });
	await expect(input).toBeEnabled();
	await input.fill("shared draft");
	await page.keyboard.press("Control+k");
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(input).toHaveValue("shared draft");
	await expect(input).toBeFocused();
	await page.keyboard.press("F1");
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).first().click();
	await expect(input).toHaveValue("shared draft");
	await input.press("Escape");
	await expect(input).toHaveValue("");
});
