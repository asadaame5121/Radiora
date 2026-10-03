import { expect, type Page, test } from "@playwright/test";

const item = {
	id: "review-date",
	workId: "review-date",
	text: "source",
	parentId: null,
	orderKey: 0,
	collapsed: false,
	revisionSelector: { mode: "branch", branchId: "review-date-main" },
	createdAt: "2026-10-03T00:00:00.000Z",
	updatedAt: "2026-10-03T00:00:00.000Z",
};
function gate() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => resolve = done);
	return { promise, resolve };
}
async function setup(page: Page) {
	let calls = 0;
	const requests = new Map<number, { promise: Promise<void>; fail: boolean }>();
	await page.route(
		"**/api/rpc/listOutline",
		(route) =>
			route.fulfill({
				json: { result: { items: [item], links: [], knots: [], stashItemIds: [] } },
			}),
	);
	await page.route("**/api/rpc/projectDates", async (route) => {
		const request = ++calls;
		const range = route.request().postDataJSON().args[0];
		const reply = requests.get(request);
		if (reply) await reply.promise;
		if (reply?.fail) {
			await route.fulfill({ status: 500, json: { error: "date request failed" } });
			return;
		}
		const representative = { ...item, text: `accepted period ${request}` };
		await route.fulfill({
			json: {
				result: {
					range,
					created: [{
						work: { id: item.workId, createdAt: item.createdAt, updatedAt: item.updatedAt },
						representative,
						placements: [{ occurrence: representative, breadcrumb: [] }],
					}],
					updated: [],
				},
			},
		});
	});
	await page.goto("/");
	const open = page.getByRole("navigation", { name: "主な画面" }).getByRole("button", {
		name: "今日",
		exact: true,
	});
	await open.click();
	const today = page.getByRole("region", { name: "今日", exact: true });
	await expect(today.getByRole("button", { name: /accepted period 1/ })).toBeVisible();
	return {
		today,
		open,
		calls: () => calls,
		pause: (request: number, fail = false) => {
			const pending = gate();
			requests.set(request, { promise: pending.promise, fail });
			return pending.resolve;
		},
	};
}

test("a slow day request hides old results and accepts range and results together", async ({ page }) => {
	const s = await setup(page), release = s.pause(2);
	try {
		const start = s.today.getByLabel("開始", { exact: true }), before = await start.inputValue();
		await s.today.getByRole("button", { name: "翌日", exact: true }).click();
		await expect.poll(s.calls).toBe(2);
		await expect(start).toHaveValue(before);
		await expect(s.today.getByText("読み込み中…", { exact: true })).toBeVisible();
		await expect(s.today.getByRole("button", { name: /accepted period 1/ })).toHaveCount(0);
		for (const name of ["前日", "翌日", "週", "表示"]) {
			await expect(s.today.getByRole("button", { name, exact: true })).toBeDisabled();
		}
		await expect(start).toBeDisabled();
		await expect(s.today.getByLabel("終了（含まない）", { exact: true })).toBeDisabled();
		release();
		await expect(s.today.getByRole("button", { name: /accepted period 2/ })).toBeVisible();
		await expect(start).not.toHaveValue(before);
		await expect(start).toBeEnabled();
	} finally {
		release();
	}
});

test("failed day movement preserves accepted dates and results and can be retried", async ({ page }) => {
	const s = await setup(page), release = s.pause(2, true);
	try {
		const start = s.today.getByLabel("開始", { exact: true }), before = await start.inputValue();
		await s.today.getByRole("button", { name: "翌日", exact: true }).click();
		await expect.poll(s.calls).toBe(2);
		release();
		await expect(page.locator(".error")).toContainText("API request failed");
		await expect(start).toHaveValue(before);
		await expect(s.today.getByRole("button", { name: /accepted period 1/ })).toBeVisible();
		await expect(s.today.getByRole("button", { name: "翌日", exact: true })).toBeEnabled();
		await s.today.getByRole("button", { name: "翌日", exact: true }).click();
		await expect(s.today.getByRole("button", { name: /accepted period 3/ })).toBeVisible();
		await expect(start).not.toHaveValue(before);
	} finally {
		release();
	}
});

test("editing a custom draft and a failed load do not relabel the displayed period", async ({ page }) => {
	const s = await setup(page), release = s.pause(2, true);
	try {
		const period = s.today.locator(".date-result-range"), before = await period.textContent();
		await s.today.getByLabel("開始", { exact: true }).fill("2026-11-01");
		await s.today.getByLabel("終了（含まない）", { exact: true }).fill("2026-11-03");
		await expect(period).toHaveText(before ?? "");
		await s.today.getByRole("button", { name: "表示", exact: true }).click();
		await expect.poll(s.calls).toBe(2);
		release();
		await expect(page.locator(".error")).toContainText("API request failed");
		await expect(period).toHaveText(before ?? "");
		await expect(s.today.getByLabel("開始", { exact: true })).toHaveValue("2026-11-01");
		await s.today.getByRole("button", { name: "表示", exact: true }).click();
		await expect(s.today.getByRole("button", { name: /accepted period 3/ })).toBeVisible();
		await expect(period).toContainText("2026/11/1");
	} finally {
		release();
	}
});

for (const fail of [false, true]) {
	test(`an older ${fail ? "failed" : "successful"} request cannot finish a newer Today loading state`, async ({ page }) => {
		const s = await setup(page), releaseOld = s.pause(2, fail), releaseNew = s.pause(3);
		try {
			await s.today.getByRole("button", { name: "翌日", exact: true }).click();
			await expect.poll(s.calls).toBe(2);
			await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
			await expect(page.locator(".help-panel")).toBeVisible();
			await s.open.click();
			await expect.poll(s.calls).toBe(3);
			const response = page.waitForResponse("**/api/rpc/projectDates");
			releaseOld();
			await response;
			await expect(page.locator(".help-panel")).toBeVisible();
			await expect(page.locator(".error")).toHaveCount(0);
			releaseNew();
			await expect(s.today.getByRole("button", { name: /accepted period 3/ })).toBeVisible();
			await expect(s.today.getByRole("button", { name: /accepted period 2/ })).toHaveCount(0);
			await expect(s.today.getByRole("button", { name: "翌日", exact: true })).toBeEnabled();
		} finally {
			releaseOld();
			releaseNew();
		}
	});
}

test("empty Tree focuses its SVG root after opening from the top bar", async ({ page }) => {
	const empty = { items: [], links: [], knots: [], stashItemIds: [] };
	await page.route("**/api/rpc/listOutline", (route) => route.fulfill({ json: { result: empty } }));
	await page.route(
		"**/api/rpc/listGlobalLineage",
		(route) =>
			route.fulfill({
				json: {
					result: {
						snapshot: empty,
						promotedBranches: [],
						totalWorkCount: 0,
						filteredWorkCount: 0,
					},
				},
			}),
	);
	await page.goto("/");
	await page.getByRole("button", { name: "ツリー", exact: true }).click();
	await expect(page.getByRole("group", { name: "思索の系統樹" })).toBeFocused();
});
