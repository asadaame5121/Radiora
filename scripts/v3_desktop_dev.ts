/**
 * Development launcher of the v3 Tauri host: starts Vite on the `devUrl` port of
 * crates/radiora-desktop/tauri.conf.json, warms up the page entry, then runs
 * `cargo run -p radiora-desktop`. Closing the window stops Vite.
 *
 * - default: the v3 body-slice page (`v3.html`) on the real workspace.
 * - `--mock-shell`: the existing UI on `vite --mode mock` (stage A); opens no workspace.
 *
 * Other arguments are passed to `cargo run`. `--release` is rejected: a dev build shows the
 * Vite server, while a release build embeds `dist-v3` (see `mise run desktop:v3:release`).
 */
const UI_ORIGIN = "http://127.0.0.1:5173";
const VITE_READY_ATTEMPTS = 300;
const VITE_READY_INTERVAL_MS = 100;
const VITE_PROBE_TIMEOUT_MS = 200;
const ENTRY_WARMUP_TIMEOUT_MS = 120_000;

const mockShell = Deno.args.includes("--mock-shell");
const cargoArgs = Deno.args.filter((arg) => arg !== "--mock-shell");
const UI_ENTRY = mockShell ? "/src/ui/main.ts" : "/src/v3/main.ts";
if (cargoArgs.includes("--release")) {
	throw new Error(
		"The dev launcher shows the Vite server; build a release with desktop:v3:release.",
	);
}

// Run Vite's own entry with node so that kill() stops the server, not only a pnpm wrapper.
const vite = new Deno.Command("node", {
	args: [
		"node_modules/vite/bin/vite.js",
		...(mockShell ? ["--mode", "mock"] : []),
		"--host",
		"127.0.0.1",
		"--port",
		new URL(UI_ORIGIN).port,
		"--strictPort",
	],
	stdout: "inherit",
	stderr: "inherit",
}).spawn();

try {
	await waitForVite();
	await warmUpEntry();
	const desktop = new Deno.Command("cargo", {
		args: ["run", "-p", "radiora-desktop", "--locked", ...cargoArgs],
		// The mock shell shows index.html instead of the v3 page and opens no workspace.
		env: mockShell ? { RADIORA_V3_PAGE: "mock-shell" } : {},
		stdout: "inherit",
		stderr: "inherit",
	}).spawn();
	const result = await Promise.race([
		desktop.status.then((status) => ({ process: "desktop" as const, status })),
		vite.status.then((status) => ({ process: "vite" as const, status })),
	]);
	if (result.process === "vite") {
		throw new Error(`Vite exited before the desktop window closed (code ${result.status.code}).`);
	}
	if (!result.status.success) Deno.exitCode = result.status.code;
} finally {
	try {
		vite.kill();
		// biome-ignore lint/plugin/noSwallowedRejection: Vite may already have exited during teardown.
	} catch {
		// Vite already exited.
	}
}

async function waitForVite(): Promise<void> {
	for (let attempt = 0; attempt < VITE_READY_ATTEMPTS; attempt += 1) {
		try {
			const response = await fetch(UI_ORIGIN, {
				signal: AbortSignal.timeout(VITE_PROBE_TIMEOUT_MS),
			});
			await response.body?.cancel();
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, VITE_READY_INTERVAL_MS));
		}
	}
	throw new Error(`The Vite server did not answer on ${UI_ORIGIN}.`);
}

/**
 * A cold Vite server transforms the entry and optimizes dependencies on the first module
 * request, which can leave a window that opened too early blank. Request the entry first.
 */
async function warmUpEntry(): Promise<void> {
	const response = await fetch(`${UI_ORIGIN}${UI_ENTRY}`, {
		signal: AbortSignal.timeout(ENTRY_WARMUP_TIMEOUT_MS),
	});
	await response.body?.cancel();
	if (!response.ok) {
		throw new Error(`Vite could not transform ${UI_ENTRY} (HTTP ${response.status}).`);
	}
}
