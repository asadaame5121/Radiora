import { expect, test } from "@playwright/test";

// #312/#314: exercise the shell's public UI, not the eventual Layout owner API.
test("#312 explicit Options layout changes survive reload", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Option", exact: true }).click();
	await page.getByRole("checkbox", { name: "インスペクターを閉じる", exact: true }).check();
	const width = page.getByRole("slider", { name: /インスペクター幅/ });
	await width.fill("400");
	await expect(width).toHaveValue("400");
	await page.reload();
	await expect(page.getByRole("button", { name: "インスペクターペインを開く", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Option", exact: true }).click();
	await expect(page.getByRole("checkbox", { name: "インスペクターを閉じる", exact: true })).toBeChecked();
	await expect(page.getByRole("slider", { name: /インスペクター幅/ })).toHaveValue("400");
});

for (const setting of ["width", "navigation"] as const) {
	test(`#312 Outline restoration does not contaminate saved collapsed preference on ${setting} change`, async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("button", { name: "インスペクターペインを閉じる", exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Option", exact: true }).click();
		await page.getByRole("checkbox", { name: "インスペクターを閉じる", exact: true }).check();
		await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
		// Resume the Outline's open Inspector, without changing the user's saved closed preference.
		await expect(page.getByRole("button", { name: "インスペクターペインを閉じる", exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Option", exact: true }).click();
		if (setting === "width") {
			await page.getByRole("slider", { name: /インスペクター幅/ }).fill("400");
		} else {
			await page.getByRole("checkbox", { name: "ナビゲーションを折りたたむ", exact: true }).check();
		}
		await page.reload();
		await expect(page.getByRole("button", { name: "インスペクターペインを開く", exact: true })).toBeVisible();
	});
}

for (const end of ["pointerup", "pointercancel"] as const) {
	test(`#312 Inspector resize stops responding after ${end}`, async ({ page }) => {
		await page.goto("/");
		const handle = page.getByRole("button", { name: "右ペインの幅を変更", exact: true });
		await expect(handle).toBeVisible();
		await handle.dispatchEvent("pointerdown", { button: 0, pointerId: 1, clientX: 960 });
		await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 880 })));
		await page.evaluate((type) => window.dispatchEvent(new PointerEvent(type, { pointerId: 1 })), end);
		await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 720 })));
		await page.getByRole("button", { name: "Option", exact: true }).click();
		await expect(page.getByRole("slider", { name: /インスペクター幅/ })).toHaveValue("400");
	});
}

test("#314 Options and license dialog preserve Outline selection, caret and Inspector tab", async ({ page }) => {
	await page.goto("/");
	const host = page.locator(".markdown-editor-host").first();
	const id = await host.getAttribute("data-editor-item-id");
	expect(id).not.toBeNull();
	const editor = page.locator(`textarea[data-item-id="${id}"]`);
	await host.click();
	await expect(editor).toBeFocused();
	await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(1, 3));
	await page.getByRole("tab", { name: "履歴", exact: true }).click();
	await page.getByRole("button", { name: "Option", exact: true }).click();
	await page.route("**/licenses/index.json", (route) => route.fulfill({ json: { runtime: [], npm: [] } }));
	await page.getByRole("button", { name: "ライセンス情報を表示", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "ライセンス情報", exact: true });
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await page.getByRole("button", { name: "アウトラインに戻る", exact: true }).click();
	await expect(editor).toBeFocused();
	await expect(page.getByRole("tab", { name: "履歴", exact: true })).toHaveAttribute("aria-selected", "true");
	expect(await editor.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([1, 3]);
});

for (const [clientX, expectedWidth] of [[1270, "240"], [600, "560"]] as const) {
	test(`#312 resize clamps and persists Inspector width to ${expectedWidth}`, async ({ page }) => {
		await page.goto("/");
		const handle = page.getByRole("button", { name: "右ペインの幅を変更", exact: true });
		await expect(handle).toBeVisible();
		await handle.dispatchEvent("pointerdown", { button: 0, pointerId: 1, clientX: 960 });
		await page.evaluate((x) => {
			window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: x }));
			window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
		}, clientX);
		await page.reload();
		await page.getByRole("button", { name: "Option", exact: true }).click();
		await expect(page.getByRole("slider", { name: /インスペクター幅/ })).toHaveValue(expectedWidth);
	});
}

test("#312 narrow relation editing opens temporarily and preserves the saved closed preference", async ({ page }) => {
	await page.setViewportSize({ width: 720, height: 800 });
	await page.goto("/");
	await page.locator(".markdown-editor-host").first().click();
	await page.getByRole("button", { name: "インスペクターペインを閉じる", exact: true }).click();
	await page.keyboard.press("Control+k");
	await page.getByRole("option", { name: /関連を追加/ }).click();
	const input = page.locator(".link-editor input[type=search]").first();
	await expect(input).toBeFocused();
	await expect(input).toBeInViewport();
	await expect(page.getByRole("tab", { name: "関係", exact: true })).toHaveAttribute("aria-selected", "true");
	await page.getByRole("button", { name: "Option", exact: true }).click();
	await expect(page.getByRole("checkbox", { name: "インスペクターを閉じる", exact: true })).toBeChecked();
	await page.getByRole("slider", { name: /インスペクター幅/ }).fill("400");
	await page.reload();
	await expect(page.getByRole("button", { name: "インスペクターペインを開く", exact: true })).toBeVisible();
});

test("#312 narrow explicit Inspector opening scrolls into view and persists", async ({ page }) => {
	await page.setViewportSize({ width: 720, height: 800 });
	await page.goto("/");
	await page.getByRole("button", { name: "インスペクターペインを閉じる", exact: true }).click();
	await page.getByRole("button", { name: "インスペクターペインを開く", exact: true }).click();
	await expect(page.locator(".inspector")).toBeInViewport();
	await page.reload();
	await expect(page.getByRole("button", { name: "インスペクターペインを閉じる", exact: true })).toBeVisible();
});
