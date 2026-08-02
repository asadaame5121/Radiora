import { assert } from "jsr:@std/assert@1";

Deno.test("button base styles keep unscoped controls inside the dark theme", async () => {
	const styles = await Deno.readTextFile(new URL("../src/ui/styles.css", import.meta.url));
	const buttonBase = styles.slice(styles.indexOf("button {"), styles.indexOf(".shell {"));

	assert(buttonBase.includes("appearance: none"));
	assert(buttonBase.includes("border: 1px solid var(--border)"));
	assert(buttonBase.includes("background: var(--surface-raised)"));
	assert(buttonBase.includes("button:hover:not(:disabled)"));
	assert(buttonBase.includes("button:focus-visible"));
	assert(buttonBase.includes("button:disabled"));
});
