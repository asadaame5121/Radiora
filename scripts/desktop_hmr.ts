const vitePort = await reserveLoopbackPort();
const bridgeFile = await Deno.makeTempFile({ prefix: "radiora-desktop-hmr-", suffix: ".json" });
const uiOrigin = `http://127.0.0.1:${vitePort}`;
const sharedEnvironment = {
	...Deno.env.toObject(),
	RADIORA_HMR_BRIDGE_FILE: bridgeFile,
};
const npmCommand = Deno.build.os === "windows" ? "npm.cmd" : "npm";
const vite = new Deno.Command(npmCommand, {
	args: ["run", "dev:web", "--", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"],
	env: sharedEnvironment,
	stdout: "inherit",
	stderr: "inherit",
}).spawn();

try {
	await waitForVite(uiOrigin);
	const desktop = new Deno.Command(Deno.execPath(), {
		args: ["desktop", "-A", "--hmr", "src/main.ts"],
		env: {
			...sharedEnvironment,
			RADIORA_HMR_UI_ORIGIN: uiOrigin,
		},
		stdout: "inherit",
		stderr: "inherit",
	}).spawn();
	const result = await Promise.race([
		desktop.status.then((status) => ({ process: "desktop" as const, status })),
		vite.status.then((status) => ({ process: "vite" as const, status })),
	]);
	if (result.process === "vite") {
		throw new Error(`Vite exited before the desktop app closed (code ${result.status.code}).`);
	}
	if (!result.status.success) Deno.exit(result.status.code);
} finally {
	try {
		vite.kill();
	} catch {
		// Vite already exited.
	}
	await Deno.remove(bridgeFile).catch(() => undefined);
}

async function reserveLoopbackPort(): Promise<number> {
	const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
	try {
		return (listener.addr as Deno.NetAddr).port;
	} finally {
		listener.close();
	}
}

async function waitForVite(origin: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			await fetch(origin, { signal: AbortSignal.timeout(200) });
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	throw new Error("Vite development server did not start.");
}
