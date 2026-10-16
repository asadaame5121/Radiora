// Headless browser check for the Loro undo PoC.
//
//   npm run build:web && npx vite preview --port 5200   # then: node browser_check.mjs http://127.0.0.1:5200/
//   npm run demo:web -- --port 5199                     # then: node browser_check.mjs http://127.0.0.1:5199/
//
// `playwright` must be resolvable. This repository already has it at its root
// (node_modules/playwright, with browsers in %LOCALAPPDATA%\ms-playwright); otherwise
// `npm i -D playwright && npx playwright install chromium`.
//
// Verifies in a real browser that:
//   1. the outline renders (i.e. the wasm module was loaded through the Vite entry),
//   2. a local insert is undone and redone from the buttons,
//   3. undo does not remove a change that came from the other peer,
//   4. the undo label is surfaced to the UI,
//   5. no console or page errors were raised.

import { chromium } from "playwright";

const url = process.argv[2];
if (!url) throw new Error("usage: node browser_check.mjs <url>");

const failures = [];
const check = (label, condition, detail) => {
	if (condition) {
		console.log(`PASS ${label}`);
		return;
	}
	failures.push(`${label}: ${JSON.stringify(detail)}`);
	console.log(`FAIL ${label}: ${JSON.stringify(detail)}`);
};

const titles = (page) => page.$$eval("#tree li", (nodes) => nodes.map((node) => node.textContent ?? ""));
const remoteTitles = (page) =>
	page.$$eval("#remote-tree li", (nodes) => nodes.map((node) => node.textContent ?? ""));
const count = (page, selector) => page.$$eval(selector, (nodes) => nodes.length);

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on("console", (message) => {
	if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

let crashed = null;
try {
	// The page loads a 3.2 MiB wasm module; wait generously and fail loudly if it never renders.
	await page.goto(url, { waitUntil: "load", timeout: 30000 });
	await page.waitForSelector("#tree li", { timeout: 30000 });

	const initial = await titles(page);
	check("initial outline renders", initial.length === 3, initial);

	const selection = await page.inputValue("#selection");
	check("selection is populated", selection !== "", selection);

	await page.click("#add-child");
	await page.waitForFunction((before) => document.querySelectorAll("#tree li").length > before, initial.length);
	const afterAdd = await titles(page);
	check("local insert adds one row", afterAdd.length === initial.length + 1, afterAdd);

	const statusAfterAdd = await page.textContent("#status");
	check("undo label reaches the UI", (statusAfterAdd ?? "").includes("項目を追加"), statusAfterAdd);

	await page.click("#undo");
	await page.waitForFunction((before) => document.querySelectorAll("#tree li").length === before, initial.length);
	const afterUndo = await titles(page);
	check("undo removes the inserted row", afterUndo.length === initial.length, afterUndo);

	await page.click("#redo");
	await page.waitForFunction((before) => document.querySelectorAll("#tree li").length > before, initial.length);
	const afterRedo = await titles(page);
	check("redo re-applies the insert", afterRedo.length === initial.length + 1, afterRedo);

	// A remote change arrives, then the local peer undoes: only the local step may be reverted.
	await page.click("#remote-add");
	await page.waitForFunction(() => document.querySelectorAll("#remote-tree li").length > 0);
	await page.click("#pull");
	await page.waitForFunction((before) => document.querySelectorAll("#tree li").length > before, afterRedo.length);
	const afterPull = await titles(page);
	check("pull brings the remote row", afterPull.length === afterRedo.length + 1, afterPull);

	await page.click("#undo");
	await page.waitForFunction(
		(before) => document.querySelectorAll("#tree li").length === before,
		afterPull.length - 1,
	);
	const afterRemoteUndo = await titles(page);
	check(
		"undo reverts only the local step",
		afterRemoteUndo.some((row) => row.includes("リモート")) && afterRemoteUndo.length === afterPull.length - 1,
		afterRemoteUndo,
	);

	const remoteAfterUndo = await remoteTitles(page);
	check("remote pane is unaffected by the local undo", remoteAfterUndo.length >= 1, remoteAfterUndo);

	const redoDisabled = await page.$eval("#redo", (button) => button.disabled);
	check("redo becomes available after undo", redoDisabled === false, redoDisabled);
} catch (error) {
	crashed = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	console.log(`FAIL check aborted: ${crashed}`);
}

check("no console or page errors", errors.length === 0, errors);
check("outline still rendered at the end", (await count(page, "#tree li")) > 0, await titles(page));

await browser.close();

if (crashed !== null || failures.length > 0) {
	console.log(`\n${failures.length} check(s) failed (crashed: ${crashed ?? "no"})`);
	process.exit(1);
}
console.log("\nall browser checks passed");
