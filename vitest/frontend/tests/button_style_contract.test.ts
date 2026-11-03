import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("button base styles keep unscoped controls inside the dark theme", async () => {
	const styles = await readFile(new URL("../../../src/ui/styles.css", import.meta.url), "utf8");
	const buttonBase = styles.slice(styles.indexOf("button {"), styles.indexOf(".shell {"));

	expect(buttonBase.includes("appearance: none")).toBeTruthy();
	expect(buttonBase.includes("border: 1px solid var(--border)")).toBeTruthy();
	expect(buttonBase.includes("background: var(--surface-raised)")).toBeTruthy();
	expect(buttonBase.includes("button:hover:not(:disabled)")).toBeTruthy();
	expect(buttonBase.includes("button:focus-visible")).toBeTruthy();
	expect(buttonBase.includes("button:disabled")).toBeTruthy();
});
