import { expect, test } from "@playwright/test";

// A View-lifetime harness uses Svelte's real mount/unmount API without adding production hooks.
// All feature operations still go through the rendered App and its external HTTP boundary.
const harness = `<!doctype html><html lang="ja"><body>
<button id="mount" disabled>Mount App</button><button id="unmount">Unmount App</button>
<div id="app"></div>
<script type="module" src="/tests/ui/app-lifetime-harness.ts"></script>
</body></html>`;

test.beforeEach(async ({ page }) => {
	await page.route(
		"**/acceptance-harness",
		(route) => route.fulfill({ contentType: "text/html", body: harness }),
	);
	await page.goto("/acceptance-harness");
	await expect(page.getByRole("button", { name: "Option", exact: true })).toBeEnabled();
});

test("#312 unmount during resize releases listeners without saving from later pointer events", async ({ page }) => {
	const handle = page.getByRole("button", { name: "右ペインの幅を変更", exact: true });
	await expect(handle).toBeVisible();
	await handle.dispatchEvent("pointerdown", { button: 0, pointerId: 1, clientX: 960 });
	await page.evaluate(() =>
		window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 880 }))
	);
	// Do not send pointerup as part of a normal mouse click: the gesture must still be active at unmount.
	await page.getByRole("button", { name: "Unmount App", exact: true }).evaluate((
		element: HTMLButtonElement,
	) => element.click());
	const remount = page.getByRole("button", { name: "Mount App", exact: true });
	await expect(remount).toBeEnabled();
	await page.evaluate(() => {
		window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 720 }));
		window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
	});
	await remount.click();
	await page.getByRole("button", { name: "Option", exact: true }).click();
	await expect(page.getByRole("slider", { name: /インスペクター幅/ })).toHaveValue("320");
});

for (const status of [200, 503]) {
	test(`#313 pending license index ${status} cannot open a dialog after App unmount`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		let release: () => void = () => {
			throw new Error("Index gate is not initialized");
		};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route("**/licenses/index.json", async (route) => {
			await gate;
			await route.fulfill({ status, json: { runtime: [], npm: [] } });
		});
		await page.getByRole("button", { name: "Option", exact: true }).click();
		const request = page.waitForRequest("**/licenses/index.json");
		await page.getByRole("button", { name: "ライセンス情報を表示", exact: true }).click();
		await request;
		await page.getByRole("button", { name: "Unmount App", exact: true }).evaluate((
			element: HTMLButtonElement,
		) => element.click());
		const remount = page.getByRole("button", { name: "Mount App", exact: true });
		await expect(remount).toBeEnabled();
		const response = page.waitForResponse("**/licenses/index.json");
		release();
		await (await response).finished();
		await remount.click();
		await page.getByRole("button", { name: "Option", exact: true }).click();
		await expect(page.getByRole("dialog", { name: "ライセンス情報", exact: true })).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}
