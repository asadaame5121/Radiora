/**
 * Launches the v3 Tauri mock shell: the existing UI on `vite --mode mock`, shown in the
 * `radiora-desktop` window. The port must match `devUrl` in crates/radiora-desktop/tauri.conf.json.
 * Extra arguments are passed to `cargo run`. `--release` is rejected because the mock API exists
 * only as Vite dev-server middleware.
 */
const UI_ORIGIN = "http://127.0.0.1:5173";
const VITE_READY_ATTEMPTS = 300;
const VITE_READY_INTERVAL_MS = 100;
const VITE_PROBE_TIMEOUT_MS = 200;
const UI_ENTRY = "/src/ui/main.ts";
const ENTRY_WARMUP_TIMEOUT_MS = 120_000;

if (Deno.args.includes("--release")) {
	throw new Error("The mock shell needs the Vite dev server; release builds embed dist instead.");
}

// Run Vite's own entry with node so that kill() stops the server, not only a pnpm wrapper.
const vite = new Deno.Command("node", {
	args: [
		"node_modules/vite/bin/vite.js",
		"--mode",
		"mock",
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
		args: ["run", "-p", "radiora-desktop", "--locked", ...Deno.args],
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
	throw new Error(`The Vite mock server did not answer on ${UI_ORIGIN}.`);
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
